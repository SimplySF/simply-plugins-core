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

import { promises as fsPromises } from 'node:fs';
import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { addGitRemote } from '../../src/git.js';
import { logger } from '../../src/logger.js';
import { getPackageVersionReport } from '../../src/sfPackages.js';
import { createPackageVersion } from '../../src/build/createPackageVersion.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});
vi.mock('../../src/git.js', () => ({ addGitRemote: vi.fn() }));
vi.mock('../../src/sfPackages.js', () => ({ getPackageVersionReport: vi.fn() }));
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

const baseOptions = {
  ciCommitRefName: 'release/1.0',
  ciCommitSha: 'abc123',
  ciPipelineId: '999',
  ciPipelineUrl: 'https://gitlab.example.com/pipelines/999',
  ciProjectPath: 'group/project',
  projectAccessToken: 'secret-token',
  packagingDevhub: 'packaging-devhub',
  packageReleaseBranchPrefix: 'release/',
  vcsHost: 'gitlab.com',
  vcsProvider: 'gitlab' as const,
};

const sfdxProjectJson = {
  packageDirectories: [{ default: true, definitionFile: 'config/scratch-def.json', package: 'MyPackage' }],
};

function mockHappyPath(overrides: { coverage?: number; version?: string } = {}): void {
  vi.mocked(readSfdxProject).mockResolvedValue(sfdxProjectJson);
  vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
  vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
    if (
      cmd === 'sf' &&
      args[0] === 'package' &&
      args[1] === 'version' &&
      args[2] === 'create' &&
      args[3] === 'report'
    ) {
      return {
        stdout: JSON.stringify({ result: [{ Status: 'Success', SubscriberPackageVersionId: '04t000000000001' }] }),
      };
    }
    if (cmd === 'sf' && args[0] === 'package' && args[1] === 'version' && args[2] === 'create') {
      return { stdout: JSON.stringify({ result: { Id: '08c000000000001' } }) };
    }
    return { stdout: '' };
  }) as never);
  mockReport({ Version: overrides.version ?? '1.0.0.1', coverage: overrides.coverage ?? 90 });
}

function mockReport({ Version, coverage }: { Version: string; coverage: number | null }): void {
  vi.mocked(getPackageVersionReport).mockResolvedValue({
    Version,
    CodeCoverage: coverage === null ? null : { apexCodeCoveragePercentage: coverage },
  } as Awaited<ReturnType<typeof getPackageVersionReport>>);
}

