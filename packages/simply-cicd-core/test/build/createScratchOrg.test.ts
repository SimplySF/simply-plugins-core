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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../../src/logger.js';
import { resolveDevHubs } from '../../src/build/devHubs.js';
import {
  assignPermissionSetLicenses,
  assignPermissionSets,
  createScratchOrgOnHub,
  getOrgConnection,
  getRemainingDailyScratchOrgs,
} from '../../src/sfOrg.js';
import { createScratchOrg } from '../../src/build/createScratchOrg.js';

vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});
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
vi.mock('../../src/build/devHubs.js', () => ({ resolveDevHubs: vi.fn() }));
vi.mock('../../src/sfOrg.js', () => ({
  assignPermissionSets: vi.fn(),
  assignPermissionSetLicenses: vi.fn(),
  createScratchOrgOnHub: vi.fn(),
  getOrgConnection: vi.fn(),
  getRemainingDailyScratchOrgs: vi.fn(),
}));

const hubA = { alias: 'hub-a', username: 'a@hub.com', clientId: 'id-a', instanceUrl: 'https://a.com' };
const hubB = { alias: 'hub-b', username: 'b@hub.com', clientId: 'id-b', instanceUrl: 'https://b.com' };

function mockSfdxProjectJson(overrides: Record<string, unknown> = {}): void {
  vi.mocked(readSfdxProject).mockResolvedValue({
    packageDirectories: [{ default: true, definitionFile: 'config/project-scratch-def.json', ...overrides }],
  });
}

const createResult = { username: 'scratch@test', orgId: '00D...' };

const userUpdateMock = vi.fn();
const scratchConnection = {
  query: vi.fn(),
  singleRecordQuery: vi.fn(),
  sobject: vi.fn(() => ({ update: userUpdateMock })),
};

