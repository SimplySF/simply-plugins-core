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

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProject } from '../../src/vcs/index.js';
import { filterProject, generateMrDescription, resolvePackageDetails } from '../../src/sfdxDependabot/dependabotRun.js';

vi.mock('execa');
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

const packageQueryResult = {
  result: { records: [{ Name: 'lwc-utilities', MajorVersion: 2, MinorVersion: 41, PatchVersion: 0, BuildNumber: 1 }] },
};

describe('dependabotRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolvePackageDetails', () => {
    it('throws if devhubUsername is missing', async () => {
      await expect(resolvePackageDetails('', '04t123')).rejects.toThrow('Missing DevHub username');
    });

    it('throws if subscriberPackageVersionId is missing', async () => {
      await expect(resolvePackageDetails('hub@example.com', '')).rejects.toThrow(
        'Missing subscriber package version ID',
      );
    });

    it('parses and returns package details on successful query', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify(packageQueryResult) } as never);

      const details = await resolvePackageDetails('hub@example.com', '04tSJ000000AKwjYAG');
      expect(details).toEqual({ packageName: 'lwc-utilities', packageVersion: '2.41.0-1' });
      expect(execa).toHaveBeenCalledWith(
        'sf',
        expect.arrayContaining(['data', 'query', '-o', 'hub@example.com', '--use-tooling-api']),
      );
    });

    it('throws if query returns no records', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: JSON.stringify({ result: { records: [] } }) } as never);
      await expect(resolvePackageDetails('hub@example.com', '04tSJ000000AKwjYAG')).rejects.toThrow('No records found');
    });

    it('throws on query exception', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('SF CLI not found'));
      await expect(resolvePackageDetails('hub@example.com', '04tSJ000000AKwjYAG')).rejects.toThrow('SF CLI not found');
    });
  });

  describe('filterProject', () => {
    const baseProject: VcsProject = {
      id: 101,
      key: '101',
      name: 'downstream-repo',
      pathWithNamespace: 'my-group/downstream-repo',
      archived: false,
      empty: false,
      defaultBranch: 'main',
      isFork: false,
      raw: {},
    };

    it('keeps valid projects', () => {
      expect(filterProject(baseProject, { skipArchived: true, skipForks: true }).keep).toBe(true);
    });

    it('skips upstream repository by path', () => {
      const res = filterProject(baseProject, { upstreamProjectPath: 'my-group/downstream-repo' });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Upstream repository');
    });

    it('skips upstream repository by id', () => {
      const res = filterProject(baseProject, { upstreamProjectId: '101' });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Upstream repository');
    });

    it('skips archived project', () => {
      const res = filterProject({ ...baseProject, archived: true }, { skipArchived: true });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Archived project');
    });

    it('skips empty repository', () => {
      const res = filterProject({ ...baseProject, empty: true }, { skipArchived: true });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Empty repository or missing default branch');
    });

    it('skips forks', () => {
      const res = filterProject({ ...baseProject, isFork: true }, { skipArchived: true, skipForks: true });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Forked repository');
    });

    it('enforces allowlist', () => {
      const res = filterProject(baseProject, { allowlist: 'other-group/project,my-group/allowed' });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('Not in project allowlist');
    });

    it('keeps allowlist match', () => {
      expect(filterProject(baseProject, { allowlist: 'other-group/project,my-group/downstream-repo' }).keep).toBe(true);
    });

    it('enforces denylist', () => {
      const res = filterProject(baseProject, { denylist: 'my-group/downstream-repo,other-group/project' });
      expect(res.keep).toBe(false);
      expect(res.reason).toContain('In project denylist');
    });
  });

  describe('generateMrDescription', () => {
    it('formats correct markdown', () => {
      const md = generateMrDescription({
        packageName: 'lwc-utilities',
        oldVersions: ['2.40.0-10', '2.39.0-7'],
        packageVersion: '2.41.0-1',
        subscriberPackageVersionId: '04tSJ000000AKwjYAG',
      });
      expect(md).toContain('| Package                       | `lwc-utilities` |');
      expect(md).toContain('| Previous version              | `2.40.0-10, 2.39.0-7`  |');
      expect(md).toContain('| New version                   | `2.41.0-1`  |');
      expect(md).toContain('| Subscriber package version ID | `04tSJ000000AKwjYAG`       |');
    });

    it('defaults to merge-request wording', () => {
      const md = generateMrDescription({
        packageName: 'lwc-utilities',
        oldVersions: [],
        packageVersion: '2.41.0-1',
        subscriberPackageVersionId: '04tSJ000000AKwjYAG',
      });
      expect(md).toContain('This merge request updates a Salesforce 2GP package dependency.');
      expect(md).not.toContain('pull request');
    });

    it('adopts the provider vocabulary when given one', () => {
      const md = generateMrDescription({
        packageName: 'lwc-utilities',
        oldVersions: [],
        packageVersion: '2.41.0-1',
        subscriberPackageVersionId: '04tSJ000000AKwjYAG',
        changeRequest: 'pull request',
      });
      expect(md).toContain('This pull request updates a Salesforce 2GP package dependency.');
      expect(md).toContain('This pull request was generated automatically');
      expect(md).not.toContain('merge request');
    });
  });
});
