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
import { cleanupScratchOrgs } from '../../src/build/cleanupScratchOrgs.js';
import { resolveDevHubs } from '../../src/build/devHubs.js';
import { logger } from '../../src/logger.js';

vi.mock('execa');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, writeFile: vi.fn(), readFile: vi.fn(), unlink: vi.fn() } };
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

const resolvedHub = {
  alias: 'main',
  username: 'devhub@example.com',
  clientId: 'id',
  instanceUrl: 'https://login.salesforce.com',
};

describe('cleanupScratchOrgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDevHubs).mockResolvedValue([resolvedHub]);
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
  });

  it('should do nothing when given no Dev Hub aliases', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([]);

    await cleanupScratchOrgs([]);

    expect(execa).not.toHaveBeenCalled();
    expect(logger.success).toHaveBeenCalledWith('Scratch org cleanup complete.');
  });

  it('should propagate a resolution failure for an unauthenticated Dev Hub alias', async () => {
    vi.mocked(resolveDevHubs).mockRejectedValue(new Error('No authorization'));

    await expect(cleanupScratchOrgs(['main'])).rejects.toThrow('No authorization');
    expect(execa).not.toHaveBeenCalled();
  });

  it('should bulk-delete scratch orgs when the CSV has data rows beyond the header', async () => {
    const csv = 'Id\n0GQ000000000001\n0GQ000000000002\n';
    vi.mocked(execa).mockResolvedValueOnce({ stdout: csv } as never);
    vi.mocked(fsPromises.readFile).mockResolvedValue(csv);

    await cleanupScratchOrgs(['main']);

    expect(logger.info).toHaveBeenCalledWith('Found 2 old scratch orgs in devhub@example.com. Deleting...');
    expect(execa).toHaveBeenCalledWith(
      'sf',
      [
        'data',
        'bulk',
        'delete',
        '--sobject',
        'ActiveScratchOrg',
        '--file',
        expect.stringContaining('devhub@example.com_orgs.csv'),
        '--target-org',
        'devhub@example.com',
        '--wait',
        '30',
      ],
      { stdio: 'inherit' },
    );
  });

  it('should not attempt deletion when the CSV only has a header row (this used to be broken: the original split on individual characters, not lines, so this branch was unreachable)', async () => {
    const csv = 'Id\n';
    vi.mocked(execa).mockResolvedValueOnce({ stdout: csv } as never);
    vi.mocked(fsPromises.readFile).mockResolvedValue(csv);

    await cleanupScratchOrgs(['main']);

    expect(logger.info).toHaveBeenCalledWith('No old scratch orgs found in devhub@example.com.');
    expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['bulk']), expect.any(Object));
  });

  it('should clean up the temp CSV file even when the query fails', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('query failed'));

    await cleanupScratchOrgs(['main']);

    expect(logger.error).toHaveBeenCalledWith('Failed to cleanup scratch orgs for devhub@example.com:', undefined);
    expect(fsPromises.unlink).toHaveBeenCalledWith(expect.stringContaining('devhub@example.com_orgs.csv'));
  });
});
