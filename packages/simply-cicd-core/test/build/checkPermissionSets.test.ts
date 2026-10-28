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
import { generatePermissionSets, loadPermissionSetBuildFile } from '@simplysf/simply-permissions-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheckPermissionSets } from '../../src/build/checkPermissionSets.js';
import { logger } from '../../src/logger.js';

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));

const NS = 'xmlns="http://soap.sforce.com/2006/04/metadata"';
const OUTPUT = 'force-app/main/default/permissionsets';

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A `Widget__c` object with one text field under `force-app`. */
function writeSource(): void {
  write(
    'force-app/main/default/objects/Widget__c/Widget__c.object-meta.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject ${NS}><label>Widget</label><pluralLabel>Widgets</pluralLabel><nameField><label>Name</label><type>Text</type></nameField><deploymentStatus>Deployed</deploymentStatus><sharingModel>ReadWrite</sharingModel></CustomObject>\n`,
  );
  writeField('Color__c');
}

function writeField(name: string): void {
  write(
    `force-app/main/default/objects/Widget__c/fields/${name}.field-meta.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField ${NS}><fullName>${name}</fullName><label>${name}</label><type>Text</type><length>40</length><required>false</required></CustomField>\n`,
  );
}

/** Writes a permission set build file for a `modify-all` permission set named `name`. */
function writeBuildFile(file: string, name: string, settings: Record<string, unknown> = {}): void {
  write(file, JSON.stringify({ name, type: 'modify-all', directory: 'force-app', output: OUTPUT, ...settings }));
}

/** Generates the permission set `file` defines, as `simply permissions build` would. */
async function generate(file: string): Promise<void> {
  await generatePermissionSets([await loadPermissionSetBuildFile(file)]);
}

const xmlPath = (name: string): string => path.join(OUTPUT, `${name}.permissionset-meta.xml`);

describe('checkPermissionSets', () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-permission-sets-'));
    process.chdir(root);
    writeSource();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('runCheckPermissionSets', () => {
    it('skips when disabled', async () => {
      writeBuildFile('app.psbuild.json', 'A');

      expect(await runCheckPermissionSets({ disabled: true })).toStrictEqual({ skipped: true, files: [] });
      expect(logger.warn).toHaveBeenCalledWith('check-permission-sets is disabled. Skipping.');
    });

    it('skips when the repo has no permission set build files', async () => {
      expect(await runCheckPermissionSets({})).toStrictEqual({ skipped: true, files: [] });
      expect(logger.warn).toHaveBeenCalledWith('No permission set build files found. Skipping.');
    });

    it('succeeds when every permission set is up to date, resolving paths against the current directory', async () => {
      writeBuildFile('config/app-admin.psbuild.json', 'App_Admin');
      writeBuildFile('config/app-support.psbuild.json', 'App_Support');
      await generate('config/app-admin.psbuild.json');
      await generate('config/app-support.psbuild.json');

      const result = await runCheckPermissionSets({});

      expect(result.skipped).toBe(false);
      expect(
        result.files.map(({ file, permissionSet: { name, path: p, status } }) => ({ file, name, path: p, status })),
      ).toStrictEqual([
        { file: 'config/app-admin.psbuild.json', name: 'App_Admin', path: xmlPath('App_Admin'), status: 'up-to-date' },
        {
          file: 'config/app-support.psbuild.json',
          name: 'App_Support',
          path: xmlPath('App_Support'),
          status: 'up-to-date',
        },
      ]);
      expect(logger.success).toHaveBeenLastCalledWith('All 2 permission set(s) are up to date.');
    });

    it('applies config overrides named after permission set metadata', async () => {
      writeBuildFile('app.psbuild.json', 'A', {
        config: { objectPermissions: { Widget__c: { allowDelete: false } } },
      });
      await generate('app.psbuild.json');

      const xml = fs.readFileSync(xmlPath('A'), 'utf8');
      expect(xml).toContain('<allowDelete>false</allowDelete>');
      expect(xml).toMatch(/<viewAllFields>.*<\/viewAllFields>\s*<viewAllRecords>/);
      const result = await runCheckPermissionSets({});
      expect(result.files[0].permissionSet.status).toBe('up-to-date');
    });

    it('checks every file before failing, naming each stale permission set, its file, and the command that fixes them', async () => {
      writeBuildFile('a/admin.psbuild.json', 'A_Admin');
      writeBuildFile('a/missing.psbuild.json', 'A_Missing');
      writeBuildFile('b/admin.psbuild.json', 'B_Admin');
      await generate('a/admin.psbuild.json');
      await generate('a/missing.psbuild.json');
      await generate('b/admin.psbuild.json');
      fs.rmSync(xmlPath('A_Missing'));
      writeField('Size__c');
      const before = fs.readFileSync(xmlPath('B_Admin'), 'utf8');

      await expect(runCheckPermissionSets({})).rejects.toThrow(
        '3 of 3 permission set(s) have drifted from their source metadata or are missing.',
      );

      expect(logger.error).toHaveBeenCalledWith(`A_Admin drifted ${xmlPath('A_Admin')} (a/admin.psbuild.json)`);
      expect(logger.error).toHaveBeenCalledWith(`A_Missing missing ${xmlPath('A_Missing')} (a/missing.psbuild.json)`);
      expect(logger.error).toHaveBeenCalledWith(`B_Admin drifted ${xmlPath('B_Admin')} (b/admin.psbuild.json)`);
      expect(logger.log).toHaveBeenCalledWith('Regenerate with: sf simply permissions build');
      // Nothing written: the missing file stays missing and the drifted one keeps its old content.
      expect(fs.existsSync(xmlPath('A_Missing'))).toBe(false);
      expect(fs.readFileSync(xmlPath('B_Admin'), 'utf8')).toBe(before);
    });

    it('fails on an invalid file, naming it, before checking any permission set', async () => {
      writeBuildFile('a/app.psbuild.json', 'A', { output: undefined });
      writeBuildFile('b/app.psbuild.json', 'B');

      await expect(runCheckPermissionSets({})).rejects.toThrow(
        /^Permission set build file a\/app\.psbuild\.json: The configuration file a\/app\.psbuild\.json is invalid: /,
      );

      expect(logger.info).toHaveBeenCalledWith('Loading permission set build file a/app.psbuild.json...');
      expect(logger.info).not.toHaveBeenCalledWith('Loading permission set build file b/app.psbuild.json...');
    });

    it('names the file when a source directory is missing', async () => {
      writeBuildFile('app.psbuild.json', 'A', { directory: 'nope' });

      await expect(runCheckPermissionSets({})).rejects.toThrow(
        'Permission set build file app.psbuild.json: The source directory nope for permission set A does not exist.',
      );
    });

    it('rejects a file in the old permissionSets list format with migration instructions', async () => {
      write('app.psbuild.json', JSON.stringify({ permissionSets: [{ name: 'A', type: 'read-only' }] }));

      await expect(runCheckPermissionSets({})).rejects.toThrow(
        'Permission set build file app.psbuild.json: app.psbuild.json uses the old format, a "permissionSets" list, which is no longer supported.',
      );
    });

    it('fails when two files define the same permission set, before checking anything', async () => {
      writeBuildFile('a/app.psbuild.json', 'A');
      writeBuildFile('b/app.psbuild.json', 'A');

      await expect(runCheckPermissionSets({})).rejects.toThrow(
        'Permission set A is defined by both a/app.psbuild.json and b/app.psbuild.json. Each permission set must be defined by exactly one .psbuild.json file.',
      );
    });
  });
});
