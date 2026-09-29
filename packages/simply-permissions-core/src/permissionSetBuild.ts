/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-await-in-loop */
/* eslint-disable complexity */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComponentSet, type SourceComponent } from '@salesforce/source-deploy-retrieve';
import { type ConfigSchema, loadJsonConfig } from '@simplysf/simply-core';
import {
  buildPermissionSetXml,
  type FieldPermission,
  type ObjectPermission,
  type PermissionSetTemplateData,
  type RecordTypeVisibility,
  type TabSetting,
} from './permissionSetXmlTemplate.js';
import { type PermissionSetBuildConfig, PermissionSetBuildConfigSchema } from './schemas/permissionSetBuildConfig.js';
import { PermissionSetsFileSchema } from './schemas/permissionSetsFile.js';

/** Baseline permission profile applied before config overrides. */
export type PermissionSetType = 'read-only' | 'view-all' | 'modify-all';

/** The error conditions this module signals structurally (via `code`) rather than by message text, so a `Messages`-based caller (the CLI) can map each one to its own error key without string-matching. */
export type PermissionSetBuildErrorCode = 'scan-failed' | 'invalid-config' | 'config-not-found' | 'directory-not-found';

export class PermissionSetBuildError extends Error {
  public readonly code: PermissionSetBuildErrorCode;
  /** The raw values a `Messages`-based caller needs to reproduce its own error text: `[detail]` for `scan-failed`, `[filePath, detail]` for `invalid-config`, `[filePath]` for `config-not-found`, `[directory, permissionSetName]` for `directory-not-found`. */
  public readonly args: string[];

  public constructor(code: PermissionSetBuildErrorCode, message: string, args: string[] = [message]) {
    super(message);
    this.name = 'PermissionSetBuildError';
    this.code = code;
    this.args = args;
  }
}

/** The subset of a parsed `CustomField` metadata file's contents the scan reads. */
type CustomFieldXml = { CustomField?: { required?: string | boolean; type?: string } };

/**
 * The permission-relevant metadata discovered in a source directory. Independent of any
 * permission set's settings, so one scan can feed every permission set built from that directory.
 */
export type PermissionSetSourceScan = {
  /** `CustomObject` API names. */
  objects: string[];
  /** Fields that can carry field permissions (required and master-detail fields are excluded). */
  fields: Array<{ object: string; field: string }>;
  /** `CustomTab` API names. */
  tabs: string[];
  /** Record types found under scanned objects. */
  recordTypes: Array<{ object: string; recordType: string }>;
};

/** How to compile a single permission set from a {@link PermissionSetSourceScan}. */
export type PermissionSetBuildOptions = {
  type: PermissionSetType;
  /** API name; also the default label and the output filename. */
  name: string;
  label?: string;
  description?: string;
  includeRecordTypes: boolean;
  config?: PermissionSetBuildConfig;
};

/** A fully resolved permission set to generate: build options plus where to scan and write. */
export type PermissionSetSpec = PermissionSetBuildOptions & {
  directory: string;
  output: string;
};

/** Where a generated permission set was written, and how many permissions it grants. */
export type PermissionSetBuildResult = {
  name: string;
  path: string;
  objectPermissionCount: number;
  fieldPermissionCount: number;
};

/** Whether a parsed `CustomField` can't carry field permissions (required or master-detail). */
function isPermissionlessField(customField: CustomFieldXml['CustomField']): boolean {
  return customField !== undefined && (String(customField.required) === 'true' || customField.type === 'MasterDetail');
}

/**
 * Scans a Salesforce source directory for custom objects, fields, tabs, and record types.
 *
 * @throws {PermissionSetBuildError} `scan-failed` if `ComponentSet.fromSource` can't resolve `directory`.
 */
