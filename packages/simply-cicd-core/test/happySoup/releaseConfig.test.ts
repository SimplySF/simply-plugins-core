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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applicationsForTeam,
  findReleaseConfigFile,
  findReleaseTeam,
  loadReleaseConfig,
  parseReleaseConfig,
} from '../../src/happySoup/releaseConfig.js';

let root: string;

function write(relative: string, content: unknown): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-config-test-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('parseReleaseConfig', () => {
  it('applies every default to an empty file', () => {
    expect(parseReleaseConfig({})).toEqual({
      teams: [],
      applications: [],
      productionBranch: 'environment/production',
      deploymentStepsTemplate: 'xdocs/deployment-steps-template.md',
      deploymentConfigsTemplate: 'xdocs/deployment-configs-template.json',
    });
  });

  it('accepts teams and applications as arrays of names or objects', () => {
    const config = parseReleaseConfig({
      $schema: './release.schema.json',
      teams: [
        'ops',
        {
          name: 'platform',
          label: 'Platform',
          applications: ['core', { name: 'portal', label: 'Portal', description: 'Customer portal' }],
        },
      ],
      applications: ['shared'],
    });

    expect(config.teams).toEqual([
      { name: 'ops', applications: [] },
      {
        name: 'platform',
        label: 'Platform',
        applications: [{ name: 'core' }, { name: 'portal', label: 'Portal', description: 'Customer portal' }],
      },
    ]);
    expect(config.applications).toEqual([{ name: 'shared' }]);
  });

  it('accepts teams and applications as records keyed by name', () => {
    const config = parseReleaseConfig({
      teams: {
        platform: { label: 'Platform', applications: { core: { label: 'Core' }, portal: {} } },
        data: ['etl', { name: 'warehouse' }],
        ops: {},
      },
    });

    expect(config.teams).toEqual([
      { name: 'platform', label: 'Platform', applications: [{ name: 'core', label: 'Core' }, { name: 'portal' }] },
      { name: 'data', applications: [{ name: 'etl' }, { name: 'warehouse' }] },
      { name: 'ops', label: undefined, applications: [] },
    ]);
  });

  it('keeps the fields it knows and lets unknown keys pass', () => {
    const config = parseReleaseConfig({
      productionBranch: 'main',
      deploymentStepsTemplate: 'docs/steps.md',
      deploymentConfigsTemplate: 'docs/configs.json',
      somethingElse: true,
    });

    expect(config).toMatchObject({
      productionBranch: 'main',
      deploymentStepsTemplate: 'docs/steps.md',
      deploymentConfigsTemplate: 'docs/configs.json',
    });
  });

  it('names each invalid field and the source', () => {
    expect(() => parseReleaseConfig({ productionBranch: '', teams: 5 }, 'config/release.json')).toThrow(
      /config\/release\.json is invalid:\n {2}- (teams|productionBranch): [\s\S]*\n {2}- (teams|productionBranch): /,
    );
  });
});

describe('findReleaseConfigFile', () => {
  it('prefers config/release.json, then release.json, searching upward to the boundary', () => {
    const nested = path.join(root, 'repo', 'force-app', 'main');
    fs.mkdirSync(nested, { recursive: true });
    const repo = path.join(root, 'repo');

    expect(findReleaseConfigFile(nested, undefined, repo)).toBeUndefined();

    const rootLevel = write('repo/release.json', {});
    expect(findReleaseConfigFile(nested, undefined, repo)).toBe(rootLevel);

    const preferred = write('repo/config/release.json', {});
    expect(findReleaseConfigFile(nested, undefined, repo)).toBe(preferred);
  });

  it("doesn't search above the boundary", () => {
    write('config/release.json', {});
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);

    expect(findReleaseConfigFile(repo, undefined, repo)).toBeUndefined();
  });

  it('uses an explicit path, and refuses one that does not exist', () => {
    const custom = write('settings/release-settings.json', {});

    expect(findReleaseConfigFile(root, 'settings/release-settings.json')).toBe(custom);
    expect(() => findReleaseConfigFile(root, 'missing.json')).toThrow('Release configuration file not found');
  });
});

describe('loadReleaseConfig', () => {
  it('returns the defaults and no path when there is no file', () => {
    expect(loadReleaseConfig({ cwd: root, stopAt: root })).toEqual({ config: parseReleaseConfig({}) });
  });

  it('reads and validates the file it finds', () => {
    const file = write('config/release.json', { productionBranch: 'main' });

    expect(loadReleaseConfig({ cwd: root, stopAt: root })).toMatchObject({
      path: file,
      config: { productionBranch: 'main' },
    });
  });

  it('refuses a file that is not JSON, naming it', () => {
    const file = write('config/release.json', '{ not json');

    expect(() => loadReleaseConfig({ cwd: root, stopAt: root })).toThrow(`${file} is not valid JSON`);
  });
});

describe('team and application lookup', () => {
  const config = parseReleaseConfig({
    teams: [{ name: 'Platform', applications: ['core'] }, 'ops'],
    applications: ['shared'],
  });

  it('matches a team ignoring case', () => {
    expect(findReleaseTeam(config, 'platform')?.name).toBe('Platform');
    expect(findReleaseTeam(config, 'unknown')).toBeUndefined();
  });

  it("offers a team's own applications, else the top-level list", () => {
    expect(applicationsForTeam(config, findReleaseTeam(config, 'platform'))).toEqual([{ name: 'core' }]);
    expect(applicationsForTeam(config, findReleaseTeam(config, 'ops'))).toEqual([{ name: 'shared' }]);
    expect(applicationsForTeam(config, undefined)).toEqual([{ name: 'shared' }]);
  });
});
