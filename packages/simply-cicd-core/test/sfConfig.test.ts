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
import { SFDEVRC_ENV_VARS, SfDevRcError } from '@simplysf/simply-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { getAlmProjectKeys, getPackageOriginOverride, loadCicdSfDevRc } from '../src/sfConfig.js';

vi.mock('../src/logger.js', () => ({
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

let projectDir: string;

function stubConfig(config: unknown): void {
  fs.writeFileSync(
    path.join(projectDir, '.sfdevrc.json'),
    typeof config === 'string' ? config : JSON.stringify(config),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-sfdevrc-'));
  vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
  // Keep tests that use the `process.env` default independent of the machine's environment.
  for (const name of Object.values(SFDEVRC_ENV_VARS)) {
    vi.stubEnv(name, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('loadCicdSfDevRc', () => {
  it('validates the cicd-owned sections and keeps other consumers’ sections', () => {
    stubConfig({ deploymentPlugins: ['p1'], setup: { include: ['core'] }, vcs: { provider: 'github' } });

    expect(loadCicdSfDevRc().config).toEqual({
      deploymentPlugins: ['p1'],
      setup: { include: ['core'] },
      vcs: { provider: 'github' },
    });
  });

  it('rejects a malformed packageOriginOverrides entry', () => {
    stubConfig({ packageOriginOverrides: { Pkg: { vcsProvider: 'bitbucket', projectPath: 'a/b' } } });

    expect(() => loadCicdSfDevRc()).toThrow(/packageOriginOverrides\.Pkg\.vcsProvider/);
  });

  it('routes deprecation warnings through the cicd logger', () => {
    stubConfig({ gitlabProjectId: '1' });

    loadCicdSfDevRc();

    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('"gitlabProjectId" is deprecated');
  });

  it('overlays the SIMPLY_* environment variables onto the file', () => {
    stubConfig({ vcs: { provider: 'gitlab', host: 'gitlab.example.com' }, deploymentPlugins: ['p1'] });

    expect(loadCicdSfDevRc(projectDir, { SIMPLY_VCS_HOST: 'other.example.com' }).config).toEqual({
      vcs: { provider: 'gitlab', host: 'other.example.com' },
      deploymentPlugins: ['p1'],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['SIMPLY_CICD_VCS_PROVIDER', 'github'],
    ['SIMPLY_CICD_VCS_HOST', 'gitlab.example.com'],
    ['SIMPLY_CICD_ALM_PROVIDER', 'gitlab-issues'],
    ['SIMPLY_CICD_ALM_PROJECT_KEY', 'ABC'],
    ['SIMPLY_CICD_ALM_BASE_URL', 'https://example.atlassian.net/browse'],
  ])('does not read the old plugin-specific name %s', (name, value) => {
    expect(loadCicdSfDevRc(projectDir, { [name]: value }).config).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('getAlmProjectKeys', () => {
  it('falls back to the passed key when no config file exists', () => {
    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
    expect(getAlmProjectKeys()).toEqual([]);
  });

  it('reads alm.projectKeys when no key is passed', () => {
    stubConfig({ alm: { provider: 'jira', projectKeys: ['PROJ', 'PROJ', 'PLAT'] } });

    expect(getAlmProjectKeys()).toEqual(['PROJ', 'PLAT']);
  });

  it('lets the passed key win over the config file', () => {
    stubConfig({ alm: { projectKeys: ['PROJ'] } });

    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
  });

  it('merges and deduplicates the legacy single and multiple alm fields', () => {
    stubConfig({ almProjectKey: 'PROJ', almProjectKeys: ['PROJ', 'PLAT'] });

    expect(getAlmProjectKeys()).toEqual(['PROJ', 'PLAT']);
  });

  it('reads the legacy jira fields and warns about them', () => {
    stubConfig({ jiraProjectKey: 'LEGACY', jiraProjectKeys: ['LEGACY', 'OLD'] });

    expect(getAlmProjectKeys()).toEqual(['LEGACY', 'OLD']);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('"jiraProjectKey" and "jiraProjectKeys" are deprecated');
  });

  it('prefers the alm fields outright when both legacy sets are present, without merging', () => {
    stubConfig({ almProjectKey: 'NEW', jiraProjectKey: 'LEGACY', jiraProjectKeys: ['ALSO-LEGACY'] });

    expect(getAlmProjectKeys()).toEqual(['NEW']);
  });

  it('falls back to the passed key when the config has no alm keys', () => {
    stubConfig({ somethingElse: true });

    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws for a malformed config file instead of ignoring it', () => {
    stubConfig('{ not json');

    expect(() => getAlmProjectKeys('PASSED')).toThrow(SfDevRcError);
  });
});

describe('getPackageOriginOverride', () => {
  it('returns undefined when no config file exists', () => {
    expect(getPackageOriginOverride('MyPackage')).toBeUndefined();
  });

  it('returns undefined when the package has no override entry', () => {
    stubConfig({ packageOriginOverrides: { OtherPackage: { vcsProvider: 'gitlab', projectPath: 'group/other' } } });

    expect(getPackageOriginOverride('MyPackage')).toBeUndefined();
  });

  it('returns the matching override entry', () => {
    stubConfig({
      packageOriginOverrides: {
        MyPackage: { vcsProvider: 'github', host: 'github.example.com', projectPath: 'vendor/my-package' },
      },
    });

    expect(getPackageOriginOverride('MyPackage')).toEqual({
      vcsProvider: 'github',
      host: 'github.example.com',
      projectPath: 'vendor/my-package',
    });
  });

  it('uses an already-loaded config without reading the file', () => {
    const config = { packageOriginOverrides: { MyPackage: { vcsProvider: 'gitlab' as const, projectPath: 'g/p' } } };
    stubConfig('{ not json');

    expect(getPackageOriginOverride('MyPackage', config)).toEqual({ vcsProvider: 'gitlab', projectPath: 'g/p' });
  });

  it('throws for a malformed config file instead of ignoring it', () => {
    stubConfig('{ not json');

    expect(() => getPackageOriginOverride('MyPackage')).toThrow(SfDevRcError);
  });
});
