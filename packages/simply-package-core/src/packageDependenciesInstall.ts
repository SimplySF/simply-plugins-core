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

/* eslint-disable no-await-in-loop -- packages are resolved and installed strictly one at a time, in project order */

import { Connection, Lifecycle, SfError, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  PackageEvents,
  PackageInstallCreateRequest,
  PackageInstallOptions,
  PackagingSObjects,
  SubscriberPackageVersion,
  VersionNumber,
} from '@salesforce/packaging';
import { retryWithBackoff } from '@simplysf/simply-core';
import {
  isDependenciesPackagingDirectory,
  isPackage2Id,
  isSubscriberPackageVersionId,
  reducePackageInstallRequestErrors,
} from './packageUtils.js';
import type { PackageDirDependency } from './schemas/sfdx-project/packageDirs.js';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

/** The lowest API version whose package-install endpoints this service uses. */
export const MIN_API_VERSION = 36;

/** The outcome recorded for one dependency. `''` means no decision was made before the run stopped. */
export type PackageInstallStatus = '' | 'Skipped' | 'Installing' | 'Installed' | 'Failed';

/**
 * A single dependency's install outcome: the package attempted, whatever version (if any) was
 * already installed in the org for that package, and the decision made.
 */
export type PackageToInstall = {
  PackageName: string;
  /** The `SubscriberPackageVersionId` already installed in the org for this package, or `''` if none was. */
  ExistingSubscriberPackageVersionId: string;
  /** The `SubscriberPackageVersionId` this run attempted to install. */
  SubscriberPackageVersionId: string;
  Status: PackageInstallStatus;
};

/**
 * Which dependencies to attempt: every one (`All`), those whose version differs from what's installed
 * (`Delta`), or those that aren't installed or are newer than what's installed (`Upgrade`).
 */
export type PackageInstallType = 'All' | 'Delta' | 'Upgrade';
/** Who gets access to the installed package's components. */
export type PackageInstallSecurityType = 'AllUsers' | 'AdminsOnly';
/** What happens to components a package upgrade removes; unlocked packages only. */
export type PackageInstallUpgradeType = 'DeprecateOnly' | 'Mixed' | 'Delete';
/** Whether to compile all Apex in the org, or only the package's; unlocked packages only. */
export type PackageInstallApexCompileType = 'all' | 'package';

/**
 * Maps {@link PackageInstallSecurityType} to the `PackageInstallCreateRequest` API value. The
 * lowercase values are what the Tooling API accepts (and what `sf package install` sends), even
 * though `@salesforce/packaging` types the field as `'Custom' | 'Full' | 'None'` — hence the cast.
 */
export const securityTypeApiValue: Record<PackageInstallSecurityType, PackageInstallCreateRequest['SecurityType']> = {
  AllUsers: 'full' as PackageInstallCreateRequest['SecurityType'],
  AdminsOnly: 'none' as PackageInstallCreateRequest['SecurityType'],
};
/** Maps {@link PackageInstallUpgradeType} to the `PackageInstallCreateRequest` API value. */
export const upgradeTypeApiValue: Record<PackageInstallUpgradeType, PackageInstallCreateRequest['UpgradeType']> = {
  Delete: 'delete-only',
  DeprecateOnly: 'deprecate-only',
  Mixed: 'mixed-mode',
};

/**
 * Callbacks the install run reports its progress through. Every member is optional — a consumer
 * that doesn't care about a given kind of update simply leaves it out. A CLI maps `stepStart`/
 * `stepStatus`/`stepStop` onto a spinner; a CI job maps them onto log lines.
 */
export type InstallPackageDependenciesProgress = {
  /** An informational line, e.g. that a package was skipped and why. */
  info?: (message: string) => void;
  /** A warning, e.g. one emitted by the packaging API during an install, or that a retry is about to happen. */
  warn?: (message: string) => void;
  /** A long-running step began. */
  stepStart?: (message: string) => void;
  /** The current step's in-flight status changed (e.g. install polling progress). */
  stepStatus?: (message: string) => void;
  /** The current step finished. `message` is set when the step ended on a condition worth surfacing. */
  stepStop?: (message?: string) => void;
};

