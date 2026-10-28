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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { deployProjectSource } from '../src/sfDeploy.js';

const resolveOrgMock = vi.hoisted(() => vi.fn());
const projectResolveMock = vi.hoisted(() => vi.fn());
const trackingCreateMock = vi.hoisted(() => vi.fn());
const builderBuildMock = vi.hoisted(() => vi.fn());

vi.mock('../src/resolveOrg.js', () => ({ resolveOrg: resolveOrgMock }));
vi.mock('@salesforce/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@salesforce/core')>()),
  SfProject: { resolve: projectResolveMock },
}));
vi.mock('@salesforce/source-tracking', () => ({ SourceTracking: { create: trackingCreateMock } }));
vi.mock('@salesforce/source-deploy-retrieve', async (importOriginal) => ({
  // RequestStatus stays real.
  ...(await importOriginal<typeof import('@salesforce/source-deploy-retrieve')>()),
  ComponentSetBuilder: { build: builderBuildMock },
}));
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

const connection = { id: 'connection' };
const org = { getConnection: () => connection };
const project = { getSfProjectJson: () => ({ getContents: () => ({ sourceApiVersion: '62.0' }) }) };
const wait = Duration.minutes(120);

type FakeResponse = {
  id: string;
  status: string;
  numberComponentsDeployed?: number;
  numberComponentsTotal?: number;
  numberTestsCompleted?: number;
  numberTestsTotal?: number;
  errorMessage?: string;
};

function fakeDeploy(status: string, fileResponses: unknown[] = [], updates: FakeResponse[] = []) {
  const deploy = {
    id: '0Af000000000001',
    onUpdate: vi.fn((listener: (response: FakeResponse) => void) => updates.forEach(listener)),
    pollStatus: vi.fn(async () => ({
      response: { id: '0Af000000000001', status },
      getFileResponses: () => fileResponses,
    })),
  };
  return deploy;
}

function componentSet(size: number, deploy = fakeDeploy('Succeeded')) {
  return { size, deploy: vi.fn(async () => deploy) };
}

describe('deployProjectSource', () => {
  let tracking: { projectPath: string; registry: object; localChangesAsComponentSet: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue(org);
    projectResolveMock.mockResolvedValue(project);
    tracking = { projectPath: '/project', registry: {}, localChangesAsComponentSet: vi.fn() };
    trackingCreateMock.mockResolvedValue(tracking);
  });

  it('deploys the tracked local changes to the default target org, ignoring conflicts', async () => {
    const deploy = fakeDeploy('Succeeded');
    const changes = componentSet(3, deploy);
    tracking.localChangesAsComponentSet.mockResolvedValue([changes]);

    const result = await deployProjectSource({ wait });

    expect(resolveOrgMock).toHaveBeenCalledWith(undefined);
    expect(trackingCreateMock).toHaveBeenCalledWith({
      org,
      project,
      subscribeSDREvents: true,
      ignoreConflicts: true,
    });
    expect(tracking.localChangesAsComponentSet).toHaveBeenCalledWith(false);
    expect(builderBuildMock).not.toHaveBeenCalled();
    expect(changes.deploy).toHaveBeenCalledWith({
      usernameOrConnection: connection,
      apiOptions: { checkOnly: false, ignoreWarnings: false, rest: false, rollbackOnError: true, purgeOnDelete: false },
    });
    expect(deploy.pollStatus).toHaveBeenCalledWith({ timeout: wait });
    expect(result).toEqual({ deployId: '0Af000000000001', status: 'Succeeded', componentCount: 3 });
  });

  it('treats no local changes as nothing to do, not an error', async () => {
    tracking.localChangesAsComponentSet.mockResolvedValue([]);

    expect(await deployProjectSource({ wait })).toEqual({ status: 'NothingToDeploy', componentCount: 0 });
    expect(logger.info).toHaveBeenCalledWith('No local changes to deploy.');
  });

  it('deploys the given source dirs instead, with the project source API version', async () => {
    const dirs = componentSet(5);
    builderBuildMock.mockResolvedValue(dirs);

    await deployProjectSource({
      wait,
      sourceDirs: ['force-app', 'seed-app'],
      ignoreWarnings: true,
      aliasOrUsername: 'scratch',
    });

    expect(resolveOrgMock).toHaveBeenCalledWith('scratch');
    expect(builderBuildMock).toHaveBeenCalledWith({
      sourcepath: ['force-app', 'seed-app'],
      sourceapiversion: '62.0',
      projectDir: '/project',
    });
    expect(tracking.localChangesAsComponentSet).not.toHaveBeenCalled();
    expect(dirs.deploy).toHaveBeenCalledWith(
      expect.objectContaining({ apiOptions: expect.objectContaining({ ignoreWarnings: true }) }),
    );
  });

  it('refuses empty source dirs, as --source-dir does', async () => {
    builderBuildMock.mockResolvedValue(componentSet(0));

    await expect(deployProjectSource({ wait, sourceDirs: ['empty-dir'] })).rejects.toMatchObject({
      name: 'NothingToDeploy',
    });
  });

  it('logs each distinct progress update once', async () => {
    const update = {
      id: '0Af000000000001',
      status: 'InProgress',
      numberComponentsDeployed: 1,
      numberComponentsTotal: 3,
      numberTestsCompleted: 0,
      numberTestsTotal: 0,
    };
    tracking.localChangesAsComponentSet.mockResolvedValue([
      componentSet(3, fakeDeploy('Succeeded', [], [update, update, { ...update, numberComponentsDeployed: 3 }])),
    ]);

    await deployProjectSource({ wait });

    const progressLines = vi.mocked(logger.info).mock.calls.filter(([line]) => String(line).startsWith('Deploy 0Af'));
    expect(progressLines).toEqual([
      ['Deploy 0Af000000000001: InProgress (1/3 components, 0/0 tests)'],
      ['Deploy 0Af000000000001: InProgress (3/3 components, 0/0 tests)'],
    ]);
  });

  it.each(['Failed', 'SucceededPartial', 'InProgress', 'Canceled'])(
    'throws for a %s deploy, as the CLI exits non-zero, logging each component failure',
    async (status) => {
      tracking.localChangesAsComponentSet.mockResolvedValue([
        componentSet(
          2,
          fakeDeploy(status, [
            { type: 'ApexClass', fullName: 'Foo', state: 'Failed', error: 'Unexpected token' },
            { type: 'ApexClass', fullName: 'Bar', state: 'Changed' },
          ]),
        ),
      ]);

      await expect(deployProjectSource({ wait })).rejects.toMatchObject({ name: 'DeployFailed' });
      expect(logger.error).toHaveBeenCalledWith('ApexClass Foo: Unexpected token');
      expect(logger.error).toHaveBeenCalledTimes(1);
    },
  );
});
