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

import { Org, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  installPackageDependencies as installPackageDependenciesCore,
  type InstallPackageDependenciesProgress,
  type PackageInstallType,
  type PackageInstallUpgradeType,
  type PackageToInstall,
} from '@simplysf/simply-package-core';
import { PackageVersion, SubscriberPackageVersion, type PackageVersionReportResult } from '@salesforce/packaging';
import { logger } from './logger.js';
import type { UpgradedPackage } from './schemas/deployProgress.js';

export type { PackageInstallUpgradeType, PackageToInstall };

export type InstallPackageDependenciesConfig = {
  /** Alias or username of the target org. Omit to use the default target org. */
  alias?: string;
  /** Minutes to wait for each package install to complete. */
  wait?: string;
  installType?: PackageInstallType;
  /** What happens to components an unlocked package upgrade removes. */
  upgradeType?: PackageInstallUpgradeType;
};

export type { PackageVersionReportResult };

/**
 * Adapts the library's progress callbacks onto this package's logger. Step boundaries become info
 * lines; in-flight status (which fires on every poll) is logged only when its text changes.
 */
function loggerProgress(): InstallPackageDependenciesProgress {
  let lastStatus: string | undefined;

  return {
    info: (message): void => logger.info(message),
    warn: (message): void => logger.warn(message),
    stepStart: (message): void => {
      lastStatus = undefined;
      logger.info(message);
    },
    stepStatus: (message): void => {
      if (message !== lastStatus) {
        lastStatus = message;
        logger.info(message);
      }
    },
    stepStop: (message): void => {
      if (message) {
        logger.warn(message);
      }
    },
  };
}

/**
 * Installs the Salesforce package dependencies defined in `sfdx-project.json` into the target org,
 * in-process via `@simplysf/simply-package-core`. The org must already be authenticated; every
 * confirmation is auto-approved, as befits a pipeline.
 *
 * @returns The install outcome for every resolved dependency, including the ones skipped.
 */
export async function installPackageDependencies(
  config: InstallPackageDependenciesConfig = {},
): Promise<PackageToInstall[]> {
  const { alias, wait = '120', installType = 'Upgrade', upgradeType = 'Mixed' } = config;

  logger.info('Installing packaged dependencies...');
  try {
    const org = await Org.create({ aliasOrUsername: alias });
    const project = await SfProject.resolve();

    const results = await installPackageDependenciesCore({
      project,
      targetOrgConnection: org.getConnection(),
      apexCompile: 'package',
      installType,
      upgradeType,
      wait: Duration.minutes(parseInt(wait, 10)),
      progress: loggerProgress(),
    });

    logger.success('Packaged dependencies installed successfully.');
    return results;
  } catch (error) {
    logger.error('Failed to install packaged dependencies.');
    logger.error(String(error));
    throw error;
  }
}

export type ResolveUpgradedPackagesConfig = {
  /** The packaging DevHub's alias. Must already be authenticated. */
  packagingDevhub?: string;
};

/** @returns The install results that upgraded an already-installed package. */
function upgradedEntries(installResults: PackageToInstall[]): PackageToInstall[] {
  return installResults.filter(
    (entry) =>
      entry.Status === 'Installed' &&
      Boolean(entry.ExistingSubscriberPackageVersionId) &&
      entry.ExistingSubscriberPackageVersionId !== entry.SubscriberPackageVersionId,
  );
}

/**
 * The Dev Hub's report for one package version: what `sf package version report --json` returns,
 * including the computed `Version` (`major.minor.patch.build`), `Tag`, `Description` and
 * `CodeCoverage`.
 *
 * Unlike the CLI, `CodeCoverage` is `null` (not `'N/A'`) for a version that skipped validation or
 * belongs to an org-dependent package.
 *
 * @param packageVersionId - A `04t` subscriber package version ID (or `05i` package version ID).
 * @param devHubAliasOrUsername - The Dev Hub that owns the package. Must already be authenticated.
 * @throws {SfError} If the Dev Hub can't be resolved or the version doesn't exist.
 */
