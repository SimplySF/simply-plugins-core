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
import { getPluginConfig, type SfdxProject } from '@simplysf/simply-core';
import { DEFAULT_VERSION_TAG_FORMAT, VersionTagFormat } from './versionTagFormat.js';

// Moved to packageVersionArtifact.ts, which aer packages share. Re-exported so this module's
// surface is unchanged.
export {
  readEnvFileValue,
  resolveSubscriberPackageVersionId,
  type ResolveSubscriberPackageVersionIdOptions,
  sanitizePrereleaseId,
  SUBSCRIBER_PACKAGE_VERSION_ID_KEY,
  toDistTag,
  toNpmVersion,
} from './packageVersionArtifact.js';

/** The dotenv keys this feature writes, for a downstream UI-test job to install by. */
export const UTAM_PACKAGE_KEY = 'UTAM_PAGE_OBJECTS_PACKAGE';
export const UTAM_VERSION_KEY = 'UTAM_PAGE_OBJECTS_VERSION';

/** The compiler's own default masks, restated so the generated config never depends on them drifting. */
export const PAGE_OBJECTS_FILE_MASK = ['**/__utam__/**/*.utam.json'];
export const EXTENSIONS_FILE_MASK = ['**/__utam__/**/*.utam.js'];

/** Where the staged package keeps its sources, which the compiler is pointed at instead of the repo. */
export const STAGED_SOURCE_DIR = 'source';

/**
 * The published name of the compiler's profiles config, for a consumer's UTAM loader to read.
 *
 * The compiler names it `<module>.config.json`, which for a scoped package is a file inside an
 * `@scope/` folder; a fixed name gives every package the same, flat path.
 */
export const PROFILES_CONFIG_FILE = 'profiles.config.json';

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

/** @returns The git tag `create-package-version` recorded this package version under. */
export function toVersionTag(
  salesforceVersion: string,
  tagSuffix?: string,
  versionTagFormat: VersionTagFormat = VersionTagFormat.parse(DEFAULT_VERSION_TAG_FORMAT),
): string {
  return versionTagFormat.render(salesforceVersion, tagSuffix);
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
    files: ['pageObjects', 'utils', STAGED_SOURCE_DIR, PROFILES_CONFIG_FILE],
    exports: {
      './package.json': './package.json',
      // Exact keys win over `./*`, which would otherwise map this to `profiles.config.json.js`.
      [`./${PROFILES_CONFIG_FILE}`]: `./${PROFILES_CONFIG_FILE}`,
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
  /** Absolute path to the staging directory, whose `source/` the compiler reads and writes beside. */
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
 *
 * The compiler reads the staged copy of the sources, never the repo, because it writes everything
 * relative to its root: output as `path.join(pageObjectsRootDir, outputDir)` (which appends an
 * absolute path rather than honouring it), and its lint report, error report, and profiles config
 * beside or under the root. Rooted in the staging directory, all of it stays there.
 *
 * A relative `lint.lintingOutputFile` in the project's config is resolved against the working
 * directory, which is what a path written in the repo means; the compiler would otherwise resolve
 * it inside `source/`, which is published.
 */
export function buildCompilerConfig(options: CompilerConfigOptions): Record<string, unknown> {
  const projectLint = options.baseConfig?.lint as { lintingOutputFile?: string } | undefined;
  const lintingOutputFile = projectLint?.lintingOutputFile
    ? path.resolve(projectLint.lintingOutputFile)
    : path.join(options.stagingDir, 'utam-lint.sarif');

  return {
    ...options.baseConfig,
    lint: { ...projectLint, lintingOutputFile },
    pageObjectsRootDir: path.join(options.stagingDir, STAGED_SOURCE_DIR),
    pageObjectsFileMask: PAGE_OBJECTS_FILE_MASK,
    extensionsFileMask: EXTENSIONS_FILE_MASK,
    // Relative to the root, as the compiler reads them: `<staging>/pageObjects` and `<staging>/utils`.
    pageObjectsOutputDir: path.join('..', 'pageObjects'),
    extensionsOutputDir: path.join('..', 'utils'),
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
  return findUnderUtamFolders(rootDir, '.utam.json');
}

/** Every `.utam.js` utility authored under `rootDir`, as `findPageObjectSources` finds page objects. */
export async function findUtilitySources(rootDir: string): Promise<string[]> {
  return findUnderUtamFolders(rootDir, '.utam.js');
}

/**
 * Sources that would compile to the same output file.
 *
 * The compiler's output is flat — one file per source, named after it, whatever folder it came
 * from — so two sources with one name silently leave one of them out of the package. Names are
 * compared ignoring case, because the staging directory is usually on a case-insensitive
 * filesystem (macOS, Windows), where `Modal.js` and `modal.js` are the same file.
 *
 * @returns One message per clashing name, naming every source behind it. Empty when none clash.
 */
export function findOutputNameClashes(sources: string[], extension: string, rootDir: string): string[] {
  const byName = new Map<string, string[]>();
  for (const source of sources) {
    const name = path.basename(source, extension).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), path.relative(rootDir, source)]);
  }

  return [...byName]
    .filter(([, clashing]) => clashing.length > 1)
    .map(([name, clashing]) => `"${name}" (${clashing.join(', ')})`);
}

async function findUnderUtamFolders(rootDir: string, extension: string): Promise<string[]> {
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
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => path.relative(rootDir, file).split(/[\\/]/).includes('__utam__'))
    .sort();
}
