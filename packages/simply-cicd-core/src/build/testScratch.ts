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

import { logger } from '../logger.js';
import { runApexTests as runApexTestsCommon } from '../sfApex.js';
import { ensureScratchOrgSession } from './scratchOrgAuth.js';
import { readScratchOrgInfo } from './scratchOrgInfo.js';

export type RunScratchApexTestsOptions = {
  /** Required only when the scratch org's Dev Hub was JWT-authenticated (no refresh token available). */
  jwtKeyFile?: string;
  debug?: boolean;
  /** Skips just the Apex test run, independent of the job-level --disabled flag. */
  disableApexTests?: boolean;
};

/**
 * Authenticates to the scratch org and runs its Apex tests.
 *
 * The original `--disable-apex-tests` flag was checked against the wrong option name internally
 * (it re-checked the generic `--disabled` flag), making it a no-op. Here it actually gates the
 * test run.
 */
export async function runScratchApexTests(options: RunScratchApexTestsOptions): Promise<void> {
  if (options.disableApexTests) {
    logger.warn('Apex tests are disabled via --disable-apex-tests. Skipping.');
    return;
  }

  logger.info('Authenticating to scratch org for tests...');
  const scratchOrgInfo = await readScratchOrgInfo();
  await ensureScratchOrgSession(scratchOrgInfo.authFields, {
    jwtKeyFile: options.jwtKeyFile,
    setDefault: true,
    debug: options.debug,
  });

  // A default org is now set, so no alias is needed.
  await runApexTestsCommon({ testLevel: 'RunLocalTests', wait: '60' });
}
