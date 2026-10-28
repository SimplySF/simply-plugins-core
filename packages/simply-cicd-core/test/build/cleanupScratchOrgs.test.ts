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
import { cleanupScratchOrgs } from '../../src/build/cleanupScratchOrgs.js';
import { resolveDevHubs } from '../../src/build/devHubs.js';
import { logger } from '../../src/logger.js';
import { getOrgConnection } from '../../src/sfOrg.js';

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
vi.mock('../../src/sfOrg.js', () => ({ getOrgConnection: vi.fn() }));

const resolvedHub = {
  alias: 'main',
  username: 'devhub@example.com',
  clientId: 'id',
  instanceUrl: 'https://login.salesforce.com',
};

const queryMock = vi.fn();
const destroyMock = vi.fn();
const sobjectMock = vi.fn(() => ({ destroy: destroyMock }));

describe('cleanupScratchOrgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDevHubs).mockResolvedValue([resolvedHub]);
    vi.mocked(getOrgConnection).mockResolvedValue({ query: queryMock, sobject: sobjectMock } as never);
    queryMock.mockResolvedValue({ records: [] });
  });

  it('should do nothing when given no Dev Hub aliases', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([]);

    await cleanupScratchOrgs([]);

    expect(getOrgConnection).not.toHaveBeenCalled();
    expect(logger.success).toHaveBeenCalledWith('Scratch org cleanup complete.');
  });

  it('should propagate a resolution failure for an unauthenticated Dev Hub alias', async () => {
    vi.mocked(resolveDevHubs).mockRejectedValue(new Error('No authorization'));

    await expect(cleanupScratchOrgs(['main'])).rejects.toThrow('No authorization');
    expect(getOrgConnection).not.toHaveBeenCalled();
  });

  it('should query the Dev Hub for scratch orgs older than three hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));

    await cleanupScratchOrgs(['main']);
    vi.useRealTimers();

    expect(getOrgConnection).toHaveBeenCalledWith('devhub@example.com');
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT Id FROM ActiveScratchOrg WHERE CreatedDate < 2026-10-28T09:00:00.000Z',
      { autoFetch: true, maxFetch: 50_000 },
    );
  });

  it('should delete every old scratch org, without failing the batch on one bad record', async () => {
    queryMock.mockResolvedValue({ records: [{ Id: '0GQ000000000001' }, { Id: '0GQ000000000002' }] });
    destroyMock.mockResolvedValue([
      { id: '0GQ000000000001', success: true },
      { id: '0GQ000000000002', success: true },
    ]);

    await cleanupScratchOrgs(['main']);

    expect(logger.info).toHaveBeenCalledWith('Found 2 old scratch orgs in devhub@example.com. Deleting...');
    expect(sobjectMock).toHaveBeenCalledWith('ActiveScratchOrg');
    expect(destroyMock).toHaveBeenCalledWith(['0GQ000000000001', '0GQ000000000002'], {
      allOrNone: false,
      allowRecursive: true,
    });
    expect(logger.info).toHaveBeenCalledWith('Deleted 2 of 2 old scratch orgs in devhub@example.com.');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should warn about each scratch org it could not delete and report the rest', async () => {
    queryMock.mockResolvedValue({ records: [{ Id: '0GQ000000000001' }, { Id: '0GQ000000000002' }] });
    destroyMock.mockResolvedValue([
      { id: '0GQ000000000001', success: true },
      { id: '0GQ000000000002', success: false, errors: [{ message: 'entity is deleted' }] },
    ]);

    await cleanupScratchOrgs(['main']);

    expect(logger.warn).toHaveBeenCalledWith(
      'Could not delete scratch org 0GQ000000000002 in devhub@example.com: entity is deleted',
    );
    expect(logger.info).toHaveBeenCalledWith('Deleted 1 of 2 old scratch orgs in devhub@example.com.');
  });

  it('should not attempt deletion when no old scratch orgs are found', async () => {
    await cleanupScratchOrgs(['main']);

    expect(logger.info).toHaveBeenCalledWith('No old scratch orgs found in devhub@example.com.');
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('should log and carry on when a Dev Hub query fails', async () => {
    queryMock.mockRejectedValue(new Error('INVALID_SESSION_ID'));

    await cleanupScratchOrgs(['main']);

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to cleanup scratch orgs for devhub@example.com:',
      'INVALID_SESSION_ID',
    );
    expect(logger.success).toHaveBeenCalledWith('Scratch org cleanup complete.');
  });
});