/**
 * Confirmations the install run asks for before a potentially destructive or externally-connected
 * install. Omit the whole object to auto-approve both (the equivalent of a `--no-prompt` flag).
 */
export type InstallPackageDependenciesPrompts = {
  /**
   * Asked once per unlocked package before a `Delete` upgrade. Returning `false` aborts the run with
   * a `PackageInstallCanceledError`.
   */
  confirmUpgradeTypeDelete: (packageName: string) => Promise<boolean>;
  /**
   * Asked once per package that declares external sites (Remote Site Settings / CSP trusted sites).
   * The result becomes the install request's `EnableRss`.
   */
  confirmEnableRss: (packageName: string, externalSites: string[]) => Promise<boolean>;
};

export type InstallPackageDependenciesOptions = {
  /** The project whose `sfdx-project.json` declares the dependencies (and the aliases they use). */
  project: SfProject;
  /** The org to install into. */
  targetOrgConnection: Connection;
  /**
   * The Dev Hub used to resolve any dependency declared as a `package` + `versionNumber` pair (as
   * opposed to a `04t` SubscriberPackageVersionId or alias). A factory is only invoked when such a
   * dependency exists, so consumers can defer authenticating the Dev Hub until it's actually needed.
   * Required — as a value or a factory — when any dependency needs it; otherwise unused.
   */
  targetDevHubConnection?: Connection | (() => Promise<Connection>);
  /** Package branch to consider when resolving `package` + `versionNumber` dependencies. Default: none. */
  branch?: string;
  /** Default: `Upgrade`. */
  installType?: PackageInstallType;
  /**
   * Installation keys for key-protected packages, keyed by the package's alias or
   * SubscriberPackageVersionId. Every key must resolve to a `04t` id via the project's aliases.
   */
  installationKeys?: Record<string, string>;
  apexCompile?: PackageInstallApexCompileType;
  /** Default: `AdminsOnly`. */
  securityType?: PackageInstallSecurityType;
  /** Default: `Mixed`. */
  upgradeType?: PackageInstallUpgradeType;
  /** Install handlers to skip, e.g. `['FeatureEnforcement']`. */
  skipHandlers?: string[];
  /**
   * How long to wait for a version to become available in the target org before installing it.
   * Default: no wait.
   */
  publishWait?: Duration;
  /** How long to poll each install request for completion. Default: 30 minutes. */
  wait?: Duration;
  /**
   * How many additional attempts to make when a package's install fails, before giving up on it.
   * Default: `0`. An install that's still in progress when polling times out is never retried,
   * since it may still complete server-side.
   */
  retryAttempts?: number;
  /** Factor the delay between retries grows by after each failed attempt. Default: `2`. */
  retryBackoff?: number;
  /**
   * Per-package overrides of `retryAttempts`, keyed by the package's alias or
   * SubscriberPackageVersionId.
   */
  packageRetryAttempts?: Record<string, number>;
  progress?: InstallPackageDependenciesProgress;
  /** Omit to auto-approve every confirmation. */
  prompts?: InstallPackageDependenciesPrompts;
};

/** A countdown against a timeout, ticked by the packaging API's polling events. */
type Countdown = { remaining: Duration; lastTick: number };

/** @returns A countdown starting at `timeout`, as of now. */
function startCountdown(timeout: Duration): Countdown {
  return { remaining: timeout, lastTick: Date.now() };
}

/** Advances `countdown` by the time elapsed since its last tick. */
function tick(countdown: Countdown): void {
  const now = Date.now();
  countdown.remaining = Duration.milliseconds(countdown.remaining.milliseconds - (now - countdown.lastTick));
  countdown.lastTick = now;
}

