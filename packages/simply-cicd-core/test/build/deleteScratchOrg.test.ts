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
import { logger } from '../../src/logger.js';
import { authenticateOrg } from '../../src/sfAuth.js';
import { deleteTargetScratchOrg } from '../../src/sfOrg.js';
import { resolveDevHubs } from '../../src/build/devHubs.js';
import { ensureScratchOrgSession } from '../../src/build/scratchOrgAuth.js';
import { deleteScratchOrg } from '../../src/build/deleteScratchOrg.js';

vi.mock('../../src/sfOrg.js', () => ({ deleteTargetScratchOrg: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn() } };
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
vi.mock('../../src/sfAuth.js', () => ({ authenticateOrg: vi.fn() }));
vi.mock('../../src/build/devHubs.js', () => ({ resolveDevHubs: vi.fn() }));
vi.mock('../../src/build/scratchOrgAuth.js', () => ({ ensureScratchOrgSession: vi.fn() }));

const mockScratchOrgInfo = {
  authFields: {
    username: 'scratch@test',
    clientId: 'scratch-id',
    instanceUrl: 'scratch-url',
    devHubUsername: 'devhub@example.com',
  },
};
const jwtHub = {
  alias: 'main',
  username: 'devhub@example.com',
  clientId: 'hub-id',
  instanceUrl: 'https://login.salesforce.com',
  privateKeyFile: 'key.file',
};
const refreshTokenHub = {
  alias: 'main',
  username: 'devhub@example.com',
  clientId: 'hub-id',
  instanceUrl: 'https://login.salesforce.com',
};

describe('deleteScratchOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockScratchOrgInfo));
    vi.mocked(deleteTargetScratchOrg).mockResolvedValue('scratch@example.com');
  });

  it('re-authenticates a JWT-authenticated Dev Hub, ensures the scratch org session, then deletes it', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([jwtHub]);

    await deleteScratchOrg({ jwtKeyFile: 'key.file' }, 'main');

    expect(resolveDevHubs).toHaveBeenCalledWith(['main']);
    expect(authenticateOrg).toHaveBeenCalledWith({
      username: 'devhub@example.com',
      clientId: 'hub-id',
      instanceUrl: 'https://login.salesforce.com',
      jwtKeyFile: 'key.file',
      setDefaultDevHub: true,
      debug: undefined,
    });
    expect(ensureScratchOrgSession).toHaveBeenCalledWith(mockScratchOrgInfo.authFields, {
      jwtKeyFile: 'key.file',
      setDefault: true,
      debug: undefined,
    });
    expect(deleteTargetScratchOrg).toHaveBeenCalledWith();
    expect(logger.success).toHaveBeenCalledWith('Scratch org deleted.');
  });

  it('skips explicit Dev Hub re-auth when it has no private key file (refresh-token-authenticated)', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([refreshTokenHub]);

    await deleteScratchOrg({}, 'main');

    expect(authenticateOrg).not.toHaveBeenCalled();
    expect(ensureScratchOrgSession).toHaveBeenCalledWith(mockScratchOrgInfo.authFields, {
      jwtKeyFile: undefined,
      setDefault: true,
      debug: undefined,
    });
    expect(deleteTargetScratchOrg).toHaveBeenCalledWith();
  });

  it('logs (not throws) when the given --dev-hub does not match the org that created the scratch org', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([{ ...jwtHub, username: 'other-hub@example.com' }]);

    await expect(deleteScratchOrg({ jwtKeyFile: 'key.file' }, 'main')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to delete scratch org. It may need to be deleted manually.',
      expect.stringContaining('does not match the Dev Hub that created this scratch org'),
    );
    expect(deleteTargetScratchOrg).not.toHaveBeenCalled();
  });

  it('should log (not throw) when the delete command fails', async () => {
    vi.mocked(resolveDevHubs).mockResolvedValue([jwtHub]);
    vi.mocked(deleteTargetScratchOrg).mockRejectedValue(new Error('delete failed'));

    await expect(deleteScratchOrg({ jwtKeyFile: 'key.file' }, 'main')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to delete scratch org. It may need to be deleted manually.',
      'delete failed',
    );
  });
});
