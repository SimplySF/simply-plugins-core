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

import { Org, User, type Connection } from '@salesforce/core';
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
