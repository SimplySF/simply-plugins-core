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
import path from 'node:path';
import { getPluginConfig, isSubscriberPackageVersionId, type SfdxProject } from '@simplysf/simply-core';
import { logger } from '../logger.js';
import { DEFAULT_VERSION_TAG_FORMAT, VersionTagFormat } from './versionTagFormat.js';

/** The dotenv key `create-package-version` and `create-fallback-tag` both write their `04t` under. */
export const SUBSCRIBER_PACKAGE_VERSION_ID_KEY = 'SUBSCRIBER_PACKAGE_VERSION_ID';

/** The dotenv keys this feature writes, for a downstream UI-test job to install by. */
export const UTAM_PACKAGE_KEY = 'UTAM_PAGE_OBJECTS_PACKAGE';
export const UTAM_VERSION_KEY = 'UTAM_PAGE_OBJECTS_VERSION';

/** The compiler's own default mask, restated so the generated config never depends on it drifting. */
export const PAGE_OBJECTS_FILE_MASK = ['**/__utam__/**/*.utam.json'];

/** `sf package version report` returns `Version` as `major.minor.patch.build`, which is not semver. */
const SALESFORCE_VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)\.(?<build>\d+)$/;

/** `plugins.simply.utam` in `sfdx-project.json`. Every field is optional. */
export type UtamPluginConfig = {
  /** npm package name to publish under. Required unless `--npm-package-name` is passed. */
  packageName?: string;
  /** UTAM compiler type-alias map, passed through to the generated compiler config. */
  alias?: Record<string, string>;
  /** Peer dependencies to merge into the generated package, e.g. `salesforce-pageobjects`. */
  peerDependencies?: Record<string, string>;
  /** Path to a compiler config whose keys the command doesn't own (`profiles`, `lint`, …). */
  compilerConfig?: string;
};

/** @returns `plugins.simply.utam`, or an empty object when the project declares none. */
export function readUtamPluginConfig(project: SfdxProject): UtamPluginConfig {
  return getPluginConfig<UtamPluginConfig>(project, 'plugins.simply.utam') ?? {};
}

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