export async function getPackageVersionReport(
  packageVersionId: string,
  devHubAliasOrUsername: string,
): Promise<PackageVersionReportResult> {
  const devHub = await Org.create({ aliasOrUsername: devHubAliasOrUsername });
  const packageVersion = new PackageVersion({
    connection: devHub.getConnection(),
    project: undefined,
    idOrAlias: packageVersionId,
  });
  return packageVersion.report();
}

/** One row of {@link listInstalledPackages}: the fields `sf package installed list --json` returns. */
export type InstalledPackage = {
  Id: string;
  SubscriberPackageId: string;
  SubscriberPackageName?: string;
  SubscriberPackageNamespace?: string;
  SubscriberPackageVersionId?: string;
  SubscriberPackageVersionName?: string;
  /** `major.minor.patch.build`. */
  SubscriberPackageVersionNumber?: string;
};

/**
 * The packages installed in an org, shaped like `sf package installed list --json`'s result rows.
 *
 * @param aliasOrUsername - The org to inspect. Must already be authenticated.
 */
export async function listInstalledPackages(aliasOrUsername: string): Promise<InstalledPackage[]> {
  const org = await Org.create({ aliasOrUsername });
  const installed = await SubscriberPackageVersion.installedList(org.getConnection());
  return installed.map((row) => ({
    Id: row.Id,
    SubscriberPackageId: row.SubscriberPackageId,
    ...(row.SubscriberPackage
      ? {
          SubscriberPackageName: row.SubscriberPackage.Name,
          SubscriberPackageNamespace: row.SubscriberPackage.NamespacePrefix,
        }
      : {}),
    ...(row.SubscriberPackageVersion
      ? {
          SubscriberPackageVersionId: row.SubscriberPackageVersion.Id,
          SubscriberPackageVersionName: row.SubscriberPackageVersion.Name,
          SubscriberPackageVersionNumber: [
            row.SubscriberPackageVersion.MajorVersion,
            row.SubscriberPackageVersion.MinorVersion,
            row.SubscriberPackageVersion.PatchVersion,
            row.SubscriberPackageVersion.BuildNumber,
          ].join('.'),
        }
      : {}),
  }));
}

/** {@link getPackageVersionReport}, but warns and returns `undefined` on failure. */
async function reportPackageVersion(
  subscriberPackageVersionId: string,
  packagingDevhub: string,
): Promise<PackageVersionReportResult | undefined> {
  try {
    return await getPackageVersionReport(subscriberPackageVersionId, packagingDevhub);
  } catch (error) {
    logger.warn(`Could not get package version report for ${subscriberPackageVersionId}: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * For every package an {@link installPackageDependencies} run upgraded, fetches the previous and
 * target version's `sf package version report` (for the origin commit SHA and pipeline URL). A
 * package whose version report can't be resolved is skipped with a warning rather than failing the
 * whole deployment — this data only feeds a later notification.
 */
export async function resolveUpgradedPackages(
  installResults: PackageToInstall[],
  config: ResolveUpgradedPackagesConfig,
): Promise<UpgradedPackage[]> {
  const upgraded = upgradedEntries(installResults);
  if (upgraded.length === 0) {
    return [];
  }

  const { packagingDevhub } = config;
  if (!packagingDevhub) {
    logger.warn('No --packaging-devhub given. Skipping origin lookup for upgraded packages.');
    return [];
  }

  const upgradedPackages: UpgradedPackage[] = [];

  for (const entry of upgraded) {
    // eslint-disable-next-line no-await-in-loop -- each package's prev/target reports are fetched concurrently, but packages themselves are processed one at a time
    const [prevReport, targetReport] = await Promise.all([
      reportPackageVersion(entry.ExistingSubscriberPackageVersionId, packagingDevhub),
      reportPackageVersion(entry.SubscriberPackageVersionId, packagingDevhub),
    ]);

    if (!prevReport || !targetReport) {
      continue;
    }

    upgradedPackages.push({
      packageName: entry.PackageName,
      prevVersionId: entry.ExistingSubscriberPackageVersionId,
      prevVersionNumber: prevReport.Version,
      prevTag: prevReport.Tag,
      targetVersionId: entry.SubscriberPackageVersionId,
      targetVersionNumber: targetReport.Version,
      targetTag: targetReport.Tag,
      targetDescription: targetReport.Description,
    });
  }

  return upgradedPackages;
}
