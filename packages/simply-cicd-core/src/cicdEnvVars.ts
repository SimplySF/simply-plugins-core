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

import { logger } from './logger.js';

// The environment variables and dotenv keys simply-cicd owns, and the unprefixed names they had
// before every one of them moved under `SIMPLY_CICD_` (design doc 0060). Until the legacy names are
// removed, writers emit both names and readers accept either, preferring the new one.

/** The environment variables and dotenv keys simply-cicd itself defines, by role. */
export const CICD_ENV_VARS = {
  /** Written by `build determine-package-changes`; read by every job's skip guard. */
  packageChanged: 'SIMPLY_CICD_PACKAGE_CHANGED',
  /** Written by `build determine-package-changes`. */
  lastTag: 'SIMPLY_CICD_LAST_TAG',
  /**
   * The `04t` written by `build create-package-version` and `build create-fallback-tag`. Not
   * `SIMPLY_CICD_SUBSCRIBER_PACKAGE_VERSION_ID`: that is `notify build`'s flag variable, which means
   * "this job built the package", and a dotenv artifact would set it in every downstream job.
   */
  builtSubscriberPackageVersionId: 'SIMPLY_CICD_BUILT_SUBSCRIBER_PACKAGE_VERSION_ID',
  /** Written by `build publish-aer-package`. */
  aerPackageUrl: 'SIMPLY_CICD_AER_PACKAGE_URL',
  /** Written by `build publish-aer-package`. */
  aerPackageFile: 'SIMPLY_CICD_AER_PACKAGE_FILE',
  /** Written by `build publish-aer-package`. */
  aerPackageVersion: 'SIMPLY_CICD_AER_PACKAGE_VERSION',
  /** Written by `build publish-utam-page-objects`. */
  utamPageObjectsPackage: 'SIMPLY_CICD_UTAM_PAGE_OBJECTS_PACKAGE',
  /** Written by `build publish-utam-page-objects`. */
  utamPageObjectsVersion: 'SIMPLY_CICD_UTAM_PAGE_OBJECTS_VERSION',
  /** Written by the project notification before-script. */
  createdByJobName: 'SIMPLY_CICD_CREATED_BY_JOB_NAME',
  /** Written by the project notification before-script. */
  prevInstalledPackageVersion: 'SIMPLY_CICD_PREV_INSTALLED_PACKAGE_VERSION',
  /** Written by the project notification before-script. */
  targetPackageVersion: 'SIMPLY_CICD_TARGET_PACKAGE_VERSION',
  /** A repository-level CI/CD variable `sfdx-dependabot` reads through the VCS API to opt a project in. */
  sfdxDependabotEnabled: 'SIMPLY_CICD_SFDX_DEPENDABOT_ENABLED',
} as const;

export type CicdEnvVarName = (typeof CICD_ENV_VARS)[keyof typeof CICD_ENV_VARS];

/**
 * The pre-`SIMPLY_CICD_` name of each {@link CICD_ENV_VARS} entry. Still written alongside the new
 * name and still read when the new one is unset.
 *
 * @deprecated The legacy names will be removed in a future release. Use {@link CICD_ENV_VARS}.
 */
export const LEGACY_CICD_ENV_VARS: Readonly<Record<CicdEnvVarName, string>> = {
  SIMPLY_CICD_PACKAGE_CHANGED: 'PACKAGE_CHANGED',
  SIMPLY_CICD_LAST_TAG: 'LAST_TAG',
  SIMPLY_CICD_BUILT_SUBSCRIBER_PACKAGE_VERSION_ID: 'SUBSCRIBER_PACKAGE_VERSION_ID',
  SIMPLY_CICD_AER_PACKAGE_URL: 'AER_PACKAGE_URL',
  SIMPLY_CICD_AER_PACKAGE_FILE: 'AER_PACKAGE_FILE',
  SIMPLY_CICD_AER_PACKAGE_VERSION: 'AER_PACKAGE_VERSION',
  SIMPLY_CICD_UTAM_PAGE_OBJECTS_PACKAGE: 'UTAM_PAGE_OBJECTS_PACKAGE',
  SIMPLY_CICD_UTAM_PAGE_OBJECTS_VERSION: 'UTAM_PAGE_OBJECTS_VERSION',
  SIMPLY_CICD_CREATED_BY_JOB_NAME: 'CREATED_BY_JOB_NAME',
  SIMPLY_CICD_PREV_INSTALLED_PACKAGE_VERSION: 'PREV_INSTALLED_PACKAGE_VERSION',
  SIMPLY_CICD_TARGET_PACKAGE_VERSION: 'TARGET_PACKAGE_VERSION',
  SIMPLY_CICD_SFDX_DEPENDABOT_ENABLED: 'SFDX_DEPENDABOT_ENABLED',
};

function legacyNameOf(name: string): string | undefined {
  return (LEGACY_CICD_ENV_VARS as Readonly<Record<string, string>>)[name];
}

/** The deprecation notice for a value found only under its legacy name. */
export function legacyEnvVarReadWarning(legacyName: string, name: string): string {
  return `${legacyName} is deprecated and will be removed in a future release. Set ${name} instead.`;
}

/** A value, and the name it was actually found under. */
export type FoundEnvVar = { name: string; value: string };

/**
 * Look a simply-cicd variable up by its current name, falling back to its legacy name. A value
 * found only under the legacy name logs a deprecation warning, unless `warn` is `false`.
 *
 * @param lookup Returns the value of a name, or `undefined` if it isn't set.
 */
export function findCicdVar(
  name: CicdEnvVarName,
  lookup: (key: string) => string | undefined,
  options: { warn?: boolean } = {},
): FoundEnvVar | undefined {
  const value = lookup(name);
  if (value !== undefined) {
    return { name, value };
  }

  const legacyName = legacyNameOf(name);
  const legacyValue = legacyName === undefined ? undefined : lookup(legacyName);
  if (legacyName === undefined || legacyValue === undefined) {
    return undefined;
  }

  if (options.warn !== false) {
    logger.warn(legacyEnvVarReadWarning(legacyName, name));
  }
  return { name: legacyName, value: legacyValue };
}

/**
 * Read a simply-cicd environment variable, falling back to its legacy name with a deprecation
 * warning. An empty string counts as unset, the same as the readers did before the rename.
 */
export function readCicdEnvVar(name: CicdEnvVarName, env: NodeJS.ProcessEnv = process.env): FoundEnvVar | undefined {
  return findCicdVar(name, (key) => (env[key] === '' ? undefined : env[key]));
}

/**
 * Add each variable's legacy name, with the same value, after the current names, so pipelines that
 * still read the old names keep working. Logs one deprecation notice naming the legacy keys added —
 * at info, not warn, because nothing a pipeline does can stop it, so it would be a warning on every
 * healthy run.
 */
export function withLegacyCicdEnvVars(
  variables: Partial<Record<CicdEnvVarName, string | undefined>>,
): Record<string, string | undefined> {
  const legacy: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(variables)) {
    const legacyName = legacyNameOf(name);
    if (legacyName !== undefined && value !== undefined) {
      legacy[legacyName] = value;
    }
  }

  const legacyNames = Object.keys(legacy);
  if (legacyNames.length > 0) {
    logger.info(
      `Also writing ${legacyNames.join(', ')} under the deprecated names, which will be removed in a future release. Read the SIMPLY_CICD_ names instead.`,
    );
  }

  return { ...variables, ...legacy };
}

/** Render variables as dotenv lines, one `KEY=value` per line with a trailing newline. */
export function toEnvFileContent(variables: Record<string, string | undefined>): string {
  return Object.entries(variables)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
}
