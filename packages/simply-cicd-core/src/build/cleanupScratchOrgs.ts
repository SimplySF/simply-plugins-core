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
import { getOrgConnection } from '../sfOrg.js';
import { resolveDevHubs } from './devHubs.js';

async function cleanupScratchOrgsForHub(hubUsername: string): Promise<void> {
  logger.info(`Querying for scratch orgs in ${hubUsername}...`);
  try {
    const connection = await getOrgConnection(hubUsername);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { records } = await connection.query<{ Id: string }>(
      `SELECT Id FROM ActiveScratchOrg WHERE CreatedDate < ${threeHoursAgo}`,
      { autoFetch: true, maxFetch: 50_000 },
    );
    if (records.length === 0) {
      logger.info(`No old scratch orgs found in ${hubUsername}.`);
      return;
    }

    logger.info(`Found ${records.length} old scratch orgs in ${hubUsername}. Deleting...`);
    // Deleting an ActiveScratchOrg record deletes the scratch org. allowRecursive splits the
    // sObject Collections call into the API's 200-record batches.
    const results = await connection.sobject('ActiveScratchOrg').destroy(
      records.map((record) => record.Id),
      { allOrNone: false, allowRecursive: true },
    );
    const failures = results.filter((result) => !result.success);
    for (const failure of failures) {
      const reason = failure.success ? '' : failure.errors.map((e) => e.message).join('; ');
      logger.warn(`Could not delete scratch org ${failure.id ?? 'unknown'} in ${hubUsername}: ${reason}`);
    }
    logger.info(`Deleted ${results.length - failures.length} of ${results.length} old scratch orgs in ${hubUsername}.`);
  } catch (error) {
    logger.error(`Failed to cleanup scratch orgs for ${hubUsername}:`, (error as Error).message);
  }
}

/**
 * Cleans up scratch orgs older than 3 hours from every given Dev Hub.
 *
 * Every Dev Hub alias passed in must already be authenticated by the calling pipeline.
 */
export async function cleanupScratchOrgs(devHubAliases: string[]): Promise<void> {
  logger.info('Starting cleanup of old scratch orgs...');
  const devHubs = await resolveDevHubs(devHubAliases);

  for (const hub of devHubs) {
    // eslint-disable-next-line no-await-in-loop -- cleanup runs per hub sequentially, matching the original
    await cleanupScratchOrgsForHub(hub.username);
  }

  logger.success('Scratch org cleanup complete.');
}
