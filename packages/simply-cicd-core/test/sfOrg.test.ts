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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import {
  AssignmentError,
  assignPermissionSetLicenses,
  assignPermissionSets,
  createScratchOrgOnHub,
  deleteTargetScratchOrg,
  getOrgConnection,
  getOrgInstanceUrl,
  getRemainingDailyScratchOrgs,
  getScratchOrgCapacity,
} from '../src/sfOrg.js';

const resolveOrgMock = vi.hoisted(() => vi.fn());
const userCreateMock = vi.hoisted(() => vi.fn());
const limitsMock = vi.hoisted(() => vi.fn());
const singleRecordQueryMock = vi.hoisted(() => vi.fn());
const createRecordMock = vi.hoisted(() => vi.fn());
const userAssignMock = vi.hoisted(() => vi.fn());
const scratchOrgCreateMock = vi.hoisted(() => vi.fn());
const authInfoCreateMock = vi.hoisted(() => vi.fn());
const removeAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../src/resolveOrg.js', () => ({ resolveOrg: resolveOrgMock }));
vi.mock('@salesforce/core', async (importOriginal) => ({
  // SfError stays real.
  ...(await importOriginal<typeof import('@salesforce/core')>()),
  User: { create: userCreateMock },
  AuthInfo: { create: authInfoCreateMock },
  AuthRemover: { create: async () => ({ removeAuth: removeAuthMock }) },
  scratchOrgCreate: scratchOrgCreateMock,
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

const connection = {
  instanceUrl: 'https://acme.my.salesforce.com',
  limits: limitsMock,
  singleRecordQuery: singleRecordQueryMock,
  sobject: vi.fn(() => ({ create: createRecordMock })),
};

describe('sfOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgMock.mockResolvedValue({ getConnection: () => connection, getUsername: () => "o'brien@example.com" });
    userCreateMock.mockResolvedValue({ assignPermissionSets: userAssignMock });
    singleRecordQueryMock.mockImplementation(async (soql: string) =>
      soql.startsWith('SELECT Id FROM User') ? { Id: '005000000000001' } : { Id: '0PL000000000001' },
    );
  });

  describe('getOrgInstanceUrl', () => {
    it("returns the org connection's instance URL", async () => {
      expect(await getOrgInstanceUrl('my-org')).toBe('https://acme.my.salesforce.com');
      expect(resolveOrgMock).toHaveBeenCalledWith('my-org');
    });

    it.each([undefined, ''])('leaves %j to resolveOrg, which means the default target org', async (alias) => {
      await getOrgInstanceUrl(alias);
      expect(resolveOrgMock).toHaveBeenCalledWith(alias);
    });
  });

  describe('getScratchOrgCapacity', () => {
    it("returns the Dev Hub's daily and active scratch org limits from one limits call", async () => {
      limitsMock.mockResolvedValue({
        DailyScratchOrgs: { Max: 200, Remaining: 37 },
        ActiveScratchOrgs: { Max: 40, Remaining: 0 },
        DailyApiRequests: {},
      });

      expect(await getScratchOrgCapacity('my-hub')).toEqual({
        daily: { max: 200, remaining: 37 },
        active: { max: 40, remaining: 0 },
      });
      expect(resolveOrgMock).toHaveBeenCalledWith('my-hub', { isDevHub: true });
      expect(limitsMock).toHaveBeenCalledOnce();
    });

    it('leaves out a limit the org does not report', async () => {
      limitsMock.mockResolvedValue({ DailyApiRequests: { Max: 1, Remaining: 1 } });

      expect(await getScratchOrgCapacity('hub@example.com')).toEqual({ daily: undefined, active: undefined });
    });
  });

  describe('getRemainingDailyScratchOrgs', () => {
    it("returns the Dev Hub's remaining DailyScratchOrgs", async () => {
      limitsMock.mockResolvedValue({ DailyScratchOrgs: { Max: 200, Remaining: 37 }, DailyApiRequests: {} });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBe(37);
      expect(resolveOrgMock).toHaveBeenCalledWith('hub@example.com', { isDevHub: true });
    });

    it('returns undefined when the org does not report the limit', async () => {
      limitsMock.mockResolvedValue({ DailyApiRequests: { Max: 1, Remaining: 1 } });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBeUndefined();
    });
  });

  describe('getOrgConnection', () => {
    it('connects to the given org, or the default target org when omitted', async () => {
      expect(await getOrgConnection('hub@example.com')).toBe(connection);
      expect(resolveOrgMock).toHaveBeenLastCalledWith('hub@example.com');

      await getOrgConnection();
      expect(resolveOrgMock).toHaveBeenLastCalledWith(undefined);
    });
  });

  describe('assignPermissionSets', () => {
    it("assigns each permission set to the org's own user, one at a time", async () => {
      await assignPermissionSets(['PermA', 'PermB']);

      expect(resolveOrgMock).toHaveBeenCalledWith(undefined);
      expect(singleRecordQueryMock).toHaveBeenCalledWith(
        "SELECT Id FROM User WHERE Username = 'o\\'brien@example.com'",
      );
      expect(userAssignMock.mock.calls).toEqual([
        ['005000000000001', ['PermA']],
        ['005000000000001', ['PermB']],
      ]);
    });

    it('attempts every permission set, then throws listing each failure', async () => {
      userAssignMock.mockImplementation(async (_id: string, [name]: string[]) => {
        if (name !== 'PermB') throw new Error(`Duplicate PermissionSetAssignment: ${name}`);
      });

      const error = await assignPermissionSets(['PermA', 'PermB', 'PermC']).catch((e: unknown) => e);

      expect(userAssignMock).toHaveBeenCalledTimes(3);
      expect(error).toBeInstanceOf(AssignmentError);
      expect((error as AssignmentError).failures).toEqual([
        { name: "o'brien@example.com", message: 'Duplicate PermissionSetAssignment: PermA' },
        { name: "o'brien@example.com", message: 'Duplicate PermissionSetAssignment: PermC' },
      ]);
      expect((error as Error).message).toMatch(/^Permission set assignment failed: \[/);
    });
  });

  describe('assignPermissionSetLicenses', () => {
    it('looks each license up by developer name or label and assigns it to the org user', async () => {
      await assignPermissionSetLicenses(['MyLicense'], 'scratch');

      expect(resolveOrgMock).toHaveBeenCalledWith('scratch');
      expect(singleRecordQueryMock).toHaveBeenCalledWith(
        "SELECT Id FROM PermissionSetLicense WHERE DeveloperName = 'MyLicense' OR MasterLabel = 'MyLicense'",
      );
      expect(connection.sobject).toHaveBeenCalledWith('PermissionSetLicenseAssign');
      expect(createRecordMock).toHaveBeenCalledWith({
        AssigneeId: '005000000000001',
        PermissionSetLicenseId: '0PL000000000001',
      });
    });

    it('treats an already-assigned license as a success, with a warning', async () => {
      createRecordMock.mockRejectedValue(new Error('duplicate value found: <unknown> duplicates value on record'));

      await expect(assignPermissionSetLicenses(['MyLicense'])).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "Permission set license MyLicense is already assigned to o'brien@example.com.",
      );
    });

    it('attempts every license, then throws for unknown licenses and other failures', async () => {
      singleRecordQueryMock.mockImplementation(async (soql: string) => {
        if (soql.startsWith('SELECT Id FROM User')) return { Id: '005000000000001' };
        if (soql.includes("'Missing'")) throw new Error('No record found');
        return { Id: '0PL000000000001' };
      });
      createRecordMock.mockRejectedValueOnce(new Error('FIELD_INTEGRITY_EXCEPTION')).mockResolvedValue({});

      const error = await assignPermissionSetLicenses(['Broken', 'Missing', 'Fine']).catch((e: unknown) => e);

      expect(createRecordMock).toHaveBeenCalledTimes(2);
      expect((error as AssignmentError).failures).toEqual([
        { name: "o'brien@example.com", message: 'FIELD_INTEGRITY_EXCEPTION' },
        { name: "o'brien@example.com", message: 'PermissionSetLicense not found: Missing' },
      ]);
    });
  });

  describe('createScratchOrgOnHub', () => {
    it('creates from the definition file with the CLI defaults and returns the CLI result shape', async () => {
      const definitionFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-def-')), 'def.json');
      await fs.writeFile(definitionFile, JSON.stringify({ edition: 'Developer', features: ['Communities'] }));
      const hubOrg = { getConnection: () => connection, getUsername: () => 'hub@example.com' };
      resolveOrgMock.mockResolvedValue(hubOrg);
      scratchOrgCreateMock.mockResolvedValue({
        username: 'test-abc@example.com',
        scratchOrgInfo: { Id: '2SR000000000001', CreatedDate: new Date('2026-10-28T12:00:00.000Z') },
        authFields: { orgId: '00D000000000002', refreshToken: 'refresh' },
        authInfo: { not: 'serialized by the CLI' },
        warnings: [],
      });

      const result = await createScratchOrgOnHub('hub@example.com', {
        definitionFile,
        durationDays: 7,
        waitMinutes: 20,
        setDefault: true,
      });

      expect(resolveOrgMock).toHaveBeenCalledWith('hub@example.com', { isDevHub: true });
      const options = scratchOrgCreateMock.mock.calls[0][0] as Record<string, unknown> & { wait: { minutes: number } };
      expect(options).toMatchObject({
        hubOrg,
        orgConfig: { edition: 'Developer', features: ['Communities'] },
        durationDays: 7,
        setDefault: true,
        tracksSource: true,
      });
      expect(options.wait.minutes).toBe(20);
      expect(result).toEqual({
        username: 'test-abc@example.com',
        scratchOrgInfo: { Id: '2SR000000000001', CreatedDate: '2026-10-28T12:00:00.000Z' },
        authFields: { orgId: '00D000000000002', refreshToken: 'refresh' },
        warnings: [],
        orgId: '00D000000000002',
      });
    });

    it('throws when signup returns no scratch org info', async () => {
      const definitionFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-def-')), 'def.json');
      await fs.writeFile(definitionFile, '{}');
      scratchOrgCreateMock.mockResolvedValue({ warnings: [] });

      await expect(
        createScratchOrgOnHub('hub@example.com', { definitionFile, durationDays: 1, waitMinutes: 20 }),
      ).rejects.toThrow('The scratch org did not return with any information');
    });
  });

  describe('deleteTargetScratchOrg', () => {
    const deleteMock = vi.fn();

    beforeEach(() => {
      resolveOrgMock.mockResolvedValue({ getUsername: () => 'scratch@example.com', delete: deleteMock });
      authInfoCreateMock.mockResolvedValue({ getFields: () => ({ isScratch: true }) });
      deleteMock.mockResolvedValue(undefined);
    });

    it('deletes the default target org when it is a scratch org', async () => {
      expect(await deleteTargetScratchOrg()).toBe('scratch@example.com');
      expect(resolveOrgMock).toHaveBeenCalledWith(undefined);
      expect(authInfoCreateMock).toHaveBeenCalledWith({ username: 'scratch@example.com' });
      expect(deleteMock).toHaveBeenCalled();
    });

    it('refuses an org that is not a scratch org', async () => {
      authInfoCreateMock.mockResolvedValue({ getFields: () => ({ isScratch: false }) });

      await expect(deleteTargetScratchOrg('prod')).rejects.toMatchObject({ name: 'NotAScratchOrgError' });
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it('treats an already-deleted scratch org as success', async () => {
      deleteMock.mockRejectedValue(Object.assign(new Error('gone'), { name: 'ScratchOrgNotFound' }));

      await expect(deleteTargetScratchOrg()).resolves.toBe('scratch@example.com');
      expect(removeAuthMock).not.toHaveBeenCalled();
    });

    it('removes the local auth for a scratch org whose domain no longer resolves', async () => {
      deleteMock.mockRejectedValue(Object.assign(new Error('no domain'), { name: 'DomainNotFoundError' }));

      await expect(deleteTargetScratchOrg()).resolves.toBe('scratch@example.com');
      expect(removeAuthMock).toHaveBeenCalledWith('scratch@example.com');
    });

    it('rethrows any other delete failure', async () => {
      deleteMock.mockRejectedValue(new Error('INSUFFICIENT_ACCESS'));

      await expect(deleteTargetScratchOrg()).rejects.toThrow('INSUFFICIENT_ACCESS');
    });
  });
});
