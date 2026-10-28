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

import { AuthInfo, AuthRemover, SfdcUrl, SfError, SfProject } from '@salesforce/core';
import { logger } from './logger.js';

/** `@salesforce/core`'s JWT-capable OAuth options (not exported from its root). */
type JwtOAuth2Config = NonNullable<AuthInfo.Options['oauth2Options']>;

export type AuthenticateOrgOptions = {
  alias?: string;
  authUrl?: string;
  clientId?: string;
  instanceUrl?: string;
  jwtKeyFile?: string;
  username?: string;
  setDefault?: boolean;
  setDefaultDevHub?: boolean;
  debug?: boolean;
};

export type AuthenticateOrgResult = {
  success: boolean;
  username?: string;
  /** The saved auth fields, as `sf org login … --json` returned them (tokens decrypted). */
  result?: unknown;
  message?: string;
};

/**
 * Where a JWT login goes: the given instance URL, else the project's `sfdcLoginUrl`, else
 * production — the same resolution `sf org login jwt` applies, including its refusal of a
 * Lightning domain (`*.lightning.force.com`), which can't serve OAuth.
 */
async function resolveLoginUrl(instanceUrl: string | undefined): Promise<string> {
  let loginUrl = instanceUrl;
  if (!loginUrl) {
    try {
      const projectJson = await (await SfProject.resolve()).resolveProjectConfig();
      loginUrl = typeof projectJson.sfdcLoginUrl === 'string' ? projectJson.sfdcLoginUrl : SfdcUrl.PRODUCTION;
    } catch {
      loginUrl = SfdcUrl.PRODUCTION;
    }
  }
  const url = new SfdcUrl(loginUrl);
  if (url.isLightningDomain() || (url.isInternalUrl() && url.origin.includes('.lightning.'))) {
    throw new SfError(
      'Use the "My Domain" URL (.my.salesforce.com) as the instance URL, not the Lightning domain (.lightning.force.com).',
      'LightningDomain',
    );
  }
  return loginUrl;
}

/** JWT bearer login, as `sf org login jwt`: an existing auth file for the user is replaced. */
async function loginWithJwt(username: string, oauth2Options: JwtOAuth2Config): Promise<AuthInfo> {
  try {
    return await AuthInfo.create({ username, oauth2Options });
  } catch (error) {
    if ((error as Error).name !== 'AuthInfoOverwriteError') {
      throw error;
    }
    await (await AuthRemover.create()).removeAuth(username);
    return AuthInfo.create({ username, oauth2Options });
  }
}

/**
 * Authenticates to a Salesforce org using either a JWT flow or an SFDX auth URL, in-process via
 * `@salesforce/core`. The auth, alias and default-org settings are written to the same `~/.sf`
 * state `sf org login jwt` / `sf org login sfdx-url` write, so later `sf` processes see them.
 *
 * @throws If authentication fails; the failure is logged first.
 */
export async function authenticateOrg(options: AuthenticateOrgOptions): Promise<AuthenticateOrgResult> {
  const { alias, authUrl, clientId, instanceUrl, jwtKeyFile, username, setDefault, setDefaultDevHub, debug } = options;
  const authEntity = alias ?? username ?? 'unknown org';
  logger.info(`Authenticating to org: ${authEntity}`);

  try {
    const authInfo = authUrl
      ? await AuthInfo.create({ oauth2Options: AuthInfo.parseSfdxAuthUrl(authUrl) })
      : await loginWithJwt(username ?? '', {
          clientId,
          privateKeyFile: jwtKeyFile,
          loginUrl: await resolveLoginUrl(instanceUrl),
        });
    await authInfo.save();
    await authInfo.handleAliasAndDefaultSettings({
      alias,
      setDefault: setDefault ?? false,
      setDefaultDevHub: setDefaultDevHub ?? false,
    });

    const fields = authUrl ? { clientSecret: '', ...authInfo.getFields(true) } : authInfo.getFields(true);
    await AuthInfo.identifyPossibleScratchOrgs(fields, authInfo);

    if (debug) {
      // Only identifying fields: the CLI's --json output this used to print included live tokens.
      logger.debug('Authenticated:', {
        username: fields.username,
        orgId: fields.orgId,
        instanceUrl: fields.instanceUrl,
      });
    }

    logger.success(`Successfully authenticated to org: ${authEntity}`);
    return { success: true, username: fields.username ?? username, result: fields };
  } catch (error) {
    logger.error(`Authentication failed for ${authEntity}`);
    logger.error(String(error));
    throw error; // Re-throw for build steps that should fail hard.
  }
}
