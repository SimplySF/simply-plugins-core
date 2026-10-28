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

import { AuthInfo, ConfigAggregator, Org, SfError, StateAggregator } from '@salesforce/core';

export type ResolveOrgOptions = {
  /** Fall back to the default Dev Hub (`target-dev-hub`) instead of the default target org. */
  isDevHub?: boolean;
};

/**
 * The authenticated org that an `--alias`/`--target-org`-style value names, resolved the way `sf`
 * resolves `--target-org`: an alias or the username of an existing auth, with a blank value meaning
 * the default target org (or, with `isDevHub`, the default Dev Hub).
 *
 * The default is re-read from disk on every call. `@salesforce/core` caches config per process, so
 * without that a default set earlier in the same run (`setDefault` on a login or a scratch org
 * create) would be missed, and the previous default org used instead.
 *
 * @throws {SfError} `NamedOrgNotFoundError` if no auth exists for the alias/username;
 * `NoUsernameFoundError` if the value is blank and no default is set.
 */
export async function resolveOrg(aliasOrUsername?: string, options: ResolveOrgOptions = {}): Promise<Org> {
  const { isDevHub } = options;
  const name = aliasOrUsername?.trim();
  if (name) {
    return Org.create({ aliasOrUsername: name, isDevHub });
  }
  const aggregator = await (await ConfigAggregator.create()).reload();
  return Org.create({ aggregator, isDevHub });
}

/**
 * The saved auth for an alias or username, without connecting to the org. `AuthInfo.create` only
 * accepts a username, so an alias is resolved to its username first.
 *
 * @throws {SfError} `NamedOrgNotFoundError` if no auth exists for the alias/username;
 * `NoUsernameFoundError` if it's blank (rather than `AuthInfo.create`'s unhelpful
 * `AuthInfoCreationError`).
 */
export async function resolveAuthInfo(aliasOrUsername: string): Promise<AuthInfo> {
  const name = aliasOrUsername.trim();
  if (!name) {
    throw new SfError('No org alias or username was given (it was empty).', 'NoUsernameFoundError');
  }
  const stateAggregator = await StateAggregator.getInstance();
  return AuthInfo.create({ username: stateAggregator.aliases.resolveUsername(name) });
}
