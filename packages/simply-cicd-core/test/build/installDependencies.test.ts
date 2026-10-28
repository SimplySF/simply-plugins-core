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
import { installPackageDependencies as installPackageDependenciesCommon } from '../../src/sfPackages.js';
import { ensureScratchOrgSession } from '../../src/build/scratchOrgAuth.js';
import { installDependencies } from '../../src/build/installDependencies.js';

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
vi.mock('../../src/build/scratchOrgAuth.js', () => ({ ensureScratchOrgSession: vi.fn() }));
vi.mock('../../src/sfPackages.js', () => ({ installPackageDependencies: vi.fn() }));

const mockScratchOrgInfo = { authFields: { username: 'test', clientId: 'id', instanceUrl: 'url' } };

describe('installDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockScratchOrgInfo));
  });

  it('should authenticate to the scratch org and install its packaged dependencies', async () => {
    await installDependencies({ jwtKeyFile: 'key.file', installType: 'Delta', upgradeType: 'Delete' });

    expect(ensureScratchOrgSession).toHaveBeenCalledWith(mockScratchOrgInfo.authFields, {
      jwtKeyFile: 'key.file',
      setDefault: true,
      debug: undefined,
    });
    expect(installPackageDependenciesCommon).toHaveBeenCalledWith({
      alias: mockScratchOrgInfo.authFields.username,
      wait: '240',
      installType: 'Delta',
      upgradeType: 'Delete',
    });
    expect(logger.success).toHaveBeenCalledWith('Package dependencies installed.');
  });
});
