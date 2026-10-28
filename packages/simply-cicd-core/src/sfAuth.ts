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

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSf } from './exec/sfCli.js';
import { logger } from './logger.js';

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
  result?: unknown;
  message?: string;
};

type SfAuthResult = { status: number; message?: string; result?: unknown };

/** Authenticates to a Salesforce organization using either a JWT flow or an SFDX auth URL. */
export async function authenticateOrg(options: AuthenticateOrgOptions): Promise<AuthenticateOrgResult> {
  const { alias, authUrl, clientId, instanceUrl, jwtKeyFile, username, setDefault, setDefaultDevHub, debug } = options;
  const authEntity = alias ?? username ?? 'unknown org';
  logger.info(`Authenticating to org: ${authEntity}`);

  try {
    let authArgs: string[];

    if (authUrl) {
      const tempDir = await mkdtemp(join(tmpdir(), 'sfdx-auth-'));
      const authUrlFile = join(tempDir, 'auth-url.txt');
      await writeFile(authUrlFile, authUrl);
      authArgs = ['org', 'login', 'sfdx-url', '--sfdx-url-file', authUrlFile, '--json'];
    } else {
      authArgs = [
        'login',
        'org',
        'jwt',
        '--username',
        username ?? '',
        '--jwt-key-file',
        jwtKeyFile ?? '',
        '--client-id',
        clientId ?? '',
        '--instance-url',
        instanceUrl ?? '',
        '--json',
      ];
    }

    if (alias) {
      authArgs.push('--alias', alias);
    }
    if (setDefault) {
      authArgs.push('--set-default');
    }
    if (setDefaultDevHub) {
      authArgs.push('--set-default-dev-hub');
    }

    const { stdout } = await runSf(authArgs);

    if (debug) {
      logger.raw(stdout);
    }

    const authResult = JSON.parse(stdout) as SfAuthResult;
    if (authResult.status > 0) {
      logger.error(`Authentication failed for ${authEntity}: ${authResult.message ?? 'unknown error'}`);
      // In cleanup, we don't want to exit the whole process.
      return { success: false, message: authResult.message, username };
    }

    logger.success(`Successfully authenticated to org: ${authEntity}`);
    return { success: true, username, result: authResult.result };
  } catch (error) {
    logger.error(`Authentication failed for ${authEntity}`);
    logger.error(String(error));
    throw error; // Re-throw for build steps that should fail hard.
  }
}
