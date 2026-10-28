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

import { Connection, SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { PackageInstallCreateRequest, PackagingSObjects, SubscriberPackageVersion } from '@salesforce/packaging';
import {
  MIN_API_VERSION,
  securityTypeApiValue,
  upgradeTypeApiValue,
  type PackageInstallApexCompileType,
  type PackageInstallSecurityType,
  type PackageInstallUpgradeType,
} from './packageDependenciesInstall.js';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

export type InstallPackageVersionOptions = {
  /** Connection to the org to install into. */
  targetOrgConnection: Connection;
  /** A `04t` subscriber package version ID, or an alias the project resolves to one. */
  aliasOrId: string;
  /** How long to wait for the install to finish. */
  wait: Duration;
  installationKey?: string;
  /** Defaults to `'all'`, as `sf package install --apex-compile` does. */
  apexCompile?: PackageInstallApexCompileType;
  /** Defaults to `'AdminsOnly'`, as `sf package install --security-type` does. */
  securityType?: PackageInstallSecurityType;
  /** Defaults to `'Mixed'`, as `sf package install --upgrade-type` does. */
  upgradeType?: PackageInstallUpgradeType;
};

export type InstallPackageVersionResult = {
  /**
   * `'SUCCESS'`, or `'IN_PROGRESS'` when `wait` ran out first: the install carries on in the org,
   * and, as with `sf package install`, that isn't treated as a failure.
   */
  status: 'SUCCESS' | 'IN_PROGRESS';
  request: PackageInstallRequest;
};

/**
 * Installs one package version into an org, non-interactively: what
 * `sf package install --package <id> --no-prompt --wait <wait>` does. Remote site settings the
 * package declares are approved, as `--no-prompt` approves them.
 *
 * @throws {SfError} `ApiVersionTooLowError` if the org's API version is below 36.0.
 * @throws {SfError} `PackageInstallError` if the install finished with an error, listing each one.
 */
export async function installPackageVersion(
  options: InstallPackageVersionOptions,
): Promise<InstallPackageVersionResult> {
  const {
    targetOrgConnection,
    aliasOrId,
    wait,
    installationKey,
    apexCompile = 'all',
    securityType = 'AdminsOnly',
    upgradeType = 'Mixed',
  } = options;

  if (parseInt(targetOrgConnection.getApiVersion(), 10) < MIN_API_VERSION) {
    throw new SfError(
      `Package installation is supported only on API versions ${MIN_API_VERSION}.0 and higher.`,
      'ApiVersionTooLowError',
    );
  }

  const subscriberPackageVersion = new SubscriberPackageVersion({
    aliasOrId,
    connection: targetOrgConnection,
    password: installationKey,
  });
  const request: PackageInstallCreateRequest = {
    SubscriberPackageVersionKey: await subscriberPackageVersion.getId(),
    Password: installationKey,
    ApexCompileType: apexCompile,
    SecurityType: securityTypeApiValue[securityType],
    UpgradeType: upgradeTypeApiValue[upgradeType],
  };
  if (await subscriberPackageVersion.getExternalSites()) {
    request.EnableRss = true;
  }

  let installRequest: PackageInstallRequest;
  try {
    installRequest = await subscriberPackageVersion.install(request, {
      pollingTimeout: wait,
      pollingFrequency: Duration.seconds(2),
    });
  } catch (error) {
    // A polling timeout carries the still-running request; anything else is a real failure.
    if (!(error instanceof SfError && error.data)) {
      throw error;
    }
    installRequest = error.data as PackageInstallRequest;
  }

  if (installRequest.Status === 'SUCCESS') {
    return { status: 'SUCCESS', request: installRequest };
  }
  if (installRequest.Status === 'IN_PROGRESS' || installRequest.Status === 'UNKNOWN') {
    return { status: 'IN_PROGRESS', request: installRequest };
  }
  const errors = installRequest.Errors?.errors ?? [];
  const detail = errors.length
    ? `Installation errors: ${errors.map((e, i) => `\n${i + 1}) ${e.message}`).join('')}`
    : '<empty>';
  throw new SfError(`Encountered errors installing the package! ${detail}`, 'PackageInstallError');
}
