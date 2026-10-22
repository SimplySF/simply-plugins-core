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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertUniquePermissionSetNames,
  checkPermissionSets,
  compilePermissionSet,
  findPermissionSetBuildFiles,
  generatePermissionSets,
  loadPermissionSetBuildConfig,
  loadPermissionSetBuildFile,
  PermissionSetBuildError,
  type PermissionSetSourceScan,
  type PermissionSetSpec,
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
    expect(data.tabSettings).toStrictEqual([{ tab: 'Widget__c', visibility: 'Visible' }]);
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
        objects: { Widget__c: { allowDelete: false }, Contact: { allowRead: true } },
        fields: { 'Widget__c.Color__c': { editable: false }, 'Contact.Email': { readable: true } },
        tabs: { Widget__c: { visibility: 'None' }, 'standard-Contact': { visibility: 'Available' }, Lead: {} },
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
      // A tab only an override names, with no visibility of its own, defaults to None.
      { tab: 'Lead', visibility: 'None' },
      { tab: 'standard-Contact', visibility: 'Available' },
      { tab: 'Widget__c', visibility: 'None' },
    ]);
    expect(data.recordTypeVisibilities).toStrictEqual([{ recordType: 'Widget__c.Standard', visible: false }]);
    expect(data.userPermissions).toStrictEqual([
      { name: 'ApiEnabled', enabled: false },
      { name: 'ViewSetup', enabled: true },
    ]);
  });

  it('overrides View All Records and Modify All Records in both directions', () => {
    const config = (viewAllRecords: boolean, modifyAllRecords: boolean): PermissionSetSpec['config'] => ({
      objects: { Widget__c: { viewAllRecords, modifyAllRecords } },
      hasActivationRequired: false,
    });

    const granted = compilePermissionSet(scan, {
      type: 'read-only',
      name: 'PS',
      includeRecordTypes: false,
      config: config(true, true),
    });
    const revoked = compilePermissionSet(scan, {
      type: 'modify-all',
      name: 'PS',
      includeRecordTypes: false,
      config: config(false, false),
    });

    expect(granted.objectPermissions[0]).toMatchObject({ viewAllRecords: true, modifyAllRecords: true });
    expect(revoked.objectPermissions[0]).toMatchObject({ viewAllRecords: false, modifyAllRecords: false });
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

describe('permission set build files', () => {
  let root: string;
  let source: string;

  const writeJson = (name: string, value: unknown): string => {
    const file = path.join(root, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-set-build-file-'));
    source = path.join(root, 'force-app');
    writeFixtureProject(source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('loadPermissionSetBuildFile', () => {
    /** A valid file's contents for permission set `A`, with `overrides` replacing or adding keys. */
    const fileContents = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      name: 'A',
      type: 'read-only',
      directory: source,
      output: root,
      ...overrides,
    });

    it('loads one permission set, defaulting includeRecordTypes', async () => {
      const file = writeJson('a.psbuild.json', fileContents());

      expect(await loadPermissionSetBuildFile(file)).toStrictEqual({
        type: 'read-only',
        name: 'A',
        label: undefined,
        description: undefined,
        directory: source,
        output: root,
        includeRecordTypes: false,
        config: undefined,
      });
    });

    it('loads every setting, with file-referenced overrides', async () => {
      const overrides = writeJson('admin.json', { userPermissions: { ViewSetup: true } });
      const file = writeJson(
        'admin.psbuild.json',
        fileContents({
          name: 'Admin',
          type: 'modify-all',
          label: 'Admin Label',
          description: 'Admin Description',
          includeRecordTypes: true,
          config: overrides,
        }),
      );

      expect(await loadPermissionSetBuildFile(file)).toStrictEqual({
        type: 'modify-all',
        name: 'Admin',
        label: 'Admin Label',
        description: 'Admin Description',
        directory: source,
        output: root,
        includeRecordTypes: true,
        config: { userPermissions: { ViewSetup: true }, hasActivationRequired: false },
      });
    });

    it('loads inline overrides', async () => {
      const file = writeJson(
        'a.psbuild.json',
        fileContents({ config: { tabs: { Widget__c: { visibility: 'Available' } } } }),
      );

      expect((await loadPermissionSetBuildFile(file)).config).toStrictEqual({
        tabs: { Widget__c: { visibility: 'Available' } },
        hasActivationRequired: false,
      });
    });

    it('rejects a missing file with config-not-found', async () => {
      const error = await expectBuildError(
        loadPermissionSetBuildFile(path.join(root, 'nope.json')),
        'config-not-found',
      );
      expect(error.args).toStrictEqual([path.join(root, 'nope.json')]);
    });

    it('rejects malformed JSON with invalid-config', async () => {
      const file = writeJson('bad.json', '{ "name": ');
      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'invalid-config');
      expect(error.args[0]).toBe(file);
    });

    it.each([
      ['no name', { name: undefined }],
      ['an unknown type', { type: 'admin' }],
      ['no directory', { directory: undefined }],
      ['no output', { output: undefined }],
      ['an invalid inline override', { config: { tabs: { T: { visibility: 'Hidden' } } } }],
    ])('rejects %s with invalid-config', async (_label, overrides) => {
      const file = writeJson('a.psbuild.json', fileContents(overrides));
      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'invalid-config');
      expect(error.args[0]).toBe(file);
    });

    it.each([
      ['objects', 'read', 'allowRead'],
      ['objects', 'create', 'allowCreate'],
      ['objects', 'edit', 'allowEdit'],
      ['objects', 'delete', 'allowDelete'],
      ['objects', 'viewAll', 'viewAllRecords'],
      ['objects', 'modifyAll', 'modifyAllRecords'],
      ['tabs', 'visible', 'visibility (Visible, Available, or None)'],
    ])(
      'rejects the renamed %s key %s in an inline override with invalid-config naming %s',
      async (section, oldKey, newKey) => {
        const file = writeJson(
          'a.psbuild.json',
          fileContents({ config: { [section]: { Widget__c: { [oldKey]: true } } } }),
        );

        const error = await expectBuildError(loadPermissionSetBuildFile(file), 'invalid-config');
        expect(error.args[0]).toBe(file);
        expect(error.args[1]).toContain(`${oldKey} was renamed to ${newKey}.`);
      },
    );

    it('rejects a file in the old permissionSets list format with legacy-format', async () => {
      const file = writeJson('app.psbuild.json', {
        defaults: { directory: source, output: root },
        permissionSets: [{ name: 'A', type: 'read-only' }],
      });

      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'legacy-format');
      expect(error.args).toStrictEqual([file]);
    });

    it('rejects a referenced overrides file that does not exist with config-not-found', async () => {
      const file = writeJson('a.psbuild.json', fileContents({ config: path.join(root, 'missing.json') }));

      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'config-not-found');
      expect(error.args).toStrictEqual([path.join(root, 'missing.json')]);
    });

    it('rejects an invalid referenced overrides file with invalid-config naming that file', async () => {
      // A `permissionSets` key in an overrides file is just invalid, not the old build file format.
      const overrides = writeJson('overrides.json', {
        permissionSets: [],
        objects: { Widget__c: { allowRead: 'yes' } },
      });
      const file = writeJson('a.psbuild.json', fileContents({ config: overrides }));

      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'invalid-config');
      expect(error.args[0]).toBe(overrides);
    });

    it('rejects a source directory that does not exist with directory-not-found', async () => {
      const file = writeJson('a.psbuild.json', fileContents({ directory: path.join(root, 'nowhere') }));

      const error = await expectBuildError(loadPermissionSetBuildFile(file), 'directory-not-found');
      expect(error.args).toStrictEqual([path.join(root, 'nowhere'), 'A']);
    });
  });

  describe('assertUniquePermissionSetNames', () => {
    const entry = (file: string, name: string): { file: string; spec: PermissionSetSpec } => ({
      file,
      spec: { type: 'read-only', name, includeRecordTypes: false, directory: source, output: root },
    });

    it('accepts distinct names', () => {
      expect(() =>
        assertUniquePermissionSetNames([entry('a.psbuild.json', 'A'), entry('b.psbuild.json', 'B')]),
      ).not.toThrow();
    });

    it('rejects a name declared by two files with duplicate-name, naming both', async () => {
      const error = await expectBuildError(
        Promise.resolve().then(() =>
          assertUniquePermissionSetNames([
            entry('a.psbuild.json', 'A'),
            entry('b.psbuild.json', 'B'),
            entry('c.psbuild.json', 'A'),
          ]),
        ),
        'duplicate-name',
      );
      expect(error.args).toStrictEqual(['A', 'a.psbuild.json', 'c.psbuild.json']);
    });
  });

  describe('loadPermissionSetBuildConfig', () => {
    it('rejects every renamed key at once, naming each new key', async () => {
      const file = writeJson('overrides.json', {
        objects: { Widget__c: { read: true, viewAll: true, modifyAll: false } },
        tabs: { Widget__c: { visible: true } },
      });

      const error = await expectBuildError(loadPermissionSetBuildConfig(file), 'invalid-config');
      expect(error.args[0]).toBe(file);
      expect(error.args[1]).toContain('read was renamed to allowRead.');
      expect(error.args[1]).toContain('viewAll was renamed to viewAllRecords.');
      expect(error.args[1]).toContain('modifyAll was renamed to modifyAllRecords.');
      expect(error.args[1]).toContain('visible was renamed to visibility (Visible, Available, or None).');
    });

    it('loads an overrides file, defaulting hasActivationRequired', async () => {
      const file = writeJson('overrides.json', { objects: { Widget__c: { allowEdit: true } } });

      expect(await loadPermissionSetBuildConfig(file)).toStrictEqual({
        objects: { Widget__c: { allowEdit: true } },
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

  describe('checkPermissionSets', () => {
    let output: string;
    let filePath: string;
    let generated: string;
    const spec = (): PermissionSetSpec => ({
      type: 'modify-all',
      name: 'Admin',
      includeRecordTypes: true,
      directory: source,
      output,
    });
    const check = async (): Promise<string> => (await checkPermissionSets([spec()]))[0].status;

    beforeEach(async () => {
      output = path.join(root, 'out');
      [{ path: filePath }] = await generatePermissionSets([spec()]);
      generated = fs.readFileSync(filePath, 'utf-8');
    });

    it('reports a freshly generated file as up-to-date, with the same path and counts generate returns', async () => {
      expect(await checkPermissionSets([spec()])).toStrictEqual([
        { name: 'Admin', path: filePath, objectPermissionCount: 1, fieldPermissionCount: 2, status: 'up-to-date' },
      ]);
    });

    it.each([
      ['reindented', (xml: string) => xml.replaceAll('    ', '  ')],
      ['CRLF line endings', (xml: string) => xml.replaceAll('\n', '\r\n')],
      ['no trailing newline', (xml: string) => xml.trimEnd()],
      ['collapsed onto one line', (xml: string) => xml.replaceAll(/>\s+</g, '><')],
      ['no XML declaration, with a comment', (xml: string) => xml.replace(/^<\?xml[^>]*\?>/, '<!-- generated -->')],
    ])('treats a %s file as up-to-date', async (_, reformat) => {
      fs.writeFileSync(filePath, reformat(generated));

      expect(await check()).toBe('up-to-date');
    });

    it.each([
      [
        'a changed value',
        (xml: string) => xml.replace('<allowDelete>true</allowDelete>', '<allowDelete>false</allowDelete>'),
      ],
      [
        'a value differing only in case',
        (xml: string) => xml.replace('<allowDelete>true</allowDelete>', '<allowDelete>True</allowDelete>'),
      ],
      ['a removed entry', (xml: string) => xml.replace(/<fieldPermissions>[\s\S]*?<\/fieldPermissions>\s*/, '')],
      [
        'an extra entry',
        (xml: string) =>
          xml.replace(
            '</PermissionSet>',
            '<userPermissions><enabled>true</enabled><name>ViewSetup</name></userPermissions></PermissionSet>',
          ),
      ],
      [
        'reordered entries',
        (xml: string) => {
          const [first = '', second = ''] = xml.match(/<fieldPermissions>[\s\S]*?<\/fieldPermissions>/g) ?? [];
          return xml.replace(first, '@@').replace(second, first).replace('@@', second);
        },
      ],
      ['a missing closing tag', (xml: string) => xml.replace('</PermissionSet>', '')],
      ['non-XML content', () => 'not xml'],
      ['empty content', () => ''],
    ])('reports a file with %s as drifted', async (_, edit) => {
      const edited = edit(generated);
      expect(edited).not.toBe(generated);
      fs.writeFileSync(filePath, edited);

      expect(await check()).toBe('drifted');
    });

    it('reports drift when the source metadata gains a field', async () => {
      const fieldsDir = path.join(source, 'main', 'default', 'objects', 'Widget__c', 'fields');
      fs.writeFileSync(
        path.join(fieldsDir, 'Size__c.field-meta.xml'),
        fs.readFileSync(path.join(fieldsDir, 'Color__c.field-meta.xml'), 'utf-8').replaceAll('Color', 'Size'),
      );

      expect(await check()).toBe('drifted');
    });

    it('reports a missing file without writing anything, scanning each distinct directory once', async () => {
      const fromSource = vi.spyOn(ComponentSet, 'fromSource');
      const newOutput = path.join(root, 'not-created');
      const seen: string[] = [];

      const results = await checkPermissionSets(
        [
          { ...spec(), output: newOutput },
          { ...spec(), name: 'Reader', type: 'read-only', directory: `${source}${path.sep}`, output: newOutput },
        ],
        (name) => seen.push(name),
      );

      expect(results.map((result) => result.status)).toStrictEqual(['missing', 'missing']);
      expect(seen).toStrictEqual(['Admin', 'Reader']);
      expect(fromSource).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(newOutput)).toBe(false);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(generated);
    });
  });
});

describe('findPermissionSetBuildFiles', () => {
  let originalCwd: string;
  let root: string;

  const write = (file: string, content = '{}'): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-permission-set-build-files-'));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds .psbuild.json files at any depth, sorted, with / separators, and ignores every other file', async () => {
    write('config/app.psbuild.json');
    write('apps/sales/sales.psbuild.json');
    write('root.psbuild.json');
    // Correctly shaped, but without the suffix: not a permission set build file.
    write('config/permission-sets.json', JSON.stringify({ permissionSets: [] }));
    write('config/notes.psbuild.json.bak');

    expect(await findPermissionSetBuildFiles()).toStrictEqual([
      'apps/sales/sales.psbuild.json',
      'config/app.psbuild.json',
      'root.psbuild.json',
    ]);
  });

  it('does not descend into node_modules, .git, .sf, or .sfdx', async () => {
    write('app.psbuild.json');
    for (const dir of ['node_modules/pkg', '.git', '.sf/orgs', '.sfdx']) {
      write(`${dir}/x.psbuild.json`);
    }
    write('.config/team.psbuild.json');

    expect(await findPermissionSetBuildFiles()).toStrictEqual(['.config/team.psbuild.json', 'app.psbuild.json']);
  });

  it('finds files regardless of git: tracked, untracked, and gitignored alike', async () => {
    execFileSync('git', ['init', '-q']);
    write('tracked.psbuild.json');
    execFileSync('git', ['add', 'tracked.psbuild.json']);
    write('untracked.psbuild.json');
    write('ignored/x.psbuild.json');
    write('.gitignore', 'ignored/\n');

    expect(await findPermissionSetBuildFiles()).toStrictEqual([
      'ignored/x.psbuild.json',
      'tracked.psbuild.json',
      'untracked.psbuild.json',
    ]);
  });

  it('returns an empty list when there are none', async () => {
    expect(await findPermissionSetBuildFiles()).toStrictEqual([]);
  });
});
