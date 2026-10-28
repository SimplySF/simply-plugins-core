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

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runSf } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { resolveDevHubs } from './devHubs.js';

async function cleanupScratchOrgsForHub(hubUsername: string): Promise<void> {
  logger.info(`Querying for scratch orgs in ${hubUsername}...`);
  const csvFile = path.join(process.cwd(), `${hubUsername}_orgs.csv`);
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const query = `SELECT Id FROM ActiveScratchOrg WHERE CreatedDate < ${threeHoursAgo}`;
    const { stdout } = await runSf([
      'data',
      'query',
      '--query',
      query,
      '--result-format',
      'csv',
      '--target-org',
      hubUsername,
    ]);
    await fs.writeFile(csvFile, stdout);
    const fileContent = await fs.readFile(csvFile, 'utf-8');
    // Fixed: the original split on '' (individual characters), so this line count was
    // effectively always > 1 for any non-empty CSV and the "no old scratch orgs" branch below
    // was unreachable. Splitting on newlines actually counts CSV rows.
    const lines = fileContent.trim().split('\n');
    if (lines.length > 1) {
      logger.info(`Found ${lines.length - 1} old scratch orgs in ${hubUsername}. Deleting...`);
      await runSf(
        [
          'data',
          'bulk',
          'delete',
          '--sobject',
          'ActiveScratchOrg',
          '--file',
          csvFile,
          '--target-org',
          hubUsername,
          '--wait',
          '30',
        ],
        {
          stdio: 'inherit',
        },
      );
    } else {
      logger.info(`No old scratch orgs found in ${hubUsername}.`);
    }
  } catch (error) {
    logger.error(
      `Failed to cleanup scratch orgs for ${hubUsername}:`,
      (error as { shortMessage?: string }).shortMessage,
    );
  } finally {
    try {
      await fs.unlink(csvFile);
    } catch {
      /* ignore */
    }
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
