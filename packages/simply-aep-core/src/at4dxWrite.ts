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

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Connection } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  AT4DX_BINDING_LOCAL_OBJECT_NAMES,
  AT4DX_BINDING_OBJECTS,
  BindingWriteError,
  type AmbiguousBindingRecord,
  type At4dxBindingCreateResult,
  type At4dxBindingUpdateResult,
  type BindingFieldsInput,
  type BindingIssue,
  type BindingKeyField,
  type CreateBindingInput,
  type CreateBindingTarget,
  type MalformedBindingRecord,
  type RawBindingRecord,
  type UpdateBindingInput,
  type UpdateBindingTarget,
  type WritableBindingType,
} from './at4dxBindingTypes.js';
import { buildBindingXml, patchBindingXml } from './at4dxBuildXml.js';
import { deployMetadataFile } from './at4dxDomainProcessDeploy.js';
import { scanLocalBindings } from './at4dxLocalScan.js';
import { scanOrgBindings } from './at4dxOrgScan.js';
import { validateBindings } from './at4dxValidate.js';
import { UnpatchableValueShapeError } from './customMetadataXml.js';

import { developerNameIssue } from './developerName.js';
const DEFAULT_WAIT = Duration.minutes(33);

/** @throws {BindingWriteError} `invalid-developer-name` if `developerName` doesn't match Custom Metadata's DeveloperName rules. */
function checkDeveloperName(developerName: string): void {
  if (developerNameIssue(developerName)) {
    throw new BindingWriteError(
      'invalid-developer-name',
      `"${developerName}" is not a valid DeveloperName: it must start with a letter, contain only letters, numbers, and single underscores, not end with an underscore, and be 40 characters or fewer.`,
    );
  }
}

/** @throws {BindingWriteError} `label-too-long` if `label` exceeds Custom Metadata's 40-character label limit. */
function checkLabel(label: string): void {
  if (label.length > 40) {
    throw new BindingWriteError('label-too-long', `Label "${label}" exceeds the 40-character limit.`);
  }
}

/**
 * A field only meaningful for a different `bindingType` was given — usage error, distinct from a
 * missing-field problem `validateBindings` would otherwise catch.
 *
 * @throws {BindingWriteError} `type-field-mismatch` on any mismatch.
 */
function checkTypeFieldMismatch(bindingType: WritableBindingType, input: BindingFieldsInput): void {
  if (bindingType === 'Service') {
    if (input.sobject !== undefined || input.sobjectAlternate !== undefined) {
      throw new BindingWriteError(
        'type-field-mismatch',
        'sobject/sobjectAlternate cannot be set when bindingType is Service — use bindingInterface instead.',
      );
    }
  } else if (input.bindingInterface !== undefined) {
    throw new BindingWriteError(
      'type-field-mismatch',
      'bindingInterface cannot be set when bindingType is Selector, Domain, or UnitOfWork — use sobject instead.',
    );
  }

  if ((bindingType === 'Domain' || bindingType === 'UnitOfWork') && input.priority !== undefined) {
    throw new BindingWriteError(
      'type-field-mismatch',
      'priority cannot be set when bindingType is Domain or UnitOfWork.',
    );
  }

  if (bindingType === 'UnitOfWork' && input.to !== undefined) {
    throw new BindingWriteError(
      'type-field-mismatch',
      'to cannot be set when bindingType is UnitOfWork, which has no To__c field — use sequence instead.',
    );
  }

  if (bindingType !== 'UnitOfWork' && input.sequence !== undefined) {
    throw new BindingWriteError('type-field-mismatch', 'sequence can only be set when bindingType is UnitOfWork.');
  }
}

type ScanContext = {
  records: RawBindingRecord[];
  malformed: MalformedBindingRecord[];
  ambiguous: AmbiguousBindingRecord[];
  source: string;
  /** `true` when writing/deploying should target local source at `localDir` instead of `connection`. */
  isLocal: boolean;
};