export async function scanPermissionSetSource(directory: string): Promise<PermissionSetSourceScan> {
  let components: ComponentSet;
  try {
    components = ComponentSet.fromSource(directory);
  } catch (error) {
    throw new PermissionSetBuildError('scan-failed', (error as Error).message);
  }

  const objects = new Set<string>();
  const fields = new Map<string, { object: string; field: string }>();
  const tabs = new Set<string>();
  const recordTypes = new Map<string, { object: string; recordType: string }>();

  for (const rawComponent of components) {
    const component = rawComponent as SourceComponent;

    if (component.type.name === 'CustomObject') {
      objects.add(component.fullName);

      // A child's `fullName` is already `Object.Child`; `name` is the bare child name.
      for (const child of component.getChildren()) {
        if (child.type.name === 'CustomField') {
          const fieldContent = await child.parseXml<CustomFieldXml>();
          if (isPermissionlessField(fieldContent.CustomField)) {
            continue;
          }
          fields.set(`${component.fullName}.${child.name}`, { object: component.fullName, field: child.name });
        } else if (child.type.name === 'RecordType') {
          recordTypes.set(`${component.fullName}.${child.name}`, {
            object: component.fullName,
            recordType: child.name,
          });
        }
      }
    } else if (component.type.name === 'CustomField') {
      // A field whose object has no `.object-meta.xml` in the source (typically a standard object).
      const fieldContent = await component.parseXml<CustomFieldXml>();
      if (isPermissionlessField(fieldContent.CustomField)) {
        continue;
      }
      const objectName = component.parent?.name ?? '';
      fields.set(`${objectName}.${component.name}`, { object: objectName, field: component.name });
    } else if (component.type.name === 'CustomTab') {
      tabs.add(component.name);
    }
  }

  return {
    objects: [...objects],
    fields: [...fields.values()],
    tabs: [...tabs],
    recordTypes: [...recordTypes.values()],
  };
}

/**
 * Applies the `type` baseline to the scanned metadata, layers the config overrides on top, and
 * assembles the permission set's template data with every permission list sorted by API name.
 *
 * Baselines: every type grants read on each scanned object and tab visibility; `read-only` and
 * `view-all` also grant View All Fields (so no field permissions are emitted), `view-all` adds View
 * All Records, and `modify-all` grants full CRUD, Modify All Records, and edit on every field.
 */
