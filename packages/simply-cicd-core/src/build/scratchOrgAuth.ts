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

import { AuthInfo, SfError } from '@salesforce/core';
import { authenticateOrg } from '../sfAuth.js';
import type { ScratchOrgInfo } from './scratchOrgInfo.js';

export type EnsureScratchOrgSessionOptions = {
  /** Required only when the scratch org's Dev Hub was JWT-authenticated (no refresh token available). */
  jwtKeyFile?: string;
  debug?: boolean;
  setDefault?: boolean;
};

/**
 * Ensures the scratch org recorded in `SCRATCH_ORG_INFO.json` has a live session, using whichever
 * renewable credential it actually has.
 *
 * A scratch org whose Dev Hub authenticated via web/SFDX auth-url gets its own `refreshToken` at
 * creation time (Salesforce's OAuth "web server" flow always returns one) — that's used directly
 * via `@salesforce/core`, no shell-out. A JWT-authenticated Dev Hub never produces a refresh token
 * (JWT bearer grants don't have one), so that case still falls back to the existing
 * `authenticateOrg()` JWT re-auth.
 */
export async function ensureScratchOrgSession(
  authFields: ScratchOrgInfo['authFields'],
  options: EnsureScratchOrgSessionOptions,
): Promise<void> {
  const { username, clientId, instanceUrl, refreshToken, clientSecret } = authFields;

  if (refreshToken) {
    const authInfo = await AuthInfo.create({
      oauth2Options: { clientId, clientSecret, refreshToken, loginUrl: instanceUrl },
    });
    await authInfo.save();
    if (options.setDefault) {
      await authInfo.handleAliasAndDefaultSettings({ setDefault: true, setDefaultDevHub: false });
    }
    return;
  }

  if (!options.jwtKeyFile) {
    throw new SfError(
      `No refresh token available for org ${username} and no --jwt-key-file was provided; cannot re-authenticate.`,
      'ScratchOrgReauthError',
    );
  }

  await authenticateOrg({
    username,
    clientId,
    instanceUrl,
    jwtKeyFile: options.jwtKeyFile,
    setDefault: options.setDefault,
    debug: options.debug,
  });
}
