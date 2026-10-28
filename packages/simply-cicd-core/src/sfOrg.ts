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
import { AuthInfo, AuthRemover, Org, scratchOrgCreate, SfError, User, type Connection } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { escapeSoqlLiteral } from '@simplysf/simply-core';
import { logger } from './logger.js';

/**
 * The org's instance URL, e.g. `https://my-domain.my.salesforce.com`.
 *
 * @param aliasOrUsername - The org to look up. Omit (or pass `''`) to use the default target org.
 */
export async function getOrgInstanceUrl(aliasOrUsername?: string): Promise<string> {
  // Callers pass '' for "no --alias given", which `sf org display --target-org ''` treated as the
  // default target org; Org.create only does that for undefined.
  const org = await Org.create({ aliasOrUsername: aliasOrUsername === '' ? undefined : aliasOrUsername });
  return org.getConnection().instanceUrl;
}

type OrgLimits = Partial<Record<string, { Max: number; Remaining: number }>>;

/**
 * How many more scratch orgs the Dev Hub may create today (its `DailyScratchOrgs` limit), or
 * `undefined` when the org doesn't report that limit.
 *
 * @param hubAliasOrUsername - The Dev Hub. Must already be authenticated.
 */
export async function getRemainingDailyScratchOrgs(hubAliasOrUsername: string): Promise<number | undefined> {
  const org = await Org.create({ aliasOrUsername: hubAliasOrUsername });
  const limits = (await org.getConnection().limits()) as unknown as OrgLimits;
  return limits.DailyScratchOrgs?.Remaining;
}

/**
 * A connection to an authenticated org.
 *
 * @param aliasOrUsername - The org. Omit to use the default target org, as `sf` commands without
 * `--target-org` do.
 */
export async function getOrgConnection(aliasOrUsername?: string): Promise<Connection> {
  const org = await Org.create({ aliasOrUsername });
  return org.getConnection();
}

/** One failed assignment, shaped like the `failures` entries of `sf org assign … --json`. */
export type AssignmentFailure = { name: string; message: string };

/** Thrown when any assignment failed; `failures` lists each one. */
export class AssignmentError extends Error {
  public constructor(
    message: string,
    public readonly failures: AssignmentFailure[],
  ) {
    super(`${message}: ${JSON.stringify(failures)}`);
    this.name = 'AssignmentError';
  }
}

async function resolveOrgUser(aliasOrUsername?: string): Promise<{ org: Org; username: string; userId: string }> {
  const org = await Org.create({ aliasOrUsername });
  const username = org.getUsername() ?? '';
  const { Id: userId } = await org
    .getConnection()
    .singleRecordQuery<{ Id: string }>(`SELECT Id FROM User WHERE Username = '${escapeSoqlLiteral(username)}'`);
  return { org, username, userId };
}

/**
 * Assigns permission sets to an org's own user, one at a time: what `sf org assign permset --name …`
 * does. An already-assigned permission set is a failure, as it is for the CLI.
 *
 * @param permissionSetNames - Permission set API names.
 * @param aliasOrUsername - The org. Omit to use the default target org.
 * @throws {AssignmentError} If any assignment failed; the others are still attempted.
 */
export async function assignPermissionSets(permissionSetNames: string[], aliasOrUsername?: string): Promise<void> {
  const { org, username, userId } = await resolveOrgUser(aliasOrUsername);
  const user = await User.create({ org });
  const failures: AssignmentFailure[] = [];
  for (const permissionSetName of permissionSetNames) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one at a time, matching the CLI
      await user.assignPermissionSets(userId, [permissionSetName]);
    } catch (error) {
      failures.push({ name: username, message: (error as Error).message });
    }
  }
  if (failures.length > 0) {
    throw new AssignmentError('Permission set assignment failed', failures);
  }
}

/**
 * Assigns permission set licenses to an org's own user: what `sf org assign permset-license --name …`
 * does. A license is matched by `DeveloperName` or `MasterLabel`; one that is already assigned is
 * a success (with a warning), as it is for the CLI.
 *
 * @param licenseNames - Permission set license developer names or labels.
 * @param aliasOrUsername - The org. Omit to use the default target org.
 * @throws {AssignmentError} If any assignment failed; the others are still attempted.
 */