/** Everything one run's install stage needs, resolved once up front from the caller's options. */
type InstallRun = {
  targetOrgConnection: Connection;
  installationKeyMap: Map<string, string>;
  packageRetryAttemptsMap: Map<string, number>;
  apexCompile: PackageInstallApexCompileType | undefined;
  securityType: PackageInstallSecurityType;
  upgradeType: PackageInstallUpgradeType;
  skipHandlers: string[] | undefined;
  publishWait: Duration;
  wait: Duration;
  retryAttempts: number;
  retryBackoff: number;
  progress: InstallPackageDependenciesProgress;
  prompts: InstallPackageDependenciesPrompts | undefined;
  /** Reset per package; ticked by the Lifecycle listeners registered for the run. */
  publishCountdown: Countdown;
  installCountdown: Countdown;
};

/** @returns The error thrown when a dependency, key, or override doesn't resolve to a `04t` id. */
function invalidSubscriberPackageVersionIdError(value: string): SfError {
  return new SfError(
    `Unable to determine a valid SubscriberPackageVersionId for ${value}.`,
    'InvalidSubscriberPackageVersionIdError',
  );
}

/**
 * Resolves each key of `byAliasOrId` through the project's package aliases to a
 * SubscriberPackageVersionId.
 *
 * @throws {SfError} `InvalidSubscriberPackageVersionIdError` if a key doesn't resolve to a `04t` id.
 */
function keyBySubscriberPackageVersionId<T>(project: SfProject, byAliasOrId: Record<string, T>): Map<string, T> {
  const result = new Map<string, T>();

  for (const [aliasOrId, value] of Object.entries(byAliasOrId)) {
    const subscriberPackageVersionId = project.getPackageIdFromAlias(aliasOrId) ?? aliasOrId;

    if (!isSubscriberPackageVersionId(subscriberPackageVersionId)) {
      throw invalidSubscriberPackageVersionIdError(subscriberPackageVersionId);
    }

    result.set(subscriberPackageVersionId, value);
  }

  return result;
}

/**
 * Splits the project's declared dependencies into those already pinned to a
 * SubscriberPackageVersionId (directly or via alias) and those that need a Dev Hub to resolve a
 * `package` + `versionNumber` pair.
 */
function collectDependencies(project: SfProject): {
  packagesToInstall: PackageToInstall[];
  devHubDependencies: PackageDirDependency[];
} {
  const packagesToInstall: PackageToInstall[] = [];
  const devHubDependencies: PackageDirDependency[] = [];

  for (const packageDirectory of project.getPackageDirectories().filter(isDependenciesPackagingDirectory)) {
    for (const dependency of packageDirectory.dependencies ?? []) {
      if (dependency.package && dependency.versionNumber) {
        devHubDependencies.push(dependency);
        continue;
      }

      const subscriberPackageVersionId = project.getPackageIdFromAlias(dependency.package) ?? dependency.package;

      if (!isSubscriberPackageVersionId(subscriberPackageVersionId)) {
        throw invalidSubscriberPackageVersionIdError(dependency.package);
      }

      packagesToInstall.push({
        PackageName: dependency.package,
        ExistingSubscriberPackageVersionId: '',
        SubscriberPackageVersionId: subscriberPackageVersionId,
        Status: '',
      });
    }
  }

  return { packagesToInstall, devHubDependencies };
}

