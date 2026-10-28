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

import { Org } from '@salesforce/core';

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