export function compilePermissionSet(
  scan: PermissionSetSourceScan,
  options: PermissionSetBuildOptions,
): PermissionSetTemplateData {
  const { type, config } = options;

  const objectPermissions = new Map<string, ObjectPermission>();
  const fieldPermissions = new Map<string, Map<string, FieldPermission>>();
  const tabSettings = new Map<string, TabSetting>();
  const recordTypeVisibilities = new Map<string, Map<string, RecordTypeVisibility>>();

  for (const objectName of scan.objects) {
    objectPermissions.set(objectName, {
      object: objectName,
      allowCreate: false,
      allowDelete: false,
      allowEdit: false,
      allowRead: true,
      modifyAllRecords: false,
      viewAllRecords: type === 'view-all',
      viewAllFields: false,
    });
  }

  for (const { object, field } of scan.fields) {
    if (!fieldPermissions.has(object)) {
      fieldPermissions.set(object, new Map());
    }
    fieldPermissions.get(object)?.set(field, { field: `${object}.${field}`, readable: true, editable: false });
  }

  for (const tab of scan.tabs) {
    tabSettings.set(tab, { tab, visible: true });
  }

  if (options.includeRecordTypes) {
    for (const { object, recordType } of scan.recordTypes) {
      if (!recordTypeVisibilities.has(object)) {
        recordTypeVisibilities.set(object, new Map());
      }
      recordTypeVisibilities.get(object)?.set(recordType, { recordType: `${object}.${recordType}`, visible: true });
    }
  }

  if (type === 'read-only' || type === 'view-all') {
    for (const permission of objectPermissions.values()) {
      permission.viewAllFields = true;
    }
  }

  if (type === 'modify-all') {
    for (const permission of objectPermissions.values()) {
      permission.allowCreate = true;
      permission.allowDelete = true;
      permission.allowEdit = true;
      permission.allowRead = true;
      permission.modifyAllRecords = true;
      permission.viewAllRecords = true;
    }
    for (const fields of fieldPermissions.values()) {
      for (const field of fields.values()) {
        field.editable = true;
        field.readable = true;
      }
    }
  }

  if (config?.objects) {
    for (const [objectName, objectPerms] of Object.entries(config.objects)) {
      if (!objectPermissions.has(objectName)) {
        objectPermissions.set(objectName, {
          object: objectName,
          allowCreate: false,
          allowDelete: false,
          allowEdit: false,
          allowRead: false,
          modifyAllRecords: false,
          viewAllRecords: false,
          viewAllFields: false,
        });
      }
      const permission = objectPermissions.get(objectName);
      if (permission) {
        permission.allowRead = objectPerms.read ?? permission.allowRead;
        permission.allowCreate = objectPerms.create ?? permission.allowCreate;
        permission.allowEdit = objectPerms.edit ?? permission.allowEdit;
        permission.allowDelete = objectPerms.delete ?? permission.allowDelete;
        permission.modifyAllRecords = objectPerms.modifyAll ?? permission.modifyAllRecords;
        permission.viewAllRecords = objectPerms.viewAll ?? permission.viewAllRecords;
        permission.viewAllFields = objectPerms.viewAllFields ?? permission.viewAllFields;
      }
    }
  }

  if (config?.fields) {
    for (const [fullFieldName, fieldPerms] of Object.entries(config.fields)) {
      const [objectName, fieldName] = fullFieldName.split('.');
      if (!fieldPermissions.has(objectName)) {
        fieldPermissions.set(objectName, new Map());
      }
      const fieldMap = fieldPermissions.get(objectName);
      let field = fieldMap?.get(fieldName);
      if (!field) {
        field = { field: fullFieldName, readable: false, editable: false };
        fieldMap?.set(fieldName, field);
      }
      field.readable = fieldPerms.readable ?? field.readable;
      field.editable = fieldPerms.editable ?? field.editable;
    }
  }

  if (config?.tabs) {
    for (const [tabName, tabPerms] of Object.entries(config.tabs)) {
      if (!tabSettings.has(tabName)) {
        tabSettings.set(tabName, { tab: tabName, visible: false });
      }
      const setting = tabSettings.get(tabName);
      if (setting) {
        setting.visible = tabPerms.visible ?? setting.visible;
      }
    }
  }

  if (config?.recordTypeVisibilities) {
    for (const [fullRecordTypeName, rtPerms] of Object.entries(config.recordTypeVisibilities)) {
      const [objectName, recordTypeName] = fullRecordTypeName.split('.');
      if (!recordTypeVisibilities.has(objectName)) {
        recordTypeVisibilities.set(objectName, new Map());
      }
      const rtMap = recordTypeVisibilities.get(objectName);
      let recordType = rtMap?.get(recordTypeName);
      if (!recordType) {
        recordType = { recordType: fullRecordTypeName, visible: false };
        rtMap?.set(recordTypeName, recordType);
      }
      recordType.visible = rtPerms.visible ?? recordType.visible;
    }
  }

  const templateData: PermissionSetTemplateData = {
    label: options.label ?? options.name,
    description: options.description,
    hasActivationRequired: config?.hasActivationRequired ?? false,
    objectPermissions: [...objectPermissions.values()],
    fieldPermissions: [],
    tabSettings: [...tabSettings.values()],
    recordTypeVisibilities: [],
    userPermissions: [],
  };

  for (const [objectName, fields] of fieldPermissions.entries()) {
    if (objectPermissions.get(objectName)?.viewAllFields) {
      continue;
    }
    templateData.fieldPermissions.push(...fields.values());
  }

  for (const recordTypes of recordTypeVisibilities.values()) {
    templateData.recordTypeVisibilities.push(...recordTypes.values());
  }

  if (config?.userPermissions) {
    for (const [name, enabled] of Object.entries(config.userPermissions)) {
      templateData.userPermissions.push({ name, enabled });
    }
  }

  templateData.objectPermissions.sort((a, b) => a.object.localeCompare(b.object));
  templateData.fieldPermissions.sort((a, b) => a.field.localeCompare(b.field));
  templateData.tabSettings.sort((a, b) => a.tab.localeCompare(b.tab));
  templateData.recordTypeVisibilities.sort((a, b) => a.recordType.localeCompare(b.recordType));
  templateData.userPermissions.sort((a, b) => a.name.localeCompare(b.name));

  return templateData;
}

/**
 * Renders `templateData` to `<output>/<name>.permissionset-meta.xml`, creating `output` if needed
 * and overwriting any existing file.
 */