describe('createScratchOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA, hubB]);
    vi.mocked(getRemainingDailyScratchOrgs).mockResolvedValue(5);
    vi.mocked(getOrgConnection).mockResolvedValue(scratchConnection as never);
    scratchConnection.query.mockRejectedValue(new Error("No such column 'CountryCode' on entity 'User'"));
    mockSfdxProjectJson();
    vi.mocked(createScratchOrgOnHub).mockResolvedValue(createResult as never);
  });

  it('should create a scratch org with the first Dev Hub that has capacity', async () => {
    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(resolveDevHubs).toHaveBeenCalledWith([hubA.alias, hubB.alias]);
    expect(result).toEqual(createResult);
    expect(createScratchOrgOnHub).toHaveBeenCalledWith(hubA.username, {
      definitionFile: 'config/project-scratch-def.json',
      durationDays: 1,
      waitMinutes: 20,
      setDefault: true,
    });
    expect(fsPromises.writeFile).toHaveBeenCalledWith('SCRATCH_ORG_INFO.json', JSON.stringify(createResult, null, 2));
    expect(logger.success).toHaveBeenCalledWith(`Scratch org created successfully using Dev Hub ${hubA.alias}.`);
  });

  it('should skip a Dev Hub with no remaining daily capacity and try the next one', async () => {
    vi.mocked(getRemainingDailyScratchOrgs).mockImplementation(async (hub) => (hub === hubA.username ? 0 : 5));

    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(result).toEqual(createResult);
    expect(logger.warn).toHaveBeenCalledWith(`Dev Hub ${hubA.alias} has no remaining scratch orgs. Skipping.`);
    expect(createScratchOrgOnHub).toHaveBeenCalledWith(hubB.username, expect.anything());
  });

  it('should try the next Dev Hub when creation fails with a scratch org limit error', async () => {
    vi.mocked(createScratchOrgOnHub).mockImplementation(async (hub) => {
      if (hub === hubA.username) {
        // How the Dev Hub's API reports it: the code on the error, the sentence in the message.
        throw Object.assign(
          new Error(
            'The signup request failed because this organization has reached its daily scratch org signup limit',
          ),
          { errorCode: 'LIMIT_EXCEEDED' },
        );
      }
      return createResult as never;
    });

    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(result).toEqual(createResult);
    expect(logger.warn).toHaveBeenCalledWith(`Dev Hub ${hubA.alias} reached its daily limit. Trying next Dev Hub...`);
  });

  it('should throw immediately on a non-recoverable creation error, without trying the next Dev Hub', async () => {
    vi.mocked(createScratchOrgOnHub).mockRejectedValue(new Error('unexpected failure'));

    await expect(createScratchOrg({}, [hubA.alias, hubB.alias])).rejects.toThrow(
      `Scratch org creation failed with a non-recoverable error using Dev Hub ${hubA.alias}.`,
    );
    expect(createScratchOrgOnHub).not.toHaveBeenCalledWith(hubB.username, expect.anything());
  });

  it('should throw once every Dev Hub has been exhausted', async () => {
    vi.mocked(getRemainingDailyScratchOrgs).mockResolvedValue(0);

    await expect(createScratchOrg({}, [hubA.alias, hubB.alias])).rejects.toThrow(
      'Scratch org creation failed for all available Dev Hubs.',
    );
  });

  it('should pass --scratch-duration-days through as a number of days', async () => {
    await createScratchOrg({ scratchDurationDays: '7' }, [hubA.alias]);

    expect(createScratchOrgOnHub).toHaveBeenCalledWith(hubA.username, expect.objectContaining({ durationDays: 7 }));
  });

  it.each(['0', '31', '1.5', 'week'])(
    'should reject a duration of %j up front, as sf org create scratch did, before trying any Dev Hub',
    async (scratchDurationDays) => {
      await expect(createScratchOrg({ scratchDurationDays }, [hubA.alias])).rejects.toThrow(
        `Scratch org duration must be a whole number of days from 1 to 30, got "${scratchDurationDays}".`,
      );
      expect(createScratchOrgOnHub).not.toHaveBeenCalled();
    },
  );

  it('should throw when no definitionFile is available anywhere', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });

    await expect(createScratchOrg({}, [hubA.alias])).rejects.toThrow(
      'You must specify a definitionFile in the default package directory in sfdx-project.json',
    );
  });

  it('should assign declared permission sets and permission set licenses after creation', async () => {
    mockSfdxProjectJson({
      packageMetadataAccess: { permissionSets: ['MyPermSet'], permissionSetLicenses: ['MyLicense'] },
    });
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA]);

    await createScratchOrg({}, [hubA.alias]);

    expect(assignPermissionSets).toHaveBeenCalledWith(['MyPermSet']);
    expect(assignPermissionSetLicenses).toHaveBeenCalledWith(['MyLicense']);
    expect(logger.success).toHaveBeenCalledWith('Permission sets assigned successfully.');
    expect(logger.success).toHaveBeenCalledWith('Permission set licenses assigned successfully.');
  });

  it('should log and rethrow a failed permission set assignment', async () => {
    mockSfdxProjectJson({ packageMetadataAccess: { permissionSets: ['MyPermSet'] } });
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA]);
    vi.mocked(assignPermissionSets).mockRejectedValue(new Error('Permission set assignment failed: [...]'));

    // Like any other failure after a Dev Hub was chosen, it ends the run rather than trying the next hub.
    await expect(createScratchOrg({}, [hubA.alias])).rejects.toThrow(
      `Scratch org creation failed with a non-recoverable error using Dev Hub ${hubA.alias}.`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Error assigning permission sets:',
      'Permission set assignment failed: [...]',
    );
  });

  it("should set the default user's country when State/Country picklists are enabled", async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA]);
    scratchConnection.query.mockResolvedValue({ records: [] });
    scratchConnection.singleRecordQuery.mockResolvedValue({ Id: '005000000000001' });

    await createScratchOrg({}, [hubA.alias]);

    expect(getOrgConnection).toHaveBeenCalledWith();
    expect(scratchConnection.query).toHaveBeenCalledWith('SELECT CountryCode FROM User LIMIT 1');
    expect(scratchConnection.singleRecordQuery).toHaveBeenCalledWith("SELECT Id FROM User WHERE Name = 'User User'");
    expect(scratchConnection.sobject).toHaveBeenCalledWith('User');
    expect(userUpdateMock).toHaveBeenCalledWith({ Id: '005000000000001', CountryCode: 'US' });
    expect(logger.success).toHaveBeenCalledWith('Default country set.');
  });

  it('should skip the country update when State/Country picklists are not enabled', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA]);

    await createScratchOrg({}, [hubA.alias]);

    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('State/Country picklists not detected. Skipping default country update.');
  });
});
