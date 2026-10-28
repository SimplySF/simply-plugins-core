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

import { Duration } from '@salesforce/kit';
import type { InstallPackageDependenciesOptions } from '@simplysf/simply-package-core';
import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { installPackageDependencies, resolveUpgradedPackages, type PackageToInstall } from '../src/sfPackages.js';

const orgCreateMock = vi.hoisted(() => vi.fn());
const sfProjectResolveMock = vi.hoisted(() => vi.fn());
const installPackageDependenciesCoreMock = vi.hoisted(() => vi.fn());

vi.mock('execa');
vi.mock('@salesforce/core', () => ({
  Org: { create: orgCreateMock },
  SfProject: { resolve: sfProjectResolveMock },
}));
vi.mock('@simplysf/simply-package-core', () => ({ installPackageDependencies: installPackageDependenciesCoreMock }));
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

const devhubConfig = { packagingDevhub: 'packaging-devhub' };

const connection = { id: 'connection' };
const project = { id: 'project' };

/** @returns The options the library was called with on its `n`th call. */
function coreCallOptions(n = 0): InstallPackageDependenciesOptions {
  return (installPackageDependenciesCoreMock.mock.calls[n] as [InstallPackageDependenciesOptions])[0];
}

describe('installPackageDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgCreateMock.mockResolvedValue({ getConnection: () => connection });
    sfProjectResolveMock.mockResolvedValue(project);
    installPackageDependenciesCoreMock.mockResolvedValue([]);
  });

  it('installs in-process against the resolved org and project, auto-approving prompts', async () => {
    const results: PackageToInstall[] = [
      {
        PackageName: 'A',
        ExistingSubscriberPackageVersionId: '',
        SubscriberPackageVersionId: '04t1',
        Status: 'Installed',
      },
    ];
    installPackageDependenciesCoreMock.mockResolvedValueOnce(results);

    const returned = await installPackageDependencies({
      alias: 'my-org',
      wait: '240',
      installType: 'Delta',
      upgradeType: 'DeprecateOnly',
    });

    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'my-org' });
    expect(installPackageDependenciesCoreMock).toHaveBeenCalledTimes(1);
    const options = coreCallOptions();
    expect(options).toMatchObject({
      project,
      targetOrgConnection: connection,
      apexCompile: 'package',
      installType: 'Delta',
      upgradeType: 'DeprecateOnly',
    });
    expect(options.wait?.minutes).toBe(240);
    expect(options.prompts).toBeUndefined();
    expect(returned).toBe(results);
    expect(logger.success).toHaveBeenCalledWith('Packaged dependencies installed successfully.');
  });

  it('falls back to the default target org, a 120 minute wait, and a Mixed Upgrade install', async () => {
    await installPackageDependencies();

    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: undefined });
    const options = coreCallOptions();
    expect(options.installType).toBe('Upgrade');
    expect(options.upgradeType).toBe('Mixed');
    expect(options.wait?.minutes).toBe(Duration.minutes(120).minutes);
  });

  it('forwards library progress to the logger, de-duplicating repeated status updates', async () => {
    installPackageDependenciesCoreMock.mockImplementationOnce(
      async ({ progress }: InstallPackageDependenciesOptions) => {
        progress?.stepStart?.('Installing package A');
        progress?.stepStatus?.('10 minutes remaining');
        progress?.stepStatus?.('10 minutes remaining');
        progress?.stepStatus?.('9 minutes remaining');
        progress?.stepStop?.('Polling timeout exceeded');
        progress?.info?.('Package B is already installed and will be skipped');
        progress?.warn?.('careful');
        return [];
      },
    );

    await installPackageDependencies();

    expect(logger.info).toHaveBeenCalledWith('Installing package A');
    expect(vi.mocked(logger.info).mock.calls.filter(([message]) => message === '10 minutes remaining')).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith('9 minutes remaining');
    expect(logger.warn).toHaveBeenCalledWith('Polling timeout exceeded');
    expect(logger.info).toHaveBeenCalledWith('Package B is already installed and will be skipped');
    expect(logger.warn).toHaveBeenCalledWith('careful');
  });

  it('logs and rethrows a failed install', async () => {
    installPackageDependenciesCoreMock.mockRejectedValueOnce(new Error('install failed'));

    await expect(installPackageDependencies()).rejects.toThrow('install failed');

    expect(logger.error).toHaveBeenCalledWith('Failed to install packaged dependencies.');
  });
});

describe('resolveUpgradedPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array when nothing in the results upgraded an existing package', async () => {
    const result = await resolveUpgradedPackages(
      [
        { PackageName: 'A', ExistingSubscriberPackageVersionId: '', SubscriberPackageVersionId: '04t1', Status: '' },
        {
          PackageName: 'B',
          ExistingSubscriberPackageVersionId: '04t2',
          SubscriberPackageVersionId: '04t2',
          Status: 'Skipped',
        },
      ],
      devhubConfig,
    );

    expect(result).toEqual([]);
    expect(execa).not.toHaveBeenCalled();
  });

  it('returns an empty array and warns when no packaging DevHub alias is given', async () => {
    const result = await resolveUpgradedPackages(
      [
        {
          PackageName: 'A',
          ExistingSubscriberPackageVersionId: '04t1',
          SubscriberPackageVersionId: '04t2',
          Status: 'Installed',
        },
      ],
      {},
    );

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No --packaging-devhub given'));
  });

  it('builds an UpgradedPackage entry from the prev/target version reports', async () => {
    vi.mocked(execa).mockImplementation((async (_cmd: string, args: string[] = []) => {
      const packageId = args[args.indexOf('--package') + 1];
      const reports: Record<string, unknown> = {
        '04t1': { Version: '1.0.0.1', Tag: 'sha-prev' },
        '04t2': { Version: '1.1.0.1', Tag: 'sha-target', Description: 'https://gitlab.com/g/p/-/pipelines/1' },
      };
      return { stdout: JSON.stringify({ result: reports[packageId] }) };
    }) as never);

    const result = await resolveUpgradedPackages(
      [
        {
          PackageName: 'MyDependency',
          ExistingSubscriberPackageVersionId: '04t1',
          SubscriberPackageVersionId: '04t2',
          Status: 'Installed',
        },
      ],
      devhubConfig,
    );

    expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--target-dev-hub', 'packaging-devhub']));
    expect(result).toEqual([
      {
        packageName: 'MyDependency',
        prevVersionId: '04t1',
        prevVersionNumber: '1.0.0.1',
        prevTag: 'sha-prev',
        targetVersionId: '04t2',
        targetVersionNumber: '1.1.0.1',
        targetTag: 'sha-target',
        targetDescription: 'https://gitlab.com/g/p/-/pipelines/1',
      },
    ]);
  });

  it('skips a package whose version report could not be resolved', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('package not found'));

    const result = await resolveUpgradedPackages(
      [
        {
          PackageName: 'Broken',
          ExistingSubscriberPackageVersionId: '04t1',
          SubscriberPackageVersionId: '04t2',
          Status: 'Installed',
        },
      ],
      devhubConfig,
    );

    expect(result).toEqual([]);
  });
});