/** Resolves `package` + `versionNumber` dependencies to SubscriberPackageVersionIds via the Dev Hub. */
async function resolveDevHubDependencies(
  project: SfProject,
  devHubDependencies: PackageDirDependency[],
  targetDevHubConnection: InstallPackageDependenciesOptions['targetDevHubConnection'],
  branch: string,
): Promise<PackageToInstall[]> {
  if (!targetDevHubConnection) {
    throw new SfError(
      'A Dev Hub connection is required when a dependency is given as a Package2Id and VersionNumber instead of a SubscriberPackageVersionId.',
      'TargetDevHubMissingError',
    );
  }

  const devHubConnection =
    typeof targetDevHubConnection === 'function' ? await targetDevHubConnection() : targetDevHubConnection;

  const resolved: PackageToInstall[] = [];

  for (const dependency of devHubDependencies) {
    if (!dependency.package || !dependency.versionNumber) {
      continue;
    }

    const package2Id = project.getPackageIdFromAlias(dependency.package) ?? dependency.package;

    if (!isPackage2Id(package2Id)) {
      throw new SfError(`Unable to determine a valid Package2Id for ${dependency.package}.`, 'InvalidPackage2IdError');
    }

    const subscriberPackageVersionId = await SubscriberPackageVersion.resolveId(devHubConnection, {
      branch,
      packageId: package2Id,
      versionNumber: dependency.versionNumber,
    });

    if (!isSubscriberPackageVersionId(subscriberPackageVersionId)) {
      throw invalidSubscriberPackageVersionIdError(dependency.package);
    }

    resolved.push({
      PackageName: dependency.package,
      ExistingSubscriberPackageVersionId: '',
      SubscriberPackageVersionId: subscriberPackageVersionId,
      Status: '',
    });
  }

  return resolved;
}

/**
 * Turns the project's declared dependencies into the de-duplicated list of packages this run will
 * consider, resolving any that need the Dev Hub.
 */
async function resolvePackagesToInstall(
  options: InstallPackageDependenciesOptions,
  progress: InstallPackageDependenciesProgress,
): Promise<PackageToInstall[]> {
  const { project, targetDevHubConnection, branch = '' } = options;

  progress.stepStart?.('Analyzing project to determine packages to install');
  const { packagesToInstall, devHubDependencies } = collectDependencies(project);
  progress.stepStop?.();

  if (devHubDependencies.length > 0) {
    progress.stepStart?.('Resolving package versions from dev hub');
    packagesToInstall.push(
      ...(await resolveDevHubDependencies(project, devHubDependencies, targetDevHubConnection, branch)),
    );
    progress.stepStop?.();
  }

  progress.stepStart?.('Checking for duplicate package dependencies');
  const deduplicated = packagesToInstall.filter(
    (packageToInstall, index, self) =>
      index === self.findIndex((t) => t.SubscriberPackageVersionId === packageToInstall.SubscriberPackageVersionId),
  );
  progress.stepStop?.();

  return deduplicated;
}

/**
 * Records what the org already has for each package and, per `installType`, marks the ones that
 * don't need installing as `Skipped`.
 */
async function markSkippedPackages(
  packagesToInstall: PackageToInstall[],
  installType: PackageInstallType,
  run: InstallRun,
): Promise<void> {
  const { targetOrgConnection, installationKeyMap, progress } = run;

  // Always look up what's currently installed, so the result can show the existing package
  // alongside the install decision regardless of `installType`.
  progress.stepStart?.('Analyzing which packages are installed');
  const installedPackages = await SubscriberPackageVersion.installedList(targetOrgConnection);

  for (const packageToInstall of packagesToInstall) {
    const subscriberPackageVersion = new SubscriberPackageVersion({
      aliasOrId: packageToInstall.SubscriberPackageVersionId,
      connection: targetOrgConnection,
      password: installationKeyMap.get(packageToInstall.SubscriberPackageVersionId) ?? '',
    });

    const subscriberPackageId = await subscriberPackageVersion.getSubscriberPackageId();
    const installedPackage = installedPackages.find((pkg) => pkg.SubscriberPackageId === subscriberPackageId);

    packageToInstall.ExistingSubscriberPackageVersionId = installedPackage?.SubscriberPackageVersionId ?? '';

    // 'All' always attempts the install regardless of what (if anything) is already there.
    if (installType === 'All') {
      continue;
    }

    if (installedPackage?.SubscriberPackageVersionId === packageToInstall.SubscriberPackageVersionId) {
      packageToInstall.Status = 'Skipped';
      progress.info?.(
        `Package ${packageToInstall.PackageName} (${packageToInstall.SubscriberPackageVersionId}) is already installed and will be skipped`,
      );
      continue;
    }

    if (installType === 'Upgrade' && installedPackage?.SubscriberPackageVersion) {
      const targetVersion = await subscriberPackageVersion.getVersionNumber();
      const installedVersion = new VersionNumber(
        installedPackage.SubscriberPackageVersion.MajorVersion,
        installedPackage.SubscriberPackageVersion.MinorVersion,
        installedPackage.SubscriberPackageVersion.PatchVersion,
        installedPackage.SubscriberPackageVersion.BuildNumber,
      );

      if (targetVersion.compareTo(installedVersion) <= 0) {
        packageToInstall.Status = 'Skipped';
        progress.info?.(
          `Package ${packageToInstall.PackageName} (${packageToInstall.SubscriberPackageVersionId}) is not newer than the installed version (${installedVersion.toString()}) and will be skipped`,
        );
      }
    }
  }

  progress.stepStop?.();
}

