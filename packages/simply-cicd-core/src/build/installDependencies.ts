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

import { logger } from '../logger.js';
import {
  installPackageDependencies as installPackageDependenciesCommon,
  type PackageInstallUpgradeType,
} from '../sfPackages.js';
import { ensureScratchOrgSession } from './scratchOrgAuth.js';
import { readScratchOrgInfo } from './scratchOrgInfo.js';

export type InstallDependenciesOptions = {
  /** Required only when the scratch org's Dev Hub was JWT-authenticated (no refresh token available). */
  jwtKeyFile?: string;
  debug?: boolean;
  installType?: 'All' | 'Delta' | 'Upgrade';
  upgradeType?: PackageInstallUpgradeType;
  /**
   * Number of additional attempts to make when a package install fails, before giving up on it.
   * Default: `0`.
   */
  retryAttempts?: number;
  /** Factor the delay between retries grows by after each failed attempt. Default: `2`. */
  retryBackoff?: number;
  /**
   * Per-package overrides of `retryAttempts`, keyed by alias/04t or as an array of `<aliasOrId>:<count>` strings.
   */
  packageRetryAttempts?: Record<string, number> | string[];
};

/** Authenticates to the scratch org (recorded in `SCRATCH_ORG_INFO.json`) and installs its packaged dependencies. */
export async function installDependencies(options: InstallDependenciesOptions): Promise<void> {
  logger.info('Installing package dependencies into scratch org...');
  const scratchOrgInfo = await readScratchOrgInfo();
  await ensureScratchOrgSession(scratchOrgInfo.authFields, {
    jwtKeyFile: options.jwtKeyFile,
    setDefault: true,
    debug: options.debug,
  });
  // The install runs in-process (not via a child `sf` invocation that would read the default org
  // just written to config), so target the scratch org explicitly by its username.
  await installPackageDependenciesCommon({
    alias: scratchOrgInfo.authFields.username,
    wait: '240',
    installType: options.installType,
    upgradeType: options.upgradeType,
    retryAttempts: options.retryAttempts,
    retryBackoff: options.retryBackoff,
    packageRetryAttempts: options.packageRetryAttempts,
  });
  logger.success('Package dependencies installed.');
}
