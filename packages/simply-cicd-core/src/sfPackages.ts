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

import { SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  installPackageDependencies as installPackageDependenciesCore,
  type InstallPackageDependenciesProgress,
  type PackageInstallType,
  type PackageInstallUpgradeType,
  type PackageToInstall,
} from '@simplysf/simply-package-core';
import {
  PackageVersion,
  SubscriberPackageVersion,
  type PackageVersionCreateRequestResult,
  type PackageVersionReportResult,
} from '@salesforce/packaging';
import { logger } from './logger.js';
import { resolveOrg } from './resolveOrg.js';
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
    const org = await resolveOrg(alias);
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
  const devHub = await resolveOrg(devHubAliasOrUsername, { isDevHub: true });
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
  const org = await resolveOrg(aliasOrUsername);
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

export type { PackageVersionCreateRequestResult };

export type RequestPackageVersionCreateOptions = {
  /** The packaging Dev Hub. Must already be authenticated. */
  devHubAliasOrUsername: string;
  /** The package's alias in `packageAliases` (or its `0Ho` ID). */
  packageId: string;
  definitionFile: string;
  versionDescription: string;
  tag: string;
  branch?: string;
};

/**
 * Starts a package version create and returns its request (`08c`) without waiting: what
 * `sf package version create --code-coverage --installation-key-bypass --wait 0` does, run from the
 * SFDX project in the current directory. Poll it with {@link getPackageVersionCreateStatus}.
 *
 * Like the CLI, this applies `sfdx-project.json` string replacements while converting source
 * (`SF_APPLY_REPLACEMENTS_ON_CONVERT`).
 */
export async function requestPackageVersionCreate(
  options: RequestPackageVersionCreateOptions,
): Promise<PackageVersionCreateRequestResult> {
  const devHub = await resolveOrg(options.devHubAliasOrUsername, { isDevHub: true });
  const project = await SfProject.resolve();
  const previous = process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT;
  process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT = 'true';
  try {
    return await PackageVersion.create(
      {
        connection: devHub.getConnection(),
        project,
        packageId: options.packageId,
        definitionfile: options.definitionFile,
        versiondescription: options.versionDescription,
        tag: options.tag,
        branch: options.branch,
        codecoverage: true,
        installationkeybypass: true,
      },
      { timeout: Duration.minutes(0), frequency: Duration.seconds(30) },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT;
    } else {
      process.env.SF_APPLY_REPLACEMENTS_ON_CONVERT = previous;
    }
  }
}

/**
 * The current state of a package version create request: what
 * `sf package version create report --package-create-request-id <08c> --json` returned (as its one
 * array element). `Error` lists the request's error messages.
 */
export async function getPackageVersionCreateStatus(
  createRequestId: string,
  devHubAliasOrUsername: string,
): Promise<PackageVersionCreateRequestResult> {
  const devHub = await resolveOrg(devHubAliasOrUsername, { isDevHub: true });
  return PackageVersion.getCreateStatus(createRequestId, devHub.getConnection());
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

/** The `Package2` fields an aer package's file name is built from. */
export type Package2Info = {
  Id: string;
  Name: string;
  /** `null` for a package with no namespace. */
  NamespacePrefix: string | null;
};

/**
 * The name and namespace of the package a `0Ho` ID identifies, read from the Dev Hub that owns it.
 *
 * @param package2Id - A `0Ho` package ID, e.g. a package version report's `Package2Id`.
 * @param devHubAliasOrUsername - The Dev Hub that owns the package. Must already be authenticated.
 * @throws {Error} If the Dev Hub has no package with that ID.
 */
export async function getPackage2Info(package2Id: string, devHubAliasOrUsername: string): Promise<Package2Info> {
  const devHub = await resolveOrg(devHubAliasOrUsername, { isDevHub: true });
  // The ID is interpolated into SOQL, so it's checked against the shape of an ID first.
  if (!/^0Ho[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?$/.test(package2Id)) {
    throw new Error(`"${package2Id}" is not a package ID (0Ho).`);
  }
  const result = await devHub
    .getConnection()
    .tooling.query<Package2Info>(`SELECT Id, Name, NamespacePrefix FROM Package2 WHERE Id = '${package2Id}'`);
  const [record] = result.records;
  if (!record) {
    throw new Error(`The Dev Hub has no package with ID ${package2Id}.`);
  }
  return { Id: record.Id, Name: record.Name, NamespacePrefix: record.NamespacePrefix ?? null };
}

/**
 * The `04t` a `package` + `versionNumber` dependency resolves to, the same way `sf package install`
 * resolves one: through the Dev Hub that owns the package, `LATEST` included.
 *
 * @param package2Id - The dependency's `0Ho` ID, already resolved from its alias.
 * @param versionNumber - The dependency's `versionNumber`, e.g. `1.2.0.LATEST`.
 * @param devHubAliasOrUsername - The Dev Hub that owns the package. Must already be authenticated.
 * @param branch - The dependency's `branch`, if it pins one.
 */
export async function resolveDependencyVersionId(
  package2Id: string,
  versionNumber: string,
  devHubAliasOrUsername: string,
  branch?: string,
): Promise<string> {
  const devHub = await resolveOrg(devHubAliasOrUsername, { isDevHub: true });
  return SubscriberPackageVersion.resolveId(devHub.getConnection(), {
    packageId: package2Id,
    versionNumber,
    branch: branch ?? '',
  });
}