/**
 * Registers the run's listeners for the packaging API's process-wide Lifecycle events — one per
 * event for the whole run (rather than one per package, which would pile up) — and returns a
 * function that removes them again, so a later run in the same process gets its own.
 */
function listenForInstallEvents(run: InstallRun): () => void {
  const lifecycle = Lifecycle.getInstance();
  const { progress } = run;

  // eslint-disable-next-line @typescript-eslint/require-await
  lifecycle.on(PackageEvents.install.warning, async (warningMsg: string) => {
    progress.warn?.(warningMsg);
  });
  lifecycle.on(
    PackageEvents.install['subscriber-status'],
    // eslint-disable-next-line @typescript-eslint/require-await
    async (publishStatus: PackagingSObjects.InstallValidationStatus) => {
      tick(run.publishCountdown);
      const status =
        publishStatus === 'NO_ERRORS_DETECTED' ? 'Available for installation' : 'Unavailable for installation';
      progress.stepStatus?.(
        `${run.publishCountdown.remaining.minutes} minutes remaining until timeout. Publish status: ${status}`,
      );
    },
  );
  // eslint-disable-next-line @typescript-eslint/require-await
  lifecycle.on(PackageEvents.install.status, async (piRequest: PackageInstallRequest) => {
    tick(run.installCountdown);
    progress.stepStatus?.(
      `${run.installCountdown.remaining.minutes} minutes remaining until timeout. Install status: ${piRequest.Status}`,
    );
  });

  return () => {
    lifecycle.removeAllListeners(PackageEvents.install.warning);
    lifecycle.removeAllListeners(PackageEvents.install['subscriber-status']);
    lifecycle.removeAllListeners(PackageEvents.install.status);
  };
}

/**
 * Asks the run's prompts (if any) for the confirmations a package needs before installing it.
 *
 * @returns Whether to enable the package's external sites (`EnableRss`).
 * @throws {SfError} `PackageInstallCanceledError` if a `Delete` upgrade was declined.
 */
async function confirmInstall(
  packageToInstall: PackageToInstall,
  subscriberPackageVersion: SubscriberPackageVersion,
  run: InstallRun,
): Promise<boolean> {
  const { prompts, upgradeType } = run;

  if (!prompts) {
    return true;
  }

  if (upgradeType === 'Delete' && (await subscriberPackageVersion.getPackageType()) === 'Unlocked') {
    if (!(await prompts.confirmUpgradeTypeDelete(packageToInstall.PackageName))) {
      throw new SfError('We canceled this package installation per your request.', 'PackageInstallCanceledError');
    }
  }

  const externalSites = await subscriberPackageVersion.getExternalSites();

  return externalSites ? prompts.confirmEnableRss(packageToInstall.PackageName, externalSites) : true;
}

/**
 * Records a finished install attempt's outcome on `packageToInstall`.
 *
 * @throws {SfError} `PackageInstallInProgressError` if the request is still in progress — the
 * install may still complete server-side, so retrying could race or duplicate it.
 * @throws {SfError} `PackageInstallError` if the request failed.
 */
