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

import { runSf } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { authenticateOrg } from '../sfAuth.js';
import { resolveDevHubs } from './devHubs.js';
import { ensureScratchOrgSession } from './scratchOrgAuth.js';
import { readScratchOrgInfo } from './scratchOrgInfo.js';

export type DeleteScratchOrgOptions = {
  /** Required only when the Dev Hub and/or scratch org were JWT-authenticated (no refresh token available). */
  jwtKeyFile?: string;
  debug?: boolean;
};

/**
 * Authenticates to the Dev Hub that owns the scratch org and deletes it.
 *
 * `devHubAlias` must already be authenticated by the calling pipeline. Deletion failures are
 * logged, not thrown, matching the original behavior: a scratch org that fails to delete just
 * needs manual cleanup later, and shouldn't fail an otherwise-successful pipeline run.
 */
export async function deleteScratchOrg(options: DeleteScratchOrgOptions, devHubAlias: string): Promise<void> {
  logger.info('Deleting scratch org...');
  try {
    const scratchOrgInfo = await readScratchOrgInfo();
    const [hub] = await resolveDevHubs([devHubAlias]);
    if (hub.username !== scratchOrgInfo.authFields.devHubUsername) {
      throw new Error(
        `--dev-hub ${devHubAlias} (${hub.username}) does not match the Dev Hub that created this scratch org (${scratchOrgInfo.authFields.devHubUsername ?? 'unknown'}).`,
      );
    }

    if (hub.privateKeyFile) {
      // JWT-authenticated Dev Hub: no refresh token exists, so re-mint a session explicitly.
      // A refresh-token-authenticated Dev Hub needs no action here — @salesforce/core refreshes
      // its already-persisted session automatically.
      await authenticateOrg({
        username: hub.username,
        clientId: hub.clientId,
        instanceUrl: hub.instanceUrl,
        jwtKeyFile: hub.privateKeyFile,
        setDefaultDevHub: true,
        debug: options.debug,
      });
    }

    await ensureScratchOrgSession(scratchOrgInfo.authFields, {
      jwtKeyFile: options.jwtKeyFile,
      setDefault: true,
      debug: options.debug,
    });

    await runSf(['org', 'delete', 'scratch', '--no-prompt'], { stdio: 'inherit' });
    logger.success('Scratch org deleted.');
  } catch (e) {
    logger.error('Failed to delete scratch org. It may need to be deleted manually.', (e as Error).message);
  }
}
