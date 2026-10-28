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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import {
  getPackageVersionCreateStatus,
  getPackageVersionReport,
  installPackageDependencies,
  listInstalledPackages,
  requestPackageVersionCreate,
  resolveUpgradedPackages,
  type PackageToInstall,
} from '../src/sfPackages.js';

const resolveOrgMock = vi.hoisted(() => vi.fn());
const sfProjectResolveMock = vi.hoisted(() => vi.fn());
const installPackageDependenciesCoreMock = vi.hoisted(() => vi.fn());
const packageVersionCtorMock = vi.hoisted(() => vi.fn());
const packageVersionReportMock = vi.hoisted(() => vi.fn());
const installedListMock = vi.hoisted(() => vi.fn());
const packageVersionCreateMock = vi.hoisted(() => vi.fn());
const getCreateStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../src/resolveOrg.js', () => ({ resolveOrg: resolveOrgMock }));
vi.mock('@salesforce/packaging', () => ({
  PackageVersion: class {
    public static create = packageVersionCreateMock;
    public static getCreateStatus = getCreateStatusMock;
    private readonly idOrAlias: string;
    public constructor(options: { idOrAlias: string }) {
      packageVersionCtorMock(options);
      this.idOrAlias = options.idOrAlias;
    }
    public report(): Promise<unknown> {
      return packageVersionReportMock(this.idOrAlias) as Promise<unknown>;
    }
  },
  SubscriberPackageVersion: { installedList: installedListMock },
}));
vi.mock('@salesforce/core', () => ({
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
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
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

    expect(resolveOrgMock).toHaveBeenCalledWith('my-org');
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

    expect(resolveOrgMock).toHaveBeenCalledWith(undefined);
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

describe('getPackageVersionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
  });

  it('reports the version through the Dev Hub connection', async () => {
    packageVersionReportMock.mockResolvedValue({ Version: '1.2.3.4', Tag: 'sha' });

    const report = await getPackageVersionReport('04t1', 'packaging-devhub');

    expect(resolveOrgMock).toHaveBeenCalledWith('packaging-devhub', { isDevHub: true });
    expect(packageVersionCtorMock).toHaveBeenCalledWith({ connection, project: undefined, idOrAlias: '04t1' });
    expect(report).toEqual({ Version: '1.2.3.4', Tag: 'sha' });
  });

  it('propagates a failure to resolve the Dev Hub', async () => {
    resolveOrgMock.mockRejectedValue(new Error('No authorization information found for packaging-devhub.'));

    await expect(getPackageVersionReport('04t1', 'packaging-devhub')).rejects.toThrow('No authorization information');
  });
});

describe('requestPackageVersionCreate', () => {
  const options = {
    devHubAliasOrUsername: 'packaging-devhub',
    packageId: 'MyPackage',
    definitionFile: 'config/scratch-def.json',
    versionDescription: 'https://ci.example.com/pipelines/1',
    tag: 'abc123',
    branch: 'feature-x',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
    sfProjectResolveMock.mockResolvedValue(project);
    packageVersionCreateMock.mockResolvedValue({ Id: '08c000000000001', Status: 'Queued' });
    delete process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT;
  });

  it('starts the create with the options sf package version create sends, without waiting', async () => {
    const result = await requestPackageVersionCreate(options);

    expect(resolveOrgMock).toHaveBeenCalledWith('packaging-devhub', { isDevHub: true });
    const [createOptions, polling] = packageVersionCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      { timeout: Duration; frequency: Duration },
    ];
    expect(createOptions).toEqual({
      connection,
      project,
      packageId: 'MyPackage',
      definitionfile: 'config/scratch-def.json',
      versiondescription: 'https://ci.example.com/pipelines/1',
      tag: 'abc123',
      branch: 'feature-x',
      codecoverage: true,
      installationkeybypass: true,
    });
    expect(polling.timeout.minutes).toBe(0);
    expect(result).toEqual({ Id: '08c000000000001', Status: 'Queued' });
  });

  it('applies string replacements during the create only, as the CLI does', async () => {
    packageVersionCreateMock.mockImplementation(async () => {
      expect(process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT).toBe('true');
      return { Id: '08c000000000001' };
    });

    await requestPackageVersionCreate(options);

    expect(process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT).toBeUndefined();
  });

  it('restores a pre-existing replacements setting, even when the create fails', async () => {
    process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT = 'false';
    packageVersionCreateMock.mockRejectedValue(new Error('Package2 not found'));

    await expect(requestPackageVersionCreate(options)).rejects.toThrow('Package2 not found');
    expect(process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT).toBe('false');
    delete process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT;
  });
});

describe('getPackageVersionCreateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
  });

  it("returns the request's status from the Dev Hub", async () => {
    getCreateStatusMock.mockResolvedValue({ Id: '08c000000000001', Status: 'InProgress', Error: [] });

    const status = await getPackageVersionCreateStatus('08c000000000001', 'packaging-devhub');

    expect(resolveOrgMock).toHaveBeenCalledWith('packaging-devhub', { isDevHub: true });
    expect(getCreateStatusMock).toHaveBeenCalledWith('08c000000000001', connection);
    expect(status).toEqual({ Id: '08c000000000001', Status: 'InProgress', Error: [] });
  });
});

describe('listInstalledPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
  });

  it('shapes rows like sf package installed list --json, joining the version number', async () => {
    installedListMock.mockResolvedValue([
      {
        Id: '0A3000000000001',
        SubscriberPackageId: '033000000000001',
        SubscriberPackage: { Name: 'my-pkg', NamespacePrefix: 'ns' },
        SubscriberPackageVersion: {
          Id: '04t000000000001',
          Name: 'Spring',
          MajorVersion: 2,
          MinorVersion: 40,
          PatchVersion: 0,
          BuildNumber: 10,
        },
      },
      { Id: '0A3000000000002', SubscriberPackageId: '033000000000002' },
    ]);

    const installed = await listInstalledPackages('my-org');

    expect(resolveOrgMock).toHaveBeenCalledWith('my-org');
    expect(installedListMock).toHaveBeenCalledWith(connection);
    expect(installed).toEqual([
      {
        Id: '0A3000000000001',
        SubscriberPackageId: '033000000000001',
        SubscriberPackageName: 'my-pkg',
        SubscriberPackageNamespace: 'ns',
        SubscriberPackageVersionId: '04t000000000001',
        SubscriberPackageVersionName: 'Spring',
        SubscriberPackageVersionNumber: '2.40.0.10',
      },
      { Id: '0A3000000000002', SubscriberPackageId: '033000000000002' },
    ]);
  });
});

describe('resolveUpgradedPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection });
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
    expect(packageVersionReportMock).not.toHaveBeenCalled();
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
    const reports: Record<string, unknown> = {
      '04t1': { Version: '1.0.0.1', Tag: 'sha-prev' },
      '04t2': { Version: '1.1.0.1', Tag: 'sha-target', Description: 'https://gitlab.com/g/p/-/pipelines/1' },
    };
    packageVersionReportMock.mockImplementation(async (id: string) => reports[id]);

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

    expect(resolveOrgMock).toHaveBeenCalledWith('packaging-devhub', { isDevHub: true });
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
    packageVersionReportMock.mockRejectedValue(new Error('package not found'));

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