/** @returns The git tag `create-package-version` recorded this package version under. */
export function toVersionTag(
  salesforceVersion: string,
  tagSuffix?: string,
  versionTagFormat: VersionTagFormat = VersionTagFormat.parse(DEFAULT_VERSION_TAG_FORMAT),
): string {
  return versionTagFormat.render(salesforceVersion, tagSuffix);
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

/**
 * The `@utam/core` range the generated package declares as a peer, derived from the compiler that
 * actually produced the output rather than hardcoded — generated page objects import `@utam/core`
 * directly, and a consumer must resolve one copy of it across everything they load.
 */
export function toUtamCoreRange(utamVersion: string): string {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\./.exec(utamVersion.trim());
  if (!match?.groups) {
    throw new Error(`Could not read a major.minor version from the installed utam compiler: "${utamVersion}".`);
  }

  return `^${match.groups.major}.${match.groups.minor}.0`;
}

/** The one line identifying which package version produced this output, used as both description and file header. */
export function buildProvenanceLine(
  packageName: string,
  salesforceVersion: string,
  subscriberPackageVersionId: string,
): string {
  return `UTAM page objects for ${packageName} ${salesforceVersion} (${subscriberPackageVersionId})`;
}

export type PackageManifestOptions = {
  /** npm package name to publish under. */
  npmPackageName: string;
  /** The derived semver version. */
  version: string;
  /** The Salesforce package's name, for the provenance block. */
  salesforcePackageName: string;
  /** The Salesforce version, as `major.minor.patch.build`. */
  salesforceVersion: string;
  subscriberPackageVersionId: string;
  /** The git tag `create-package-version` recorded this version under. */
  versionTag: string;
  /** The commit this package version was built from — the package version's `Tag` field. */
  commitSha?: string;
  /** The pipeline that built it — the package version's `Description` field. */
  pipelineUrl?: string;
  /** The `@utam/core` peer range, from {@link toUtamCoreRange}. */
  utamCoreRange: string;
  /** Extra peers from `plugins.simply.utam.peerDependencies`. */
  projectPeerDependencies?: Record<string, string>;
};

/**
 * The `package.json` for the published page-object package.
 *
 * Shaped after `salesforce-pageobjects`, which is what every UTAM consumer already imports from:
 * ESM with a CJS fallback, page objects addressed by path (`<pkg>/pageObjects/<name>`), and the
 * source JSON shipped alongside. The one deliberate difference is that `@utam/core` is declared as
 * a peer here instead of being left to whatever the test's adapter drags in.
 */
export function buildPackageManifest(options: PackageManifestOptions): Record<string, unknown> {
  return {
    name: options.npmPackageName,
    version: options.version,
    description: buildProvenanceLine(
      options.salesforcePackageName,
      options.salesforceVersion,
      options.subscriberPackageVersionId,
    ),
    type: 'module',
    files: ['pageObjects', 'utils', 'source'],
    exports: {
      './package.json': './package.json',
      './*': {
        import: { types: './*.d.ts', default: './*.js' },
        require: { types: './*.d.cts', default: './*.cjs' },
      },
    },
    peerDependencies: {
      '@utam/core': options.utamCoreRange,
      ...options.projectPeerDependencies,
    },
    salesforce: {
      package: options.salesforcePackageName,
      versionNumber: options.salesforceVersion,
      subscriberPackageVersionId: options.subscriberPackageVersionId,
      tag: options.versionTag,
      ...(options.commitSha ? { commitSha: options.commitSha } : {}),
      ...(options.pipelineUrl ? { pipelineUrl: options.pipelineUrl } : {}),
    },
  };
}

export type CompilerConfigOptions = {
  /** Absolute path to the default package directory the page objects are authored under. */
  pageObjectsRootDir: string;
  /** Absolute path to the staging directory the compiler writes into. */
  stagingDir: string;
  npmPackageName: string;
  version: string;
  /** The provenance line, stamped as each generated file's header comment. */
  copyright: string;
  alias?: Record<string, string>;
  /** Parsed `plugins.simply.utam.compilerConfig`, whose keys this command doesn't own. */
  baseConfig?: Record<string, unknown>;
};

/**
 * The `utam.config.json` the compiler is invoked with.
 *
 * Generated per build rather than read from the repo because the compiler has no flag for
 * `version` — the only way to stamp the Salesforce version into the output is through the config
 * file, so it cannot be a static artifact. A project's own config is merged underneath: the command
 * owns the root, the masks, the output directories, `module`, `version`, and `copyright`; the
 * project keeps everything else (`profiles`, `lint`, `interruptCompilerOnError`, …).
 */
export function buildCompilerConfig(options: CompilerConfigOptions): Record<string, unknown> {
  return {
    ...options.baseConfig,
    pageObjectsRootDir: options.pageObjectsRootDir,
    pageObjectsFileMask: PAGE_OBJECTS_FILE_MASK,
    pageObjectsOutputDir: path.join(options.stagingDir, 'pageObjects'),
    extensionsOutputDir: path.join(options.stagingDir, 'utils'),
    moduleTarget: 'module',
    // The package's own name, so a page object can reference a sibling as
    // `<npm name>/pageObjects/<name>` and have the generated import resolve once installed.
    module: options.npmPackageName,
    version: options.version,
    copyright: [options.copyright],
    ...(options.alias ? { alias: options.alias } : {}),
  };
}

/**
 * Every `.utam.json` authored under `rootDir`, matching the compiler's own `__utam__` convention.
 *
 * Walks the tree rather than globbing so this package takes on no glob dependency for one lookup.
 *
 * @returns Absolute paths, sorted. Empty when `rootDir` doesn't exist — a project that hasn't
 * adopted UTAM is a skip, not an error.
 */
export async function findPageObjectSources(rootDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.utam.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => path.relative(rootDir, file).split(/[\\/]/).includes('__utam__'))
    .sort();
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