function recordInstallOutcome(
  packageToInstall: PackageToInstall,
  pkgInstallRequest: PackageInstallRequest,
  targetOrgUsername: string | undefined,
): void {
  if (pkgInstallRequest.Status === 'SUCCESS') {
    packageToInstall.Status = 'Installed';
    return;
  }

  if (['IN_PROGRESS', 'UNKNOWN'].includes(pkgInstallRequest.Status)) {
    packageToInstall.Status = 'Installing';
    throw new SfError(
      `The package install is still In-Progress, so subsequent dependencies cannot be installed yet. You can query the status using sf package install report -i ${pkgInstallRequest.Id} -o ${targetOrgUsername ?? ''}.`,
      'PackageInstallInProgressError',
    );
  }

  packageToInstall.Status = 'Failed';
  throw new SfError(
    `Encountered errors installing the package! ${reducePackageInstallRequestErrors(pkgInstallRequest)}`,
    'PackageInstallError',
  );
}

/** Makes one install attempt for a package and records its outcome. */
async function attemptInstall(
  packageToInstall: PackageToInstall,
  subscriberPackageVersion: SubscriberPackageVersion,
  request: PackageInstallCreateRequest,
  run: InstallRun,
): Promise<void> {
  const { progress, targetOrgConnection, wait } = run;
  const installOptions: PackageInstallOptions = { pollingTimeout: wait, pollingFrequency: Duration.seconds(2) };
  let pkgInstallRequest: PackageInstallRequest;

  run.installCountdown = startCountdown(wait);
  progress.stepStart?.(`Installing package ${packageToInstall.PackageName}`);

  try {
    pkgInstallRequest = await subscriberPackageVersion.install(request, installOptions);
    progress.stepStop?.();
  } catch (error: unknown) {
    if (!(error instanceof SfError && error.data)) {
      progress.stepStop?.();
      throw error;
    }
    // The packaging API attaches the (timed-out or failed) request to the error.
    pkgInstallRequest = error.data as PackageInstallRequest;
    progress.stepStop?.('Polling timeout exceeded');
  }

  recordInstallOutcome(packageToInstall, pkgInstallRequest, targetOrgConnection.getUsername());
}

/** Prepares, confirms, and installs one package, retrying failed attempts per the run's policy. */
async function installPackage(packageToInstall: PackageToInstall, run: InstallRun): Promise<void> {
  const { progress, targetOrgConnection, installationKeyMap, publishWait } = run;
  const installationKey = installationKeyMap.get(packageToInstall.SubscriberPackageVersionId) ?? '';

  progress.stepStart?.(`Preparing package ${packageToInstall.PackageName}`);

  const subscriberPackageVersion = new SubscriberPackageVersion({
    aliasOrId: packageToInstall.SubscriberPackageVersionId,
    connection: targetOrgConnection,
    password: installationKey,
  });

  const request: PackageInstallCreateRequest = {
    ApexCompileType: run.apexCompile,
    EnableRss: true,
    Password: installationKey,
    SecurityType: securityTypeApiValue[run.securityType],
    SkipHandlers: run.skipHandlers?.join(','),
    SubscriberPackageVersionKey: await subscriberPackageVersion.getId(),
    UpgradeType: upgradeTypeApiValue[run.upgradeType],
  };

  progress.stepStop?.();

  if (publishWait.milliseconds > 0) {
    run.publishCountdown = startCountdown(publishWait);
    progress.stepStart?.(
      `${run.publishCountdown.remaining.minutes} minutes remaining until timeout. Publish status: 'Querying Status'`,
    );

    await subscriberPackageVersion.waitForPublish({
      publishTimeout: publishWait,
      publishFrequency: Duration.seconds(10),
      installationKey,
    });

    progress.stepStop?.();
  }

  request.EnableRss = await confirmInstall(packageToInstall, subscriberPackageVersion, run);

  const packageRetryAttempts =
    run.packageRetryAttemptsMap.get(packageToInstall.SubscriberPackageVersionId) ?? run.retryAttempts;

  await retryWithBackoff(() => attemptInstall(packageToInstall, subscriberPackageVersion, request, run), {
    retryAttempts: packageRetryAttempts,
    backoffFactor: run.retryBackoff,
    shouldRetry: () => packageToInstall.Status !== 'Installing',
    onRetry: (_error, attempt, delay) => {
      progress.warn?.(
        `Package ${packageToInstall.PackageName} failed to install (retry ${attempt} of ${packageRetryAttempts}); retrying in ${Math.round(delay.seconds)} seconds...`,
      );
    },
  });
}

