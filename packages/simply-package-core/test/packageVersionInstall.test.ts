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

import { Connection, SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { PackagingSObjects, SubscriberPackageVersion } from '@salesforce/packaging';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPackageVersion } from '../src/packageVersionInstall.js';

const VERSION_ID = '04t000000000001AAA';

function connection(apiVersion = '62.0'): Connection {
  return { getApiVersion: () => apiVersion } as unknown as Connection;
}

function installRequest(overrides: Partial<PackagingSObjects.PackageInstallRequest> = {}) {
  return { Id: '0Hf000000000001', Status: 'SUCCESS', ...overrides } as PackagingSObjects.PackageInstallRequest;
}

describe('installPackageVersion', () => {
  const sandbox = sinon.createSandbox();
  let install: sinon.SinonStub;
  let getExternalSites: sinon.SinonStub;

  beforeEach(() => {
    sandbox.stub(SubscriberPackageVersion.prototype, 'getId').resolves(VERSION_ID);
    getExternalSites = sandbox.stub(SubscriberPackageVersion.prototype, 'getExternalSites').resolves(undefined);
    install = sandbox.stub(SubscriberPackageVersion.prototype, 'install').resolves(installRequest());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('sends the request sf package install sends by default, and reports success', async () => {
    const result = await installPackageVersion({
      targetOrgConnection: connection(),
      aliasOrId: VERSION_ID,
      wait: Duration.minutes(120),
    });

    expect(result).toEqual({ status: 'SUCCESS', request: installRequest() });
    const [request, options] = install.firstCall.args as [Record<string, unknown>, Record<string, Duration>];
    expect(request).toEqual({
      SubscriberPackageVersionKey: VERSION_ID,
      Password: undefined,
      ApexCompileType: 'all',
      SecurityType: 'none',
      UpgradeType: 'mixed-mode',
    });
    expect(options.pollingTimeout.minutes).toBe(120);
    expect(options.pollingFrequency.seconds).toBe(2);
  });

  it('maps apex compile, security and upgrade type overrides onto the API values', async () => {
    await installPackageVersion({
      targetOrgConnection: connection(),
      aliasOrId: VERSION_ID,
      wait: Duration.minutes(10),
      installationKey: 'key',
      apexCompile: 'package',
      securityType: 'AllUsers',
      upgradeType: 'DeprecateOnly',
    });

    expect(install.firstCall.args[0]).toMatchObject({
      Password: 'key',
      ApexCompileType: 'package',
      SecurityType: 'full',
      UpgradeType: 'deprecate-only',
    });
  });

  it('approves the remote site settings a package declares, as --no-prompt does', async () => {
    getExternalSites.resolves(['https://api.example.com']);

    await installPackageVersion({
      targetOrgConnection: connection(),
      aliasOrId: VERSION_ID,
      wait: Duration.minutes(1),
    });

    expect(install.firstCall.args[0]).toMatchObject({ EnableRss: true });
  });

  it('reports a still-running install as IN_PROGRESS rather than failing, when polling times out', async () => {
    const timeout = new SfError('polling timed out', 'PackageInstallTimeout');
    timeout.setData(installRequest({ Status: 'IN_PROGRESS' }));
    install.rejects(timeout);

    const result = await installPackageVersion({
      targetOrgConnection: connection(),
      aliasOrId: VERSION_ID,
      wait: Duration.minutes(1),
    });

    expect(result.status).toBe('IN_PROGRESS');
    expect(result.request.Status).toBe('IN_PROGRESS');
  });

  it('rethrows an install failure that carries no request', async () => {
    install.rejects(new Error('INVALID_SESSION_ID'));

    await expect(
      installPackageVersion({ targetOrgConnection: connection(), aliasOrId: VERSION_ID, wait: Duration.minutes(1) }),
    ).rejects.toThrow('INVALID_SESSION_ID');
  });

  it('throws a PackageInstallError listing every error when the install ends in ERROR', async () => {
    install.resolves(
      installRequest({
        Status: 'ERROR',
        Errors: { errors: [{ message: 'Missing dependency' }, { message: 'Apex compile failed' }] },
      }),
    );

    const error = await installPackageVersion({
      targetOrgConnection: connection(),
      aliasOrId: VERSION_ID,
      wait: Duration.minutes(1),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SfError);
    expect((error as SfError).name).toBe('PackageInstallError');
    expect((error as SfError).message).toBe(
      'Encountered errors installing the package! Installation errors: \n1) Missing dependency\n2) Apex compile failed',
    );
  });

  it('refuses an org below API version 36.0 before installing', async () => {
    await expect(
      installPackageVersion({
        targetOrgConnection: connection('35.0'),
        aliasOrId: VERSION_ID,
        wait: Duration.minutes(1),
      }),
    ).rejects.toMatchObject({ name: 'ApiVersionTooLowError' });
    expect(install.called).toBe(false);
  });
});
