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

import { AuthInfo } from '@salesforce/core';

export type ResolvedDevHub = {
  /** The alias (or username) the caller passed in. */
  alias: string;
  /** The Dev Hub's canonical username, resolved from the alias. */
  username: string;
  instanceUrl: string;
  clientId?: string;
  /** Only present when the Dev Hub was JWT-authenticated. */
  privateKeyFile?: string;
};

/**
 * Resolves a Dev Hub alias to its already-authenticated config. `simply-cicd` never authenticates
 * Dev Hubs itself — the alias must already be authenticated (by the calling pipeline, however it
 * chooses to do that: JWT, web, SFDX auth-url, or Client Credentials) before this runs.
 *
 * `clientId`/`instanceUrl`/`privateKey` are all stored in plaintext in a Dev Hub's `AuthInfo` (only
 * token/password/secret-named fields are encrypted at rest), so no decryption is needed to read them.
 *
 * @throws {SfError} `NamedOrgNotFoundError` if the alias hasn't already been authenticated.
 */
async function resolveDevHub(alias: string): Promise<ResolvedDevHub> {
  const authInfo = await AuthInfo.create({ username: alias });
  const fields = authInfo.getFields();

  return {
    alias,
    username: authInfo.getUsername(),
    instanceUrl: fields.instanceUrl ?? '',
    clientId: fields.clientId,
    privateKeyFile: fields.privateKey,
  };
}

/** Resolves multiple Dev Hub aliases in parallel. Each must already be authenticated. */
export async function resolveDevHubs(aliases: string[]): Promise<ResolvedDevHub[]> {
  return Promise.all(aliases.map(resolveDevHub));
}