/**
 * Installs the package dependencies an SFDX project declares in `sfdx-project.json` into an org,
 * one at a time in declaration order, and reports what happened to each.
 *
 * Dependencies are resolved to SubscriberPackageVersionIds (via the project's aliases, or the Dev Hub
 * for `package` + `versionNumber` pairs), de-duplicated, compared against what the org already has
 * per `installType`, and then installed with the retry policy given. Every dependency's outcome —
 * including the ones skipped — is returned, so a caller can tell which installs were upgrades of an
 * existing package.
 *
 * Progress is reported through `options.progress`; confirmations go through `options.prompts`, or
 * are auto-approved when that's omitted.
 *
 * @param options - See {@link InstallPackageDependenciesOptions}.
 * @returns One entry per resolved dependency, in the order they were processed.
 * @throws {SfError} `ApiVersionTooLowError` if the target org's API version is below 36.0.
 * @throws {SfError} `InvalidSubscriberPackageVersionIdError` if a dependency, installation key, or
 * retry override doesn't resolve to a `04t` id.
 * @throws {SfError} `InvalidPackage2IdError` if a `package` + `versionNumber` dependency doesn't
 * resolve to a `0Ho` id.
 * @throws {SfError} `TargetDevHubMissingError` if a dependency needs the Dev Hub and none was given.
 * @throws {SfError} `PackageInstallCanceledError` if `prompts.confirmUpgradeTypeDelete` declined.
 * @throws {SfError} `PackageInstallInProgressError` if an install was still in progress when polling
 * timed out.
 * @throws {SfError} `PackageInstallError` if an install failed and its retries (if any) are exhausted.
 */
export async function installPackageDependencies(
  options: InstallPackageDependenciesOptions,
): Promise<PackageToInstall[]> {
  const { project, targetOrgConnection, installType = 'Upgrade', progress = {} } = options;

  const apiVersion = parseInt(targetOrgConnection.getApiVersion(), 10);
  if (apiVersion < MIN_API_VERSION) {
    throw new SfError(
      `Package dependency installation is supported only on API versions ${MIN_API_VERSION}.0 and higher.`,
      'ApiVersionTooLowError',
    );
  }

  const packagesToInstall = await resolvePackagesToInstall(options, progress);

  if (packagesToInstall.length === 0) {
    progress.info?.('No packages were found to install');
    return packagesToInstall;
  }

  const publishWait = options.publishWait ?? Duration.minutes(0);
  const wait = options.wait ?? Duration.minutes(30);
  const run: InstallRun = {
    targetOrgConnection,
    installationKeyMap: keyBySubscriberPackageVersionId(project, options.installationKeys ?? {}),
    packageRetryAttemptsMap: keyBySubscriberPackageVersionId(project, options.packageRetryAttempts ?? {}),
    apexCompile: options.apexCompile,
    securityType: options.securityType ?? 'AdminsOnly',
    upgradeType: options.upgradeType ?? 'Mixed',
    skipHandlers: options.skipHandlers,
    publishWait,
    wait,
    retryAttempts: options.retryAttempts ?? 0,
    retryBackoff: options.retryBackoff ?? 2,
    progress,
    prompts: options.prompts,
    publishCountdown: startCountdown(publishWait),
    installCountdown: startCountdown(wait),
  };

  await markSkippedPackages(packagesToInstall, installType, run);

  const stopListening = listenForInstallEvents(run);

  try {
    for (const packageToInstall of packagesToInstall) {
      if (packageToInstall.Status !== 'Skipped') {
        await installPackage(packageToInstall, run);
      }
    }
  } finally {
    stopListening();
  }

  return packagesToInstall;
}
