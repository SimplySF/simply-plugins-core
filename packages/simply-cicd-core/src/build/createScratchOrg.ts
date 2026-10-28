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
import { runSf, runSfJson } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { resolveDevHubs, type ResolvedDevHub } from './devHubs.js';

type SfPermsetAssignResult = { status: number; failures?: unknown };

async function assignPermissionSets(permissionSets: string[]): Promise<void> {
  if (permissionSets.length === 0) {
    return;
  }
  logger.info('Assigning permission sets...');
  const args = ['org', 'assign', 'permset', '--json', ...permissionSets.flatMap((ps) => ['--name', ps])];
  try {
    const result = await runSfJson<SfPermsetAssignResult>(args);
    if (result.status !== 0) {
      throw new Error(`Permission set assignment failed: ${JSON.stringify(result.failures)}`);
    }
    logger.success('Permission sets assigned successfully.');
  } catch (e) {
    logger.error('Error assigning permission sets:', (e as Error).message);
    throw e;
  }
}

async function assignPermissionSetLicenses(licenses: string[]): Promise<void> {
  if (licenses.length === 0) {
    return;
  }
  logger.info('Assigning permission set licenses...');
  const args = ['org', 'assign', 'permset-license', '--json', ...licenses.flatMap((psl) => ['--name', psl])];
  try {
    const result = await runSfJson<SfPermsetAssignResult>(args);
    if (result.status !== 0) {
      throw new Error(`Permission set license assignment failed: ${JSON.stringify(result.failures)}`);
    }
    logger.success('Permission set licenses assigned successfully.');
  } catch (e) {
    logger.error('Error assigning permission set licenses:', (e as Error).message);
    throw e;
  }
}

async function assignPermissions(sfdxProjectJson: SfdxProject): Promise<void> {
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  const access = defaultPackageDir?.packageMetadataAccess;
  if (!access) {
    return;
  }
  await assignPermissionSets(access.permissionSets ?? []);
  await assignPermissionSetLicenses(access.permissionSetLicenses ?? []);
}

async function checkHubRemainingScratchOrgs(hubUsername: string): Promise<number | undefined> {
  const limits = await runSfJson<{ result: Array<{ name: string; remaining: number }> }>([
    'org',
    'list',
    'limits',
    '--target-org',
    hubUsername,
    '--json',
  ]);
  return limits.result.find((l) => l.name === 'DailyScratchOrgs')?.remaining;
}

async function trySetDefaultCountry(): Promise<void> {
  try {
    await runSf(['data', 'query', '--query', 'SELECT CountryCode FROM User', '--json']);
    logger.info('State/Country picklists detected. Setting default country for user...');
    await runSf([
      'data',
      'update',
      'record',
      '--sobject',
      'User',
      '--where',
      "Name='User User'",
      '--values',
      "CountryCode='US'",
    ]);
    logger.success('Default country set.');
  } catch {
    logger.info('State/Country picklists not detected. Skipping default country update.');
  }
}

export type ScratchOrgCreateResult = Record<string, unknown>;

async function attemptScratchOrgCreation(
  hub: ResolvedDevHub,
  definitionFile: string,
  duration: string,
): Promise<ScratchOrgCreateResult | undefined> {
  const remaining = await checkHubRemainingScratchOrgs(hub.username);
  if (remaining === undefined || remaining <= 0) {
    logger.warn(`Dev Hub ${hub.alias} has no remaining scratch orgs. Skipping.`);
    return undefined;
  }
  logger.info(`Attempting to create scratch org with Dev Hub ${hub.alias} (${remaining} remaining).`);

  const { stdout } = await runSf([
    'org',
    'create',
    'scratch',
    '--target-dev-hub',
    hub.username,
    '--duration-days',
    duration,
    '--definition-file',
    definitionFile,
    '--wait',
    '20',
    '--set-default',
    '--json',
  ]);
  const createResult = (JSON.parse(stdout) as { result: ScratchOrgCreateResult }).result;
  await fs.writeFile('SCRATCH_ORG_INFO.json', JSON.stringify(createResult, null, 2));
  logger.success(`Scratch org created successfully using Dev Hub ${hub.alias}.`);
  return createResult;
}

function isScratchOrgLimitError(message: string): boolean {
  return (
    message.includes(
      'The signup request failed because this organization has reached its daily scratch org signup limit',
    ) || message.includes('LIMIT_EXCEEDED')
  );
}

function extractScratchOrgErrorMessage(error: unknown): string {
  const err = error as Error & { stdout?: string };
  let errorMessage = err.message;
  if (err.stdout) {
    try {
      const errorResult = JSON.parse(err.stdout) as { message?: string; stack?: string };
      errorMessage = errorResult.message ?? errorMessage;
      logger.error(errorMessage);
      if (errorResult.stack) {
        logger.error(errorResult.stack);
      }
    } catch {
      logger.error(err.stdout);
    }
  } else {
    logger.error(err.message);
  }
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

  const duration = options.scratchDurationDays ?? '1';

  for (const hub of devHubs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each Dev Hub is only attempted after the previous one is exhausted
      const createResult = await attemptScratchOrgCreation(hub, definitionFile, duration);
      if (!createResult) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await trySetDefaultCountry();
      // eslint-disable-next-line no-await-in-loop
      await assignPermissions(sfdxProjectJson);
      return createResult;
    } catch (error) {
      logger.error(`Scratch org creation failed with Dev Hub ${hub.alias}:`);
      const errorMessage = extractScratchOrgErrorMessage(error);
      if (isScratchOrgLimitError(errorMessage)) {
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
