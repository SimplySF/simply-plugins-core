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

import { promises as fs } from 'node:fs';
import { isSubscriberPackageVersionId } from '@simplysf/simply-core';
import { logger } from '../logger.js';

// Helpers for any artifact published per package version (UTAM page objects, aer packages): finding
// the `04t` a build produced and mapping its Salesforce version number onto a semver version.

/** The dotenv key `create-package-version` and `create-fallback-tag` both write their `04t` under. */
export const SUBSCRIBER_PACKAGE_VERSION_ID_KEY = 'SUBSCRIBER_PACKAGE_VERSION_ID';

/** `sf package version report` returns `Version` as `major.minor.patch.build`, which is not semver. */
const SALESFORCE_VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)\.(?<build>\d+)$/;

/**
 * Strip leading and trailing hyphens. Done by index rather than `/^-+|-+$/`, whose trailing
 * alternative backtracks quadratically on a long run of interior hyphens.
 */
function trimHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start++;
  while (end > start && value[end - 1] === '-') end--;
  return value.slice(start, end);
}

/**
 * Reduce a git tag suffix to something semver accepts as a prerelease identifier.
 *
 * Semver's prerelease alphabet is `[0-9A-Za-z-]`; a branch name's `/` and `.` are the common
 * offenders, so each run of anything else collapses to a single hyphen.
 */
export function sanitizePrereleaseId(raw: string): string {
  const cleaned = trimHyphens(raw.replace(/[^0-9A-Za-z-]+/g, '-'));

  // Semver forbids leading zeros in an all-numeric identifier, so a branch literally named `007`
  // would otherwise produce a version every registry rejects. Prefixing keeps it traceable.
  return /^0\d+$/.test(cleaned) ? `v${cleaned}` : cleaned;
}

/**
 * Map a Salesforce package version onto a semver version.
 *
 * The build number becomes the first prerelease identifier and the git tag's suffix, if any, the
 * second — so `1.2.3.4` on a release branch is `1.2.3-4`, and the same version built from `beta`
 * is `1.2.3-4.beta`. This is the transformation `sfdx-project.json` already uses for a dependency
 * pin (`"package": "MyPackage@1.2.3-4"`), not a new convention.
 *
 * @throws {Error} If the version isn't `major.minor.patch.build`. Publishing a version derived
 * from something unrecognised is worse than failing the job.
 */
export function toNpmVersion(salesforceVersion: string, tagSuffix?: string): string {
  const match = SALESFORCE_VERSION_PATTERN.exec(salesforceVersion.trim());
  if (!match?.groups) {
    throw new Error(
      `Cannot derive an npm version from Salesforce package version "${salesforceVersion}": expected major.minor.patch.build.`,
    );
  }

  const { major, minor, patch, build } = match.groups;
  const sanitizedSuffix = tagSuffix ? sanitizePrereleaseId(tagSuffix) : '';
  const prerelease = sanitizedSuffix ? `${build}.${sanitizedSuffix}` : build;

  return `${major}.${minor}.${patch}-${prerelease}`;
}

/**
 * The npm dist-tag for a build: `latest` for a release-branch build, else the sanitized tag suffix,
 * so `npm install <pkg>@beta` reaches the newest build off the `beta` package branch.
 */
export function toDistTag(tagSuffix?: string): string {
  const sanitized = tagSuffix ? sanitizePrereleaseId(tagSuffix) : '';

  return sanitized.length > 0 ? sanitized : 'latest';
}

/** @returns The last value assigned to `key` in dotenv-shaped `content`, or `undefined`. */
export function readEnvFileValue(content: string, key: string): string | undefined {
  let found: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator !== -1 && trimmed.slice(0, separator).trim() === key) {
      // Last wins: the file is appended to, so a later line is the newer value.
      found = trimmed.slice(separator + 1).trim();
    }
  }

  return found;
}

export type ResolveSubscriberPackageVersionIdOptions = {
  /** `--subscriber-package-version-id`, if passed. */
  flagValue?: string;
  /** The environment to read `SUBSCRIBER_PACKAGE_VERSION_ID` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Dotenv file to fall back to — the one `create-package-version` wrote earlier in this job. */
  envFile: string;
};

/**
 * Find the `04t` this run should publish page objects for.
 *
 * Three sources, because the command is useful from two pipeline shapes and they surface the value
 * differently: an explicit flag; `SUBSCRIBER_PACKAGE_VERSION_ID` in the environment, which is how a
 * *separate* job receives `create-package-version`'s dotenv report artifact; and the dotenv file
 * itself, which is how the *same* job sees it, since a dotenv report only ever reaches other jobs.
 *
 * An explicit flag that isn't a `04t` throws — the caller asked for something specific and got it
 * wrong. A malformed value discovered rather than passed only warns, and the search continues.
 *
 * @returns The ID, or `undefined` when no source has one.
 * @throws {Error} If `flagValue` is not a subscriber package version ID.
 */
export async function resolveSubscriberPackageVersionId(
  options: ResolveSubscriberPackageVersionIdOptions,
): Promise<string | undefined> {
  const { flagValue, env = process.env, envFile } = options;

  if (flagValue) {
    if (!isSubscriberPackageVersionId(flagValue)) {
      throw new Error(
        `--subscriber-package-version-id must be a subscriber package version ID (04t), got "${flagValue}".`,
      );
    }
    return flagValue;
  }

  const fromEnv = env[SUBSCRIBER_PACKAGE_VERSION_ID_KEY];
  if (fromEnv) {
    if (isSubscriberPackageVersionId(fromEnv)) {
      logger.info(`Using ${SUBSCRIBER_PACKAGE_VERSION_ID_KEY} from the environment: ${fromEnv}`);
      return fromEnv;
    }
    logger.warn(`Ignoring ${SUBSCRIBER_PACKAGE_VERSION_ID_KEY}="${fromEnv}" from the environment: not a 04t ID.`);
  }

  let content: string;
  try {
    content = await fs.readFile(envFile, 'utf8');
  } catch {
    return undefined;
  }

  const fromFile = readEnvFileValue(content, SUBSCRIBER_PACKAGE_VERSION_ID_KEY);
  if (!fromFile) {
    return undefined;
  }
  if (!isSubscriberPackageVersionId(fromFile)) {
    logger.warn(`Ignoring ${SUBSCRIBER_PACKAGE_VERSION_ID_KEY}="${fromFile}" in ${envFile}: not a 04t ID.`);
    return undefined;
  }

  logger.info(`Using ${SUBSCRIBER_PACKAGE_VERSION_ID_KEY} from ${envFile}: ${fromFile}`);
  return fromFile;
}
