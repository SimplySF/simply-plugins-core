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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import {
  AssignmentError,
  assignPermissionSetLicenses,
  assignPermissionSets,
  getOrgConnection,
  getOrgInstanceUrl,
  getRemainingDailyScratchOrgs,
} from '../src/sfOrg.js';

const orgCreateMock = vi.hoisted(() => vi.fn());
const userCreateMock = vi.hoisted(() => vi.fn());
const limitsMock = vi.hoisted(() => vi.fn());
const singleRecordQueryMock = vi.hoisted(() => vi.fn());
const createRecordMock = vi.hoisted(() => vi.fn());
const userAssignMock = vi.hoisted(() => vi.fn());

vi.mock('@salesforce/core', () => ({ Org: { create: orgCreateMock }, User: { create: userCreateMock } }));
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
    orgCreateMock.mockResolvedValue({ getConnection: () => connection, getUsername: () => "o'brien@example.com" });
    userCreateMock.mockResolvedValue({ assignPermissionSets: userAssignMock });
    singleRecordQueryMock.mockImplementation(async (soql: string) =>
      soql.startsWith('SELECT Id FROM User') ? { Id: '005000000000001' } : { Id: '0PL000000000001' },
    );
  });

  describe('getOrgInstanceUrl', () => {
    it("returns the org connection's instance URL", async () => {
      expect(await getOrgInstanceUrl('my-org')).toBe('https://acme.my.salesforce.com');
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'my-org' });
    });

    it.each([undefined, ''])('falls back to the default target org for %j', async (alias) => {
      await getOrgInstanceUrl(alias);
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: undefined });
    });
  });

  describe('getRemainingDailyScratchOrgs', () => {
    it("returns the Dev Hub's remaining DailyScratchOrgs", async () => {
      limitsMock.mockResolvedValue({ DailyScratchOrgs: { Max: 200, Remaining: 37 }, DailyApiRequests: {} });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBe(37);
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'hub@example.com' });
    });

    it('returns undefined when the org does not report the limit', async () => {
      limitsMock.mockResolvedValue({ DailyApiRequests: { Max: 1, Remaining: 1 } });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBeUndefined();
    });
  });

  describe('getOrgConnection', () => {
    it('connects to the given org, or the default target org when omitted', async () => {
      expect(await getOrgConnection('hub@example.com')).toBe(connection);
      expect(orgCreateMock).toHaveBeenLastCalledWith({ aliasOrUsername: 'hub@example.com' });

      await getOrgConnection();
      expect(orgCreateMock).toHaveBeenLastCalledWith({ aliasOrUsername: undefined });
    });
  });

  describe('assignPermissionSets', () => {
    it("assigns each permission set to the org's own user, one at a time", async () => {
      await assignPermissionSets(['PermA', 'PermB']);

      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: undefined });
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

      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'scratch' });
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
});
