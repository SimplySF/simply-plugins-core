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
import { runApexTests as runApexTestsCommon } from '../../src/sfApex.js';
import { ensureScratchOrgSession } from '../../src/build/scratchOrgAuth.js';
import { runScratchApexTests } from '../../src/build/testScratch.js';

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
vi.mock('../../src/sfApex.js', () => ({ runApexTests: vi.fn() }));

const mockScratchOrgInfo = { authFields: { username: 'test', clientId: 'id', instanceUrl: 'url' } };

describe('runScratchApexTests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockScratchOrgInfo));
  });

  it('should authenticate to the scratch org and run Apex tests', async () => {
    await runScratchApexTests({ jwtKeyFile: 'key.file' });

    expect(logger.info).toHaveBeenCalledWith('Authenticating to scratch org for tests...');
    expect(ensureScratchOrgSession).toHaveBeenCalledWith(mockScratchOrgInfo.authFields, {
      jwtKeyFile: 'key.file',
      setDefault: true,
      debug: undefined,
    });
    expect(runApexTestsCommon).toHaveBeenCalledWith({ testLevel: 'RunLocalTests', wait: '60' });
  });

  it('should skip running Apex tests when disableApexTests is true, without skipping authentication (fixes a bug in the original: --disable-apex-tests was checked against the wrong option and never actually skipped anything)', async () => {
    await runScratchApexTests({ jwtKeyFile: 'key.file', disableApexTests: true });

    expect(logger.warn).toHaveBeenCalledWith('Apex tests are disabled via --disable-apex-tests. Skipping.');
    expect(ensureScratchOrgSession).not.toHaveBeenCalled();
    expect(runApexTestsCommon).not.toHaveBeenCalled();
  });
});