export async function assignPermissionSetLicenses(licenseNames: string[], aliasOrUsername?: string): Promise<void> {
  const { org, username, userId } = await resolveOrgUser(aliasOrUsername);
  const connection = org.getConnection();
  const failures: AssignmentFailure[] = [];
  for (const licenseName of licenseNames) {
    const literal = escapeSoqlLiteral(licenseName);
    let licenseId: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- one at a time, keeps failures in input order
      ({ Id: licenseId } = await connection.singleRecordQuery<{ Id: string }>(
        `SELECT Id FROM PermissionSetLicense WHERE DeveloperName = '${literal}' OR MasterLabel = '${literal}'`,
      ));
    } catch {
      failures.push({ name: username, message: `PermissionSetLicense not found: ${licenseName}` });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- see above
      await connection
        .sobject('PermissionSetLicenseAssign')
        .create({ AssigneeId: userId, PermissionSetLicenseId: licenseId });
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith('duplicate value found')) {
        logger.warn(`Permission set license ${licenseName} is already assigned to ${username}.`);
      } else {
        failures.push({ name: username, message });
      }
    }
  }
  if (failures.length > 0) {
    throw new AssignmentError('Permission set license assignment failed', failures);
  }
}

/** What `sf org create scratch --json` returns: the fields `SCRATCH_ORG_INFO.json` is written from. */
export type CreatedScratchOrg = {
  username?: string;
  scratchOrgInfo?: Record<string, unknown>;
  authFields?: Record<string, unknown>;
  warnings: string[];
  orgId?: string;
};

export type CreateScratchOrgOnHubOptions = {
  /** Path to the scratch org definition file. */
  definitionFile: string;
  durationDays: number;
  /** Minutes to wait for the org to be ready. */
  waitMinutes: number;
  /** Make the new org the default target org (`--set-default`). */
  setDefault?: boolean;
};

/**
 * Creates a scratch org from a Dev Hub, as `sf org create scratch --definition-file … --json` does,
 * and returns the same result shape. The org is authenticated and source tracking is enabled, as
 * the CLI's defaults.
 *
 * @param hubAliasOrUsername - The Dev Hub. Must already be authenticated.
 * @throws {SfError} If signup fails or doesn't finish within the wait.
 */
export async function createScratchOrgOnHub(
  hubAliasOrUsername: string,
  options: CreateScratchOrgOnHubOptions,
): Promise<CreatedScratchOrg> {
  const hubOrg = await Org.create({ aliasOrUsername: hubAliasOrUsername });
  const orgConfig = JSON.parse(await fs.readFile(options.definitionFile, 'utf-8')) as Record<string, unknown>;
  const { username, scratchOrgInfo, authFields, warnings } = await scratchOrgCreate({
    hubOrg,
    orgConfig,
    durationDays: options.durationDays,
    wait: Duration.minutes(options.waitMinutes),
    setDefault: options.setDefault ?? false,
    tracksSource: true,
  });
  if (!scratchOrgInfo) {
    throw new SfError('The scratch org did not return with any information');
  }
  // Round-trip through JSON so the result is exactly what the CLI serialized (dates as strings, no
  // class instances), since callers persist it as SCRATCH_ORG_INFO.json.
  return JSON.parse(
    JSON.stringify({ username, scratchOrgInfo, authFields, warnings, orgId: authFields?.orgId }),
  ) as CreatedScratchOrg;
}

/**
 * Deletes a scratch org, as `sf org delete scratch --no-prompt` does: refuses a non-scratch org,
 * treats an already-deleted org as success, and removes the local auth for one whose domain no
 * longer resolves.
 *
 * @param aliasOrUsername - The scratch org. Omit to use the default target org.
 * @returns The deleted org's username.
 * @throws {SfError} If the org isn't a scratch org, or the Dev Hub rejects the delete.
 */
export async function deleteTargetScratchOrg(aliasOrUsername?: string): Promise<string> {
  const org = await Org.create({ aliasOrUsername });
  const username = org.getUsername() ?? '';
  const { isScratch } = (await AuthInfo.create({ username })).getFields();
  if (!isScratch) {
    throw new SfError(`The target org (${username}) is not a scratch org.`, 'NotAScratchOrgError');
  }
  try {
    await org.delete();
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'DomainNotFoundError') {
      await (await AuthRemover.create()).removeAuth(username);
    } else if (name === 'ScratchOrgNotFound') {
      logger.info(`Scratch org ${username} was already deleted.`);
    } else {
      throw error;
    }
  }
  return username;
}
