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

/* eslint-disable camelcase -- Salesforce API names (Widget__c, etc.) as override keys */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compilePermissionSet,
  generatePermissionSets,
  loadPermissionSetBuildConfig,
  loadPermissionSetsFile,
  PermissionSetBuildError,
  type PermissionSetSourceScan,
  scanPermissionSetSource,
} from '../src/permissionSetBuild.js';
import { writeFixtureProject } from './helpers/fixtureProject.js';

const scan: PermissionSetSourceScan = {
  objects: ['Widget__c'],
  fields: [
    { object: 'Widget__c', field: 'Color__c' },
    { object: 'Account', field: 'Rating__c' },
  ],
  tabs: ['Widget__c'],
  recordTypes: [{ object: 'Widget__c', recordType: 'Standard' }],
};

/** Asserts `promise` rejects with a `PermissionSetBuildError` carrying `code`, and returns it. */
async function expectBuildError(promise: Promise<unknown>, code: string): Promise<PermissionSetBuildError> {
  const error = await promise.then(
    () => expect.fail('expected a PermissionSetBuildError'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PermissionSetBuildError);
  expect((error as PermissionSetBuildError).code).toBe(code);
  return error as PermissionSetBuildError;
}

describe('scanPermissionSetSource', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-set-scan-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds objects, permissionable fields, tabs, and record types with Object.Child names', async () => {
    writeFixtureProject(root);

    const result = await scanPermissionSetSource(root);

    expect(result.objects).toStrictEqual(['Widget__c']);
    // Required (Serial__c) and master-detail (Account__c) fields can't carry field permissions.
    expect(result.fields).toHaveLength(2);
    expect(result.fields).toContainEqual({ object: 'Widget__c', field: 'Color__c' });
    // A field whose object has no .object-meta.xml is attributed to its parent folder.
    expect(result.fields).toContainEqual({ object: 'Account', field: 'Rating__c' });
    expect(result.tabs).toStrictEqual(['Widget__c']);
    expect(result.recordTypes).toStrictEqual([{ object: 'Widget__c', recordType: 'Standard' }]);
  });

  it('returns an empty scan for an empty directory', async () => {
    expect(await scanPermissionSetSource(root)).toStrictEqual({ objects: [], fields: [], tabs: [], recordTypes: [] });
  });

  it('throws scan-failed when the directory cannot be resolved', async () => {
    await expectBuildError(scanPermissionSetSource(path.join(root, 'missing')), 'scan-failed');
  });
});

describe('compilePermissionSet', () => {
  it('read-only: read + View All Fields on objects, so no field permissions', () => {
    const data = compilePermissionSet(scan, { type: 'read-only', name: 'PS', includeRecordTypes: false });

    expect(data.objectPermissions).toStrictEqual([
      {
        object: 'Widget__c',
        allowCreate: false,
        allowDelete: false,
        allowEdit: false,
        allowRead: true,
        modifyAllRecords: false,
        viewAllRecords: false,
        viewAllFields: true,
      },
    ]);
    // Account has no object permission here, so its field still needs an explicit one.
    expect(data.fieldPermissions).toStrictEqual([{ field: 'Account.Rating__c', readable: true, editable: false }]);
    expect(data.tabSettings).toStrictEqual([{ tab: 'Widget__c', visible: true }]);
    expect(data.recordTypeVisibilities).toStrictEqual([]);
    expect(data.label).toBe('PS');
    expect(data.hasActivationRequired).toBe(false);
  });

  it('view-all: adds View All Records', () => {
    const data = compilePermissionSet(scan, { type: 'view-all', name: 'PS', includeRecordTypes: false });

    expect(data.objectPermissions[0]).toMatchObject({ viewAllRecords: true, viewAllFields: true, allowEdit: false });
  });

  it('modify-all: full CRUD and Modify All, editable fields, no View All Fields', () => {
    const data = compilePermissionSet(scan, { type: 'modify-all', name: 'PS', includeRecordTypes: false });

    expect(data.objectPermissions[0]).toMatchObject({
      allowCreate: true,
      allowDelete: true,
      allowEdit: true,
      allowRead: true,
      modifyAllRecords: true,
      viewAllRecords: true,
      viewAllFields: false,
    });
    expect(data.fieldPermissions).toStrictEqual([
      { field: 'Account.Rating__c', readable: true, editable: true },
      { field: 'Widget__c.Color__c', readable: true, editable: true },
    ]);
  });

  it('includes scanned record types only when includeRecordTypes is set', () => {
    const data = compilePermissionSet(scan, { type: 'read-only', name: 'PS', includeRecordTypes: true });

    expect(data.recordTypeVisibilities).toStrictEqual([{ recordType: 'Widget__c.Standard', visible: true }]);
  });

  it('layers overrides on top of the baseline, merging into scanned entries and adding new ones', () => {
    const data = compilePermissionSet(scan, {
      type: 'modify-all',
      name: 'PS',
      label: 'Label',
      description: 'Description',
      includeRecordTypes: true,
      config: {
        objects: { Widget__c: { delete: false }, Contact: { read: true } },
        fields: { 'Widget__c.Color__c': { editable: false }, 'Contact.Email': { readable: true } },
        tabs: { Widget__c: { visible: false }, 'standard-Contact': { visible: true } },
        recordTypeVisibilities: { 'Widget__c.Standard': { visible: false } },
        userPermissions: { ViewSetup: true, ApiEnabled: false },
        hasActivationRequired: true,
      },
    });

    expect(data.label).toBe('Label');
    expect(data.description).toBe('Description');
    expect(data.hasActivationRequired).toBe(true);
    expect(data.objectPermissions.map((p) => p.object)).toStrictEqual(['Contact', 'Widget__c']);
    expect(data.objectPermissions[0]).toMatchObject({ allowRead: true, allowEdit: false, viewAllFields: false });
    expect(data.objectPermissions[1]).toMatchObject({ allowDelete: false, allowEdit: true });
    expect(data.fieldPermissions).toStrictEqual([
      { field: 'Account.Rating__c', readable: true, editable: true },
      { field: 'Contact.Email', readable: true, editable: false },
      { field: 'Widget__c.Color__c', readable: true, editable: false },
    ]);
    expect(data.tabSettings).toStrictEqual([
      { tab: 'standard-Contact', visible: true },
      { tab: 'Widget__c', visible: false },
    ]);
    expect(data.recordTypeVisibilities).toStrictEqual([{ recordType: 'Widget__c.Standard', visible: false }]);
    expect(data.userPermissions).toStrictEqual([
      { name: 'ApiEnabled', enabled: false },
      { name: 'ViewSetup', enabled: true },
    ]);
  });

  it('drops field permissions for an object an override grants View All Fields', () => {
    const data = compilePermissionSet(scan, {
      type: 'modify-all',
      name: 'PS',
      includeRecordTypes: false,
      config: { objects: { Widget__c: { viewAllFields: true } }, hasActivationRequired: false },
    });

    expect(data.fieldPermissions.map((f) => f.field)).toStrictEqual(['Account.Rating__c']);
  });
});

