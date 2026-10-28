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

import { promises as fs } from 'node:fs';
import { getDefaultPackageDirectory, readSfdxProject, type SfdxProject } from '@simplysf/simply-core';
import { logger } from '../logger.js';
import {
  assignPermissionSetLicenses as assignLicensesToOrgUser,
  assignPermissionSets as assignPermissionSetsToOrgUser,
  createScratchOrgOnHub,
  type CreatedScratchOrg,
  getOrgConnection,
  getRemainingDailyScratchOrgs,
} from '../sfOrg.js';
import { resolveDevHubs, type ResolvedDevHub } from './devHubs.js';

async function assignPermissionSets(permissionSets: string[], username: string | undefined): Promise<void> {
  if (permissionSets.length === 0) {
    return;
  }
  logger.info('Assigning permission sets...');
  try {
    await assignPermissionSetsToOrgUser(permissionSets, username);
    logger.success('Permission sets assigned successfully.');
  } catch (e) {
    logger.error('Error assigning permission sets:', (e as Error).message);
    throw e;
  }
}

async function assignPermissionSetLicenses(licenses: string[], username: string | undefined): Promise<void> {
  if (licenses.length === 0) {
    return;
  }
  logger.info('Assigning permission set licenses...');
  try {
    await assignLicensesToOrgUser(licenses, username);
    logger.success('Permission set licenses assigned successfully.');
  } catch (e) {
    logger.error('Error assigning permission set licenses:', (e as Error).message);
    throw e;
  }
}

async function assignPermissions(sfdxProjectJson: SfdxProject, username: string | undefined): Promise<void> {
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  const access = defaultPackageDir?.packageMetadataAccess;
  if (!access) {
    return;
  }
  await assignPermissionSets(access.permissionSets ?? [], username);
  await assignPermissionSetLicenses(access.permissionSetLicenses ?? [], username);
}

async function trySetDefaultCountry(username: string | undefined): Promise<void> {
  try {
    // Runs against the just-created scratch org. CountryCode only exists with State and
    // Country/Territory picklists enabled, so this query is the feature probe.
    const connection = await getOrgConnection(username);
    await connection.query('SELECT CountryCode FROM User LIMIT 1');
    logger.info('State/Country picklists detected. Setting default country for user...');
    const { Id } = await connection.singleRecordQuery<{ Id: string }>("SELECT Id FROM User WHERE Name = 'User User'");
    await connection.sobject('User').update({ Id, CountryCode: 'US' });
    logger.success('Default country set.');
  } catch {
    logger.info('State/Country picklists not detected. Skipping default country update.');
  }
}

export type ScratchOrgCreateResult = CreatedScratchOrg;

async function attemptScratchOrgCreation(
  hub: ResolvedDevHub,
  definitionFile: string,
  durationDays: number,
): Promise<ScratchOrgCreateResult | undefined> {
  const remaining = await getRemainingDailyScratchOrgs(hub.username);
  if (remaining === undefined || remaining <= 0) {
    logger.warn(`Dev Hub ${hub.alias} has no remaining scratch orgs. Skipping.`);
    return undefined;
  }
  logger.info(`Attempting to create scratch org with Dev Hub ${hub.alias} (${remaining} remaining).`);

  const createResult = await createScratchOrgOnHub(hub.username, {
    definitionFile,
    durationDays,
    waitMinutes: 20,
    setDefault: true,
  });
  await fs.writeFile('SCRATCH_ORG_INFO.json', JSON.stringify(createResult, null, 2));
  logger.success(`Scratch org created successfully using Dev Hub ${hub.alias}.`);
  return createResult;
}

/**
 * The Dev Hub refusing the signup because its daily allocation is used up. That's the API's own
 * `LIMIT_EXCEEDED` error on the ScratchOrgInfo insert, passed through by @salesforce/core.
 */
function isScratchOrgLimitError(error: unknown, message: string): boolean {
  return (
    (error as { errorCode?: string }).errorCode === 'LIMIT_EXCEEDED' ||
    message.includes(
      'The signup request failed because this organization has reached its daily scratch org signup limit',
    ) ||
    message.includes('LIMIT_EXCEEDED')
  );
}

function extractScratchOrgErrorMessage(error: unknown): string {
  const errorMessage = (error as Error).message;
  logger.error(errorMessage);
  return errorMessage;
}

export type CreateScratchOrgOptions = {
  debug?: boolean;
  scratchDefinitionFile?: string;
  scratchDurationDays?: string;
};

/**
 * Creates a scratch org, trying each Dev Hub in order until one has remaining daily capacity.
 * Writes `SCRATCH_ORG_INFO.json`, best-effort sets a default country, and assigns permission
 * sets/licenses declared in the default package directory's `packageMetadataAccess`.
 *
 * Every Dev Hub alias passed in must already be authenticated by the calling pipeline.
 */
export async function createScratchOrg(
  options: CreateScratchOrgOptions,
  devHubAliases: string[],
): Promise<ScratchOrgCreateResult> {
  const devHubs = await resolveDevHubs(devHubAliases);

  const sfdxProjectJson = await readSfdxProject();
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  const definitionFile = defaultPackageDir?.definitionFile ?? options.scratchDefinitionFile;
  if (!definitionFile) {
    throw new Error('You must specify a definitionFile in the default package directory in sfdx-project.json');
  }

  const rawDurationDays = options.scratchDurationDays ?? '1';
  const durationDays = Number(rawDurationDays);
  // `sf org create scratch --duration-days` accepted 1–30 and rejected anything else up front.
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) {
    throw new Error(`Scratch org duration must be a whole number of days from 1 to 30, got "${rawDurationDays}".`);
  }

  for (const hub of devHubs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each Dev Hub is only attempted after the previous one is exhausted
      const createResult = await attemptScratchOrgCreation(hub, definitionFile, durationDays);
      if (!createResult) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await trySetDefaultCountry(createResult.username);
      // eslint-disable-next-line no-await-in-loop
      await assignPermissions(sfdxProjectJson, createResult.username);
      return createResult;
    } catch (error) {
      logger.error(`Scratch org creation failed with Dev Hub ${hub.alias}:`);
      const errorMessage = extractScratchOrgErrorMessage(error);
      if (isScratchOrgLimitError(error, errorMessage)) {
        logger.warn(`Dev Hub ${hub.alias} reached its daily limit. Trying next Dev Hub...`);
        continue;
      }
      throw new Error(`Scratch org creation failed with a non-recoverable error using Dev Hub ${hub.alias}.`, {
        cause: error,
      });
    }
  }

  throw new Error('Scratch org creation failed for all available Dev Hubs.');
}