describe('createPackageVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReport({ Version: '1.0.0.1', coverage: 90 });
  });

  it('should skip when the pipeline was triggered by a merge request', async () => {
    await createPackageVersion({ ...baseOptions, ciPipelineSource: 'merge_request_event' });

    expect(logger.info).toHaveBeenCalledWith('Not a release branch build. Skipping package creation.');
    expect(execa).not.toHaveBeenCalled();
  });

  it('should skip when not a release branch and alwaysCreatePackage is not set', async () => {
    await createPackageVersion({ ...baseOptions, ciCommitRefName: 'feature/foo', alwaysCreatePackage: false });

    expect(logger.info).toHaveBeenCalledWith(
      'Not a release branch build and alwaysCreatePackage is not TRUE. Skipping package creation.',
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it('should proceed on a non-release branch when alwaysCreatePackage is true', async () => {
    mockHappyPath();

    await createPackageVersion({ ...baseOptions, ciCommitRefName: 'feature/foo', alwaysCreatePackage: true });

    expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--target-dev-hub', baseOptions.packagingDevhub]));
    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.0.0.1-feature/foo', '-m', '04t000000000001']);
  });

  it('should create a package version, poll to completion, verify coverage, and tag/push on a release branch', async () => {
    mockHappyPath();

    await createPackageVersion(baseOptions);

    expect(addGitRemote).toHaveBeenCalledWith('999', 'secret-token', 'group/project', expect.anything());
    expect(execa).toHaveBeenCalledWith(
      'sf',
      expect.arrayContaining([
        'package',
        'version',
        'create',
        '--package',
        'MyPackage',
        '--definition-file',
        'config/scratch-def.json',
      ]),
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'subscriberPackageVersionId.env',
      'SUBSCRIBER_PACKAGE_VERSION_ID=04t000000000001',
    );
    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.0.0.1', '-m', '04t000000000001']);
    expect(execa).toHaveBeenCalledWith('git', ['push', 'origin-alias', 'v1.0.0.1']);
    expect(logger.success).toHaveBeenCalledWith('Successfully created and pushed git tag: v1.0.0.1');
  });

  it("should log the package Id aliased under the project's name", async () => {
    mockHappyPath();
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      name: 'MyPackage',
      packageAliases: { MyPackage: '0Ho000000000001', 'MyPackage@1.0.0-1': '04t000000000000' },
    });

    await createPackageVersion(baseOptions);

    expect(logger.info).toHaveBeenCalledWith('Package Id: 0Ho000000000001');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should warn but still create the package version when no alias matches the project's name", async () => {
    mockHappyPath();
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      name: 'MyProject',
      packageAliases: { MyPackage: '0Ho000000000001' },
    });

    await createPackageVersion(baseOptions);

    expect(logger.warn).toHaveBeenCalledWith(
      'No package Id found in packageAliases for project name "MyProject" in sfdx-project.json',
    );
    expect(logger.success).toHaveBeenCalledWith('Successfully created and pushed git tag: v1.0.0.1');
  });

  it('should warn when sfdx-project.json has no name', async () => {
    mockHappyPath();
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      packageAliases: { MyPackage: '0Ho000000000001' },
    });

    await createPackageVersion(baseOptions);

    expect(logger.warn).toHaveBeenCalledWith(
      'No package Id found in packageAliases for project name "" in sfdx-project.json',
    );
  });

  it('should suffix the version tag with the branch attribute for branched packages', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [
        { default: true, definitionFile: 'config/scratch-def.json', package: 'MyPackage', branch: 'feature-branch' },
      ],
    });
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create' && args[3] === 'report') {
        return {
          stdout: JSON.stringify({ result: [{ Status: 'Success', SubscriberPackageVersionId: '04t000000000001' }] }),
        };
      }
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create') {
        return { stdout: JSON.stringify({ result: { Id: '08c000000000001' } }) };
      }
      return { stdout: '' };
    }) as never);

    await createPackageVersion(baseOptions);

    expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--branch', 'feature-branch']));
    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.0.0.1-feature-branch', '-m', '04t000000000001']);
  });

  it('should poll until the report status is no longer InProgress', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue(sfdxProjectJson);
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
    let reportCalls = 0;
    vi.useFakeTimers();
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create' && args[3] === 'report') {
        reportCalls += 1;
        if (reportCalls < 2) return { stdout: JSON.stringify({ result: [{ Status: 'InProgress' }] }) };
        return {
          stdout: JSON.stringify({ result: [{ Status: 'Success', SubscriberPackageVersionId: '04t000000000001' }] }),
        };
      }
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create') {
        return { stdout: JSON.stringify({ result: { Id: '08c000000000001' } }) };
      }
      return { stdout: '' };
    }) as never);

    const promise = createPackageVersion(baseOptions);
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(reportCalls).toBe(2);
  });

  it('should throw when the package version creation report status is Error', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue(sfdxProjectJson);
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create' && args[3] === 'report') {
        return { stdout: JSON.stringify({ result: [{ Status: 'Error', Error: 'boom' }] }) };
      }
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create') {
        return { stdout: JSON.stringify({ result: { Id: '08c000000000001' } }) };
      }
      return { stdout: '' };
    }) as never);

    await expect(createPackageVersion(baseOptions)).rejects.toThrow('Package creation failed: boom');
  });

  it('should throw when code coverage is below the required minimum', async () => {
    mockHappyPath({ coverage: 50 });

    await expect(createPackageVersion({ ...baseOptions, codeCoverageMinimum: '75' })).rejects.toThrow(
      'Code coverage of 50% is less than the required minimum of 75%.',
    );
    expect(execa).not.toHaveBeenCalledWith('git', expect.arrayContaining(['tag']));
  });

  it("should prefer the project's own minimum coverage requirement over --code-coverage-minimum", async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      plugins: { simply: { coverageRequirement: { minimumCoverageRequired: '95' } } },
    });
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create' && args[3] === 'report') {
        return {
          stdout: JSON.stringify({ result: [{ Status: 'Success', SubscriberPackageVersionId: '04t000000000001' }] }),
        };
      }
      if (args[0] === 'package' && args[1] === 'version' && args[2] === 'create') {
        return { stdout: JSON.stringify({ result: { Id: '08c000000000001' } }) };
      }
      return { stdout: '' };
    }) as never);

    await expect(createPackageVersion({ ...baseOptions, codeCoverageMinimum: '75' })).rejects.toThrow(
      'Code coverage of 90% is less than the required minimum of 95%.',
    );
  });

  it('should not fail the coverage minimum when the Dev Hub reports no coverage (org-dependent package)', async () => {
    mockHappyPath();
    mockReport({ Version: '1.0.0.1', coverage: null });

    await expect(createPackageVersion({ ...baseOptions, codeCoverageMinimum: '75' })).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('Actual code coverage: N/A%. Required minimum: 75%.');
  });

  it('should ask the packaging Dev Hub for the new version report', async () => {
    mockHappyPath();

    await createPackageVersion(baseOptions);

    expect(getPackageVersionReport).toHaveBeenCalledWith('04t000000000001', baseOptions.packagingDevhub);
  });

  it('should throw when the default package directory is missing package or definitionFile', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');

    await expect(createPackageVersion(baseOptions)).rejects.toThrow(
      '`package` and `definitionFile` must be specified in the default package directory in sfdx-project.json',
    );
  });

  it("should tag in the project's version tag format when one is declared", async () => {
    mockHappyPath({ version: '1.2.3.4' });
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      plugins: { simply: { versionTagFormat: '{MAJOR}.{MINOR}.{PATCH}+{BUILD}' } },
    });

    await createPackageVersion(baseOptions);

    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', '1.2.3+4', '-m', '04t000000000001']);
    expect(execa).toHaveBeenCalledWith('git', ['push', 'origin-alias', '1.2.3+4']);
  });

  it("should append a non-release build's ref after the formatted version", async () => {
    mockHappyPath({ version: '1.2.3.4' });
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      plugins: { simply: { versionTagFormat: 'v{MAJOR}.{MINOR}.{PATCH}-{BUILD}' } },
    });

    await createPackageVersion({ ...baseOptions, ciCommitRefName: 'feature/x', alwaysCreatePackage: true });

    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.2.3-4-feature/x', '-m', '04t000000000001']);
  });

  it('should reject an invalid version tag format before creating a package version', async () => {
    mockHappyPath();
    vi.mocked(readSfdxProject).mockResolvedValue({
      ...sfdxProjectJson,
      plugins: { simply: { versionTagFormat: '{MAJOR}.{MINOR}.{PATCH}' } },
    });

    await expect(createPackageVersion(baseOptions)).rejects.toThrow('{BUILD} must appear exactly once, found 0');
    expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['create']));
  });
});