export async function writePermissionSet(
  templateData: PermissionSetTemplateData,
  name: string,
  output: string,
): Promise<PermissionSetBuildResult> {
  const filePath = path.join(output, `${name}.permissionset-meta.xml`);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(filePath, buildPermissionSetXml(templateData));

  return {
    name,
    path: filePath,
    objectPermissionCount: templateData.objectPermissions.length,
    fieldPermissionCount: templateData.fieldPermissions.length,
  };
}

/** Loads and validates a JSON config file, reporting malformed JSON and schema violations alike as `invalid-config`. */
async function loadValidatedJson<T>(filePath: string, schema: ConfigSchema<T>): Promise<T> {
  if (!existsSync(filePath)) {
    throw new PermissionSetBuildError('config-not-found', `Configuration file ${filePath} does not exist.`, [filePath]);
  }
  let parsed;
  try {
    parsed = await loadJsonConfig(filePath, schema);
  } catch (error) {
    const detail = (error as Error).message;
    throw new PermissionSetBuildError('invalid-config', `${filePath}: ${detail}`, [filePath, detail]);
  }
  if (!parsed.success) {
    throw new PermissionSetBuildError('invalid-config', `${filePath}: ${parsed.message}`, [filePath, parsed.message]);
  }
  return parsed.data;
}

/**
 * Loads a permission set's overrides file (the `simply permissions build --config` format).
 *
 * @throws {PermissionSetBuildError} `config-not-found` or `invalid-config`.
 */
export async function loadPermissionSetBuildConfig(filePath: string): Promise<PermissionSetBuildConfig> {
  return loadValidatedJson(filePath, PermissionSetBuildConfigSchema);
}

/**
 * Loads a permission sets file and resolves each entry into a {@link PermissionSetSpec}: applies
 * `defaults`, loads file-referenced overrides, and checks that every source directory exists — so a
 * caller that validates with this before calling {@link generatePermissionSets} writes nothing when
 * any entry is invalid. Relative paths are returned as written (resolved against the current
 * directory by whatever uses them), not against the file's location.
 *
 * @throws {PermissionSetBuildError} `config-not-found` or `invalid-config` (the file itself or a
 * referenced overrides file), or `directory-not-found`.
 */
export async function loadPermissionSetsFile(filePath: string): Promise<PermissionSetSpec[]> {
  const file = await loadValidatedJson(filePath, PermissionSetsFileSchema);
  const specs: PermissionSetSpec[] = [];

  for (const entry of file.permissionSets) {
    // The schema guarantees each is set on the entry or in `defaults`.
    const directory = (entry.directory ?? file.defaults?.directory) as string;
    const output = (entry.output ?? file.defaults?.output) as string;

    if (!existsSync(directory)) {
      throw new PermissionSetBuildError(
        'directory-not-found',
        `Source directory ${directory} for permission set ${entry.name} does not exist.`,
        [directory, entry.name],
      );
    }

    specs.push({
      type: entry.type,
      name: entry.name,
      label: entry.label,
      description: entry.description,
      directory,
      output,
      includeRecordTypes: entry.includeRecordTypes ?? file.defaults?.includeRecordTypes ?? false,
      config: typeof entry.config === 'string' ? await loadPermissionSetBuildConfig(entry.config) : entry.config,
    });
  }

  return specs;
}

/**
 * Scans, compiles, and writes each permission set in order. Each distinct source directory is
 * scanned once and the result reused for every permission set built from it.
 *
 * @param onPermissionSet - Called with each permission set's name just before it's built (for progress output).
 * @throws {PermissionSetBuildError} `scan-failed` — see {@link scanPermissionSetSource}.
 */
export async function generatePermissionSets(
  specs: PermissionSetSpec[],
  onPermissionSet?: (name: string) => void,
): Promise<PermissionSetBuildResult[]> {
  const scans = new Map<string, PermissionSetSourceScan>();
  const results: PermissionSetBuildResult[] = [];

  for (const spec of specs) {
    onPermissionSet?.(spec.name);

    const scanKey = path.resolve(spec.directory);
    let scan = scans.get(scanKey);
    if (!scan) {
      scan = await scanPermissionSetSource(spec.directory);
      scans.set(scanKey, scan);
    }

    results.push(await writePermissionSet(compilePermissionSet(scan, spec), spec.name, spec.output));
  }

  return results;
}
