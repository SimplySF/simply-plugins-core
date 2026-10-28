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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { getAlmProjectKeys, getPackageOriginOverride } from '../src/sfConfig.js';

vi.mock('node:fs');
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

function stubConfig(config: unknown): void {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
}

describe('getAlmProjectKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the passed key when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
    expect(getAlmProjectKeys()).toEqual([]);
  });

  it('merges and deduplicates the single and multiple alm fields', () => {
    stubConfig({ almProjectKey: 'PROJ', almProjectKeys: ['PROJ', 'PLAT'] });

    expect(getAlmProjectKeys('IGNORED')).toEqual(['PROJ', 'PLAT']);
  });

  it('reads the legacy jira fields and warns about them', () => {
    stubConfig({ jiraProjectKey: 'LEGACY', jiraProjectKeys: ['LEGACY', 'OLD'] });

    expect(getAlmProjectKeys()).toEqual(['LEGACY', 'OLD']);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('"jiraProjectKey" and "jiraProjectKeys" are deprecated');
  });

  it('prefers the alm fields outright when both are present, without merging', () => {
    stubConfig({ almProjectKey: 'NEW', jiraProjectKey: 'LEGACY', jiraProjectKeys: ['ALSO-LEGACY'] });

    expect(getAlmProjectKeys()).toEqual(['NEW']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the passed key when the config has neither field', () => {
    stubConfig({ somethingElse: true });

    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('ignores an unreadable or malformed config file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not json');

    expect(getAlmProjectKeys('PASSED')).toEqual(['PASSED']);
  });
});

describe('getPackageOriginOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

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

  it('ignores an unreadable or malformed config file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not json');

    expect(getPackageOriginOverride('MyPackage')).toBeUndefined();
  });
});