/**
 * Scans for `createBinding`'s validation context. Unlike `updateBinding`/`list`/`validate`, an empty
 * local scan is not `at4dx-not-detected` here — it's the ordinary "this is the first binding of this
 * type ever created" case. Only an org missing the Custom Metadata Type entirely is a hard stop.
 */
async function scanCreateContext(bindingType: WritableBindingType, target: CreateBindingTarget): Promise<ScanContext> {
  if (target.sourceDir) {
    const { records, malformed, ambiguous } = scanLocalBindings([target.sourceDir], [bindingType]);
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgBindings(connection, [bindingType]);
  if (scanResult.missingTypes.includes(bindingType)) {
    throw new BindingWriteError(
      'at4dx-not-detected',
      `AT4DX's Application Factory doesn't appear to be present in this org: the ${AT4DX_BINDING_OBJECTS[bindingType]} Custom Metadata Type wasn't found.`,
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    ambiguous: scanResult.ambiguous,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/**
 * Scans for `updateBinding`'s lookup, matching `list`/`validate`'s "empty local scan means AT4DX isn't
 * here" heuristic — unlike `createBinding`, `updateBinding` always expects to find an existing record.
 */
async function scanUpdateContext(bindingType: WritableBindingType, target: UpdateBindingTarget): Promise<ScanContext> {
  if (target.sourceDirs && target.sourceDirs.length > 0) {
    const { records, malformed, ambiguous } = scanLocalBindings(target.sourceDirs, [bindingType]);
    if (records.length === 0 && malformed.length === 0) {
      throw new BindingWriteError(
        'at4dx-not-detected',
        `AT4DX's Application Factory doesn't appear to be present in this source: the ${AT4DX_BINDING_OBJECTS[bindingType]} Custom Metadata Type wasn't found.`,
      );
    }
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgBindings(connection, [bindingType]);
  if (scanResult.missingTypes.includes(bindingType)) {
    throw new BindingWriteError(
      'at4dx-not-detected',
      `AT4DX's Application Factory doesn't appear to be present in this org: the ${AT4DX_BINDING_OBJECTS[bindingType]} Custom Metadata Type wasn't found.`,
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    ambiguous: scanResult.ambiguous,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/** @throws {BindingWriteError} `validation-failed` (carrying `issues`) when any issue is `error`-severity and `force` isn't set. */
function checkValidation(issues: BindingIssue[], force: boolean | undefined): void {
  if (!force && issues.some((issue) => issue.severity === 'error')) {
    throw new BindingWriteError(
      'validation-failed',
      'Writing this binding would introduce a wiring problem AT4DX validation already knows how to catch; pass force to write anyway.',
      issues,
    );
  }
}

/**
 * Writes `xml` to `localFilePath` when given, otherwise to a fresh temp directory (removed afterward),
 * then deploys it when `connection` is given. Shared tail end of `createBinding`/`updateBinding` —
 * mirrors `at4dxDomainProcessWrite.ts`'s `writeAndDeploy`.
 *
 * @throws {BindingWriteError} `deploy-failed` if a deploy was requested and didn't succeed. The local write (when `localFilePath` was given) is left in place either way — only the deploy step is undone-by-never-having-happened.
 */
async function writeAndDeploy(params: {
  developerName: string;
  bindingType: WritableBindingType;
  localObjectName: string;
  xml: string;
  issues: BindingIssue[];
  localFilePath?: string;
  connection?: Connection;
  wait?: Duration;
}): Promise<At4dxBindingCreateResult> {
  let filePath = params.localFilePath;
  let tempDir: string | undefined;

  if (filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } else {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-aep-binding-'));
    const dir = path.join(tempDir, 'customMetadata');
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${params.localObjectName}.${params.developerName}.md-meta.xml`);
  }

  await fs.writeFile(filePath, params.xml, 'utf-8');

  let deploy: At4dxBindingCreateResult['deploy'];
  try {
    if (params.connection) {
      const deployResult = await deployMetadataFile(params.connection, filePath, params.wait ?? DEFAULT_WAIT);
      if (!deployResult.success) {
        const summary =
          deployResult.failures
            .map((failure) => `${failure.fullName} (${failure.type}): ${failure.error}`)
            .join('; ') || deployResult.status;
        throw new BindingWriteError('deploy-failed', `Failed to deploy the binding: ${summary}`);
      }
      deploy = { id: deployResult.id, status: deployResult.status, success: deployResult.success };
    }
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  return {
    developerName: params.developerName,
    bindingType: params.bindingType,
    filePath: tempDir ? undefined : filePath,
    deploy,
    issues: params.issues,
  };
}

/** @returns The binding's key and keyField as declared by `input`, given `bindingType`. @throws {BindingWriteError} `type-field-mismatch` when the field the type actually needs is missing. */
function keyFromCreateInput(
  bindingType: WritableBindingType,
  input: CreateBindingInput,
): { key: string; keyField?: BindingKeyField } {
  if (bindingType === 'Service') {
    if (!input.bindingInterface) {
      throw new BindingWriteError('type-field-mismatch', 'bindingInterface is required when bindingType is Service.');
    }
    return { key: input.bindingInterface, keyField: undefined };
  }

  if (!input.sobject) {
    throw new BindingWriteError('type-field-mismatch', 'sobject is required when bindingType is Selector or Domain.');
  }
  return { key: input.sobject, keyField: input.sobjectAlternate ? 'alternate' : 'primary' };
}

/**
 * Creates a new Application Factory binding record: validates the inputs, checks the `DeveloperName`
 * doesn't already exist in the scanned scope (of the same `bindingType`), runs it through
 * `validateBindings` alongside everything already scanned, then writes (and optionally deploys) the
 * generated `.md-meta.xml`.
 *
 * See docs/design/0015-at4dx-binding-validate-create-set.md for the full behavior contract.
 *
 * @throws {BindingWriteError} See the error codes in `BindingWriteErrorCode`.
 */
export async function createBinding(
  input: CreateBindingInput,
  target: CreateBindingTarget,
): Promise<At4dxBindingCreateResult> {
  if (!target.sourceDir && !target.connection) {
    throw new BindingWriteError('source-or-target-required', 'At least one of sourceDir or connection is required.');
  }

  checkDeveloperName(input.developerName);
  const label = input.label ?? input.developerName;
  checkLabel(label);
  checkTypeFieldMismatch(input.bindingType, input);
  if (input.bindingType !== 'UnitOfWork' && !input.to) {
    throw new BindingWriteError(
      'type-field-mismatch',
      'to is required when bindingType is Service, Selector, or Domain.',
    );
  }
  const { key, keyField } = keyFromCreateInput(input.bindingType, input);

  const scan = await scanCreateContext(input.bindingType, target);

  if (
    scan.records.some((record) => record.developerName === input.developerName) ||
    scan.malformed.some((record) => record.developerName === input.developerName)
  ) {
    throw new BindingWriteError(
      'developer-name-already-exists',
      `A ${AT4DX_BINDING_OBJECTS[input.bindingType]} record named "${input.developerName}" already exists in ${scan.source}.`,
    );
  }

  const candidate: RawBindingRecord = {
    bindingType: input.bindingType,
    developerName: input.developerName,
    label,
    key,
    keyField,
    to: input.to,
    priority: input.priority,
    sequence: input.sequence,
    source: scan.source,
  };

  const issues = validateBindings([...scan.records, candidate], {
    malformed: scan.malformed,
    ambiguous: scan.ambiguous,
  });
  checkValidation(issues, input.force);

  const localObjectName = AT4DX_BINDING_LOCAL_OBJECT_NAMES[input.bindingType];
  const xml = buildBindingXml(
    { bindingType: input.bindingType, key, keyField, to: input.to, priority: input.priority, sequence: input.sequence },
    { label },
  );
  const localFilePath = target.sourceDir
    ? path.join(target.sourceDir, 'customMetadata', `${localObjectName}.${input.developerName}.md-meta.xml`)
    : undefined;

  return writeAndDeploy({
    developerName: input.developerName,
    bindingType: input.bindingType,
    localObjectName,
    xml,
    issues,
    localFilePath,
    connection: target.connection,
    wait: target.wait,
  });
}

/**
 * Merges `input`'s given fields onto `existing` — everything `input` leaves `undefined` keeps its
 * current value.
 *
 * @throws {BindingWriteError} `type-field-mismatch` — see `checkTypeFieldMismatch`.
 */
function mergeBindingRecord(
  bindingType: WritableBindingType,
  existing: RawBindingRecord,
  input: UpdateBindingInput,
): RawBindingRecord {
  checkTypeFieldMismatch(bindingType, input);

  let keyField = existing.keyField;
  let key: string;

  if (bindingType === 'Service') {
    key = input.bindingInterface ?? existing.key;
  } else {
    key = input.sobject ?? existing.key;
    if (input.sobjectAlternate !== undefined) {
      keyField = input.sobjectAlternate ? 'alternate' : 'primary';
    }
  }

  return {
    ...existing,
    label: input.label ?? existing.label,
    key,
    keyField,
    to: input.to ?? existing.to,
    priority: input.priority ?? existing.priority,
    sequence: input.sequence ?? existing.sequence,
  };
}

/**
 * Updates an existing Application Factory binding record: locates it by `DeveloperName` (within the
 * same `bindingType`), merges in only the fields `input` actually sets, re-validates the result, then
 * rewrites (and optionally deploys) the `.md-meta.xml`.
 *
 * See docs/design/0015-at4dx-binding-validate-create-set.md for the full behavior contract.
 *
 * @throws {BindingWriteError} See the error codes in `BindingWriteErrorCode`.
 */
export async function updateBinding(
  input: UpdateBindingInput,
  target: UpdateBindingTarget,
): Promise<At4dxBindingUpdateResult> {
  if ((!target.sourceDirs || target.sourceDirs.length === 0) && !target.connection) {
    throw new BindingWriteError('source-or-target-required', 'At least one of sourceDirs or connection is required.');
  }

  checkDeveloperName(input.developerName);
  if (input.label !== undefined) {
    checkLabel(input.label);
  }
  checkTypeFieldMismatch(input.bindingType, input);

  const hasFieldUpdate = Object.entries(input).some(
    ([key, value]) => key !== 'developerName' && key !== 'bindingType' && key !== 'force' && value !== undefined,
  );
  if (!hasFieldUpdate) {
    throw new BindingWriteError(
      'no-fields-to-update',
      'At least one field besides developerName must be given to update.',
    );
  }

  const scan = await scanUpdateContext(input.bindingType, target);
  const existing = scan.records.find((record) => record.developerName === input.developerName);
  if (!existing) {
    throw new BindingWriteError(
      'developer-name-not-found',
      `No ${AT4DX_BINDING_OBJECTS[input.bindingType]} record named "${input.developerName}" was found in ${scan.source}.`,
    );
  }

  const merged = mergeBindingRecord(input.bindingType, existing, input);

  const otherRecords = scan.records.filter((record) => record.developerName !== input.developerName);
  const issues = validateBindings([...otherRecords, merged], { malformed: scan.malformed, ambiguous: scan.ambiguous });
  checkValidation(issues, input.force);

  const localObjectName = AT4DX_BINDING_LOCAL_OBJECT_NAMES[input.bindingType];

  let xml: string;
  if (scan.isLocal) {
    const existingXml = await fs.readFile(existing.filePath!, 'utf-8');
    try {
      xml = patchBindingXml(existingXml, existing, merged, { label: merged.label });
    } catch (err) {
      if (!(err instanceof UnpatchableValueShapeError)) {
        throw err;
      }
      xml = buildBindingXml(merged, { label: merged.label });
    }
  } else {
    xml = buildBindingXml(merged, { label: merged.label });
  }

  return writeAndDeploy({
    developerName: input.developerName,
    bindingType: input.bindingType,
    localObjectName,
    xml,
    issues,
    localFilePath: scan.isLocal ? existing.filePath : undefined,
    connection: target.connection,
    wait: target.wait,
  });
}