describe('permission sets files', () => {
  let root: string;
  let source: string;

  const writeJson = (name: string, value: unknown): string => {
    const file = path.join(root, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-sets-file-'));
    source = path.join(root, 'force-app');
    writeFixtureProject(source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('loadPermissionSetsFile', () => {
    it('applies defaults, lets entries override them, and loads inline and file-referenced overrides', async () => {
      const overrides = writeJson('admin.json', { userPermissions: { ViewSetup: true } });
      const file = writeJson('permission-sets.json', {
        defaults: { directory: source, output: path.join(root, 'out'), includeRecordTypes: true },
        permissionSets: [
          { name: 'Reader', type: 'read-only' },
          {
            name: 'Admin',
            type: 'modify-all',
            label: 'Admin Label',
            description: 'Admin Description',
            output: path.join(root, 'admin-out'),
            includeRecordTypes: false,
            config: overrides,
          },
          { name: 'Support', type: 'view-all', config: { tabs: { Widget__c: { visible: false } } } },
        ],
      });

      const specs = await loadPermissionSetsFile(file);

      expect(specs).toStrictEqual([
        {
          type: 'read-only',
          name: 'Reader',
          label: undefined,
          description: undefined,
          directory: source,
          output: path.join(root, 'out'),
          includeRecordTypes: true,
          config: undefined,
        },
        {
          type: 'modify-all',
          name: 'Admin',
          label: 'Admin Label',
          description: 'Admin Description',
          directory: source,
          output: path.join(root, 'admin-out'),
          includeRecordTypes: false,
          config: { userPermissions: { ViewSetup: true }, hasActivationRequired: false },
        },
        {
          type: 'view-all',
          name: 'Support',
          label: undefined,
          description: undefined,
          directory: source,
          output: path.join(root, 'out'),
          includeRecordTypes: true,
          config: { tabs: { Widget__c: { visible: false } }, hasActivationRequired: false },
        },
      ]);
    });

    it('rejects a missing file with config-not-found', async () => {
      const error = await expectBuildError(loadPermissionSetsFile(path.join(root, 'nope.json')), 'config-not-found');
      expect(error.args).toStrictEqual([path.join(root, 'nope.json')]);
    });

    it('rejects malformed JSON with invalid-config', async () => {
      const file = writeJson('bad.json', '{ "permissionSets": [');
      const error = await expectBuildError(loadPermissionSetsFile(file), 'invalid-config');
      expect(error.args[0]).toBe(file);
    });

    it.each([
      ['no permission sets', { permissionSets: [] }],
      ['an unknown type', { permissionSets: [{ name: 'A', type: 'admin', directory: 'd', output: 'o' }] }],
      [
        'a duplicate name',
        {
          permissionSets: [
            { name: 'A', type: 'read-only' },
            { name: 'A', type: 'view-all' },
          ],
        },
      ],
      ['no directory anywhere', { defaults: { output: 'o' }, permissionSets: [{ name: 'A', type: 'read-only' }] }],
      ['no output anywhere', { defaults: { directory: 'd' }, permissionSets: [{ name: 'A', type: 'read-only' }] }],
      [
        'an invalid inline override',
        {
          permissionSets: [
            { name: 'A', type: 'read-only', directory: 'd', output: 'o', config: { tabs: { T: { visible: 'yes' } } } },
          ],
        },
      ],
    ])('rejects %s with invalid-config', async (_label, contents) => {
      const withDefaults =
        'defaults' in contents || contents.permissionSets.length === 0
          ? contents
          : { defaults: { directory: source, output: root }, ...contents };
      await expectBuildError(loadPermissionSetsFile(writeJson('file.json', withDefaults)), 'invalid-config');
    });

    it('names the duplicate and the missing key in the validation message', async () => {
      const file = writeJson('file.json', {
        defaults: { directory: source },
        permissionSets: [
          { name: 'A', type: 'read-only', output: root },
          { name: 'A', type: 'view-all' },
        ],
      });

      const error = await expectBuildError(loadPermissionSetsFile(file), 'invalid-config');
      expect(error.args[1]).toContain("Duplicate permission set name 'A'");
      expect(error.args[1]).toContain("'output' must be set on the permission set or in 'defaults'");
    });

    it('rejects a referenced overrides file that does not exist with config-not-found', async () => {
      const file = writeJson('file.json', {
        defaults: { directory: source, output: root },
        permissionSets: [{ name: 'A', type: 'read-only', config: path.join(root, 'missing.json') }],
      });

      const error = await expectBuildError(loadPermissionSetsFile(file), 'config-not-found');
      expect(error.args).toStrictEqual([path.join(root, 'missing.json')]);
    });

    it('rejects an invalid referenced overrides file with invalid-config naming that file', async () => {
      const overrides = writeJson('overrides.json', { objects: { Widget__c: { read: 'yes' } } });
      const file = writeJson('file.json', {
        defaults: { directory: source, output: root },
        permissionSets: [{ name: 'A', type: 'read-only', config: overrides }],
      });

      const error = await expectBuildError(loadPermissionSetsFile(file), 'invalid-config');
      expect(error.args[0]).toBe(overrides);
    });

    it('rejects a source directory that does not exist with directory-not-found', async () => {
      const file = writeJson('file.json', {
        defaults: { output: root },
        permissionSets: [{ name: 'A', type: 'read-only', directory: path.join(root, 'nowhere') }],
      });

      const error = await expectBuildError(loadPermissionSetsFile(file), 'directory-not-found');
      expect(error.args).toStrictEqual([path.join(root, 'nowhere'), 'A']);
    });
  });

  describe('loadPermissionSetBuildConfig', () => {
    it('loads an overrides file, defaulting hasActivationRequired', async () => {
      const file = writeJson('overrides.json', { objects: { Widget__c: { edit: true } } });

      expect(await loadPermissionSetBuildConfig(file)).toStrictEqual({
        objects: { Widget__c: { edit: true } },
        hasActivationRequired: false,
      });
    });
  });

  describe('generatePermissionSets', () => {
    it('writes one file per spec, scanning each distinct directory once', async () => {
      const fromSource = vi.spyOn(ComponentSet, 'fromSource');
      const output = path.join(root, 'out');
      const seen: string[] = [];

      const results = await generatePermissionSets(
        [
          { type: 'read-only', name: 'Reader', includeRecordTypes: false, directory: source, output },
          { type: 'modify-all', name: 'Admin', includeRecordTypes: true, directory: `${source}${path.sep}`, output },
        ],
        (name) => seen.push(name),
      );

      expect(fromSource).toHaveBeenCalledTimes(1);
      expect(seen).toStrictEqual(['Reader', 'Admin']);
      expect(results).toStrictEqual([
        {
          name: 'Reader',
          path: path.join(output, 'Reader.permissionset-meta.xml'),
          objectPermissionCount: 1,
          fieldPermissionCount: 1,
        },
        {
          name: 'Admin',
          path: path.join(output, 'Admin.permissionset-meta.xml'),
          objectPermissionCount: 1,
          fieldPermissionCount: 2,
        },
      ]);

      const admin = fs.readFileSync(results[1].path, 'utf-8');
      expect(admin).toContain('<field>Widget__c.Color__c</field>');
      expect(admin).toContain('<recordType>Widget__c.Standard</recordType>');
      expect(admin).not.toContain('Widget__c.Widget__c');
      expect(fs.readFileSync(results[0].path, 'utf-8')).not.toContain('<recordTypeVisibilities>');
    });
  });
});
