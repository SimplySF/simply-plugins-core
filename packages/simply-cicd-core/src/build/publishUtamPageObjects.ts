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
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { getDefaultPackageDirectory, readSfdxProject } from '@simplysf/simply-core';
import { runSfJson } from '../exec/sfCli.js';
import { appendToEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { determineTagSuffix } from './createPackageVersion.js';
import { getSkipReason } from './skipGuard.js';
import { VersionTagFormat } from './versionTagFormat.js';
import {
  buildCompilerConfig,
  buildPackageManifest,
  buildProvenanceLine,
  findPageObjectSources,
  readUtamPluginConfig,
  resolveSubscriberPackageVersionId,
  toDistTag,
  toNpmVersion,
  toUtamCoreRange,
  toVersionTag,
  UTAM_PACKAGE_KEY,
  UTAM_VERSION_KEY,
  type UtamPluginConfig,
} from './utamPageObjects.js';

/** The default dotenv file, matching what `create-package-version`/`create-fallback-tag` write. */
const DEFAULT_ENV_FILE = 'subscriberPackageVersionId.env';

/** The fields read off `sf package version report --package <04t> --json`. */
type PackageVersionReport = {
  Version?: string;
  /** The commit SHA `create-package-version` tagged the version with. */
  Tag?: string;
  /** The pipeline URL `create-package-version` used as the version description. */
  Description?: string;
  Package2Name?: string;
};

type UtamPackageJson = { version?: string; bin?: string | Record<string, string> };

export type NpmAccess = 'public' | 'restricted';

export type PublishUtamPageObjectsOptions = {
  /** The packaging Dev Hub's alias. Must already be authenticated. */
  packagingDevhub: string;
  subscriberPackageVersionId?: string;
  /** Overrides `plugins.simply.utam.packageName`. */
  npmPackageName?: string;
  npmRegistry?: string;
  npmAccess?: NpmAccess;
  /** Overrides the dist-tag derived from the git tag's suffix. */
  npmDistTag?: string;
  ciCommitRefName?: string;
  packageReleaseBranchPrefix?: string;
  /** npm spec of the UTAM compiler to install into the staging directory. */
  utamVersion?: string;
  /** Compile and `npm pack`, but don't publish. */
  dryRun?: boolean;
  /** Dotenv file to append the published name and version to. */
  out?: string;
  /** Dotenv file to read `SUBSCRIBER_PACKAGE_VERSION_ID` from. */
  envFile?: string;
  debug?: boolean;
  disabled?: boolean;
};

export type PublishUtamPageObjectsResult = {
  skipped: boolean;
  published: boolean;
  /** True when this exact version was already on the registry, so nothing needed publishing. */
  alreadyPublished?: boolean;
  packageName?: string;
  version?: string;
  distTag?: string;
  /** Path to the packed tarball, on `--dry-run` only. */
  tarball?: string;
};

/** A run that did nothing, in the shape every guard returns. */
function skip(): PublishUtamPageObjectsResult {
  return { skipped: true, published: false };
}

/**
 * Whether `spec` already resolves on the target registry.
 *
 * A failure is read as "not published" rather than propagated: the overwhelmingly common cause is
 * the 404 for a version that doesn't exist yet, and any other cause (auth, network) will fail the
 * publish immediately afterwards with a better message than this check could give.
 */
async function isAlreadyPublished(spec: string, cwd: string, registry?: string): Promise<boolean> {
  const args = ['view', spec, 'version'];
  if (registry) {
    args.push('--registry', registry);
  }

  try {
    const { stdout } = await execa('npm', args, { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Install the UTAM compiler into the staging directory and return the version installed alongside
 * the entry point to run it with.
 *
 * Installed at run time rather than declared as a dependency of this plugin: the compiler pulls in
 * rollup and the whole `@utam/*` family, which every `simply-cicd` user would otherwise carry for a
 * feature most of them never enable. `lwc-jest` sets the same precedent.
 */
async function installCompiler(
  stagingDir: string,
  utamVersion: string,
  debug: boolean,
): Promise<{ version: string; entry: string }> {
  logger.info(`Installing the UTAM compiler (utam@${utamVersion})...`);
  await execa('npm', ['install', '--no-save', '--no-audit', '--no-fund', `utam@${utamVersion}`], {
    cwd: stagingDir,
    stdio: debug ? 'inherit' : 'pipe',
  });

  const moduleDir = path.join(stagingDir, 'node_modules', 'utam');
  const manifest = JSON.parse(await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8')) as UtamPackageJson;
  const binRelative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.utam;

  if (!manifest.version || !binRelative) {
    throw new Error(`The installed utam@${utamVersion} declares no version or no "utam" bin entry.`);
  }

  logger.info(`Installed utam@${manifest.version}.`);

  return { version: manifest.version, entry: path.join(moduleDir, binRelative) };
}

/** Copy each `.utam.json` into the staged package, preserving its path under the package directory. */
async function stageSources(sources: string[], pageObjectsRootDir: string, stagingDir: string): Promise<void> {
  for (const source of sources) {
    const destination = path.join(stagingDir, 'source', path.relative(pageObjectsRootDir, source));
    // eslint-disable-next-line no-await-in-loop -- a handful of small files; ordering keeps the log readable
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- as above
    await fs.copyFile(source, destination);
  }
}

/** Everything about the package version being published, once every input has been resolved. */
type PublishTarget = {
  subscriberPackageVersionId: string;
  /** Absolute path to the default package directory the page objects are authored under. */
  pageObjectsRootDir: string;
  /** Absolute paths of every `.utam.json` to compile. */
  sources: string[];
  utamPluginConfig: UtamPluginConfig;
  npmPackageName: string;
  salesforcePackageName: string;
  /** The Salesforce version, as `major.minor.patch.build`. */
  salesforceVersion: string;
  /** The derived semver version. */
  version: string;
  distTag: string;
  versionTag: string;
  commitSha?: string;
  pipelineUrl?: string;
};

/**
 * Resolve every input the publish needs, or decide there is nothing to publish.
 *
 * Holds the four guards that depend on reading something — the package version ID, the project,
 * its page objects — so that the caller is left with the flow rather than the lookups.
 *
 * @returns `undefined` when a guard says to skip, having already logged why.
 */
async function resolveTarget(options: PublishUtamPageObjectsOptions): Promise<PublishTarget | undefined> {
  const envFile = options.envFile ?? DEFAULT_ENV_FILE;
  const subscriberPackageVersionId = await resolveSubscriberPackageVersionId({
    flagValue: options.subscriberPackageVersionId,
    envFile,
  });
  if (!subscriberPackageVersionId) {
    logger.warn(
      `No package version ID given, in the environment, or in ${envFile}. ` +
        'This build created no package version, so there are no page objects to publish. Skipping.',
    );
    return undefined;
  }

  const sfdxProjectJson = await readSfdxProject();
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  if (!defaultPackageDir?.path) {
    throw new Error('A default package directory with a `path` must be specified in sfdx-project.json.');
  }

  const pageObjectsRootDir = path.resolve(defaultPackageDir.path);
  const sources = await findPageObjectSources(pageObjectsRootDir);
  if (sources.length === 0) {
    logger.info(`No UTAM page objects found under ${defaultPackageDir.path}. Skipping.`);
    return undefined;
  }
  logger.info(`Found ${sources.length} UTAM page object(s) under ${defaultPackageDir.path}.`);

  const versionTagFormat = VersionTagFormat.fromProject(sfdxProjectJson);
  const utamPluginConfig = readUtamPluginConfig(sfdxProjectJson);
  const npmPackageName = options.npmPackageName ?? utamPluginConfig.packageName;
  if (!npmPackageName) {
    throw new Error(
      'No npm package name to publish under. Pass --npm-package-name, or set `plugins.simply.utam.packageName` in sfdx-project.json.',
    );
  }

  const { result: report } = await runSfJson<{ result: PackageVersionReport }>([
    'package',
    'version',
    'report',
    '--package',
    subscriberPackageVersionId,
    '--target-dev-hub',
    options.packagingDevhub,
    '--json',
  ]);
  if (!report.Version) {
    throw new Error(
      `Could not read a version number for ${subscriberPackageVersionId} from its package version report.`,
    );
  }

  const tagSuffix = determineTagSuffix(
    defaultPackageDir.branch,
    options.ciCommitRefName,
    options.packageReleaseBranchPrefix,
  );

  return {
    subscriberPackageVersionId,
    pageObjectsRootDir,
    sources,
    utamPluginConfig,
    npmPackageName,
    salesforcePackageName: report.Package2Name ?? defaultPackageDir.package ?? 'package',
    salesforceVersion: report.Version,
    version: toNpmVersion(report.Version, tagSuffix),
    distTag: options.npmDistTag ?? toDistTag(tagSuffix),
    versionTag: toVersionTag(report.Version, tagSuffix, versionTagFormat),
    commitSha: report.Tag,
    pipelineUrl: report.Description,
  };
}

/**
 * Fill the staging directory with a publishable package: the compiler, its generated config, the
 * compiled output, the source JSON, and the manifest describing all of it.
 */
async function buildStagedPackage(
  stagingDir: string,
  target: PublishTarget,
  options: PublishUtamPageObjectsOptions,
): Promise<void> {
  const compiler = await installCompiler(stagingDir, options.utamVersion ?? '^3', options.debug ?? false);

  const baseConfig = target.utamPluginConfig.compilerConfig
    ? (JSON.parse(await fs.readFile(target.utamPluginConfig.compilerConfig, 'utf8')) as Record<string, unknown>)
    : undefined;
  const compilerConfigPath = path.join(stagingDir, 'utam.config.json');
  await fs.writeFile(
    compilerConfigPath,
    JSON.stringify(
      buildCompilerConfig({
        pageObjectsRootDir: target.pageObjectsRootDir,
        stagingDir,
        npmPackageName: target.npmPackageName,
        version: target.version,
        copyright: buildProvenanceLine(
          target.salesforcePackageName,
          target.salesforceVersion,
          target.subscriberPackageVersionId,
        ),
        alias: target.utamPluginConfig.alias,
        baseConfig,
      }),
      null,
      2,
    ),
  );

  logger.info('Compiling page objects...');
  // Run the installed compiler's entry point with this same Node rather than going through npx,
  // which would be free to reach the network for a package that is already sitting right here.
  await execa(process.execPath, [compiler.entry, '-c', compilerConfigPath], {
    cwd: stagingDir,
    stdio: options.debug ? 'inherit' : 'pipe',
  });

  await stageSources(target.sources, target.pageObjectsRootDir, stagingDir);
  await fs.writeFile(
    path.join(stagingDir, 'package.json'),
    `${JSON.stringify(
      buildPackageManifest({
        npmPackageName: target.npmPackageName,
        version: target.version,
        salesforcePackageName: target.salesforcePackageName,
        salesforceVersion: target.salesforceVersion,
        subscriberPackageVersionId: target.subscriberPackageVersionId,
        versionTag: target.versionTag,
        commitSha: target.commitSha,
        pipelineUrl: target.pipelineUrl,
        utamCoreRange: toUtamCoreRange(compiler.version),
        projectPeerDependencies: target.utamPluginConfig.peerDependencies,
      }),
      null,
      2,
    )}\n`,
  );
}

/** `npm publish` the staged package, targeting the registry and access level the pipeline asked for. */
async function publishStaged(
  stagingDir: string,
  distTag: string,
  options: PublishUtamPageObjectsOptions,
): Promise<void> {
  const args = ['publish', '--tag', distTag];
  if (options.npmRegistry) {
    args.push('--registry', options.npmRegistry);
  }
  if (options.npmAccess) {
    args.push('--access', options.npmAccess);
  }

  await execa('npm', args, { cwd: stagingDir, stdio: options.debug ? 'inherit' : 'pipe' });
}

/** `npm pack` the staged package and copy the tarball where a CI job can collect it as an artifact. */
async function packTarball(stagingDir: string): Promise<string> {
  const { stdout } = await execa('npm', ['pack', '--json'], { cwd: stagingDir });
  const packed = JSON.parse(stdout) as Array<{ filename?: string }>;
  const filename = packed[0]?.filename;

  if (!filename) {
    throw new Error('npm pack did not report a tarball filename.');
  }

  const destination = path.join(process.cwd(), filename);
  await fs.copyFile(path.join(stagingDir, filename), destination);

  return destination;
}

/**
 * Compile the project's UTAM page objects for one package version and publish them as an npm
 * package whose version is derived from the Salesforce version number.
 *
 * Runs after `create-package-version`, whose `04t` it takes as input, so that every Unlocked
 * Package version has a corresponding page-object package a UI-test suite can pin to. See
 * `docs/design/0037-utam-page-objects-publish.md` for the reasoning, particularly the version
 * mapping and why the compiler config is generated per build rather than read from the repo.
 *
 * Skips (without failing) when the package didn't change, when the job is disabled, when no `04t`
 * can be found, when the project authors no page objects, or when this exact version is already on
 * the registry. Everything past those guards throws on failure: a missing page-object package would
 * silently break every UI test pinned to that version.
 */
export async function publishUtamPageObjects(
  options: PublishUtamPageObjectsOptions,
): Promise<PublishUtamPageObjectsResult> {
  const skipReason = getSkipReason('publish-utam-page-objects');
  if (skipReason) {
    logger.warn(skipReason);
    return skip();
  }

  if (options.disabled) {
    logger.warn('publish-utam-page-objects is disabled. Skipping.');
    return skip();
  }

  const target = await resolveTarget(options);
  if (!target) {
    return skip();
  }

  const { npmPackageName, version, distTag } = target;
  const outFile = options.out ?? DEFAULT_ENV_FILE;
  const publishedKeys = { [UTAM_PACKAGE_KEY]: npmPackageName, [UTAM_VERSION_KEY]: version };
  logger.info(`Publishing ${npmPackageName}@${version} (dist-tag ${distTag}) for ${target.salesforceVersion}.`);

  // Never inside the repo: the checkout is what gets compiled, and a generated package.json next to
  // sfdx-project.json would be picked up by anything else the job runs.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-cicd-utam-'));
  if (options.debug) {
    logger.debug(`Staging directory: ${stagingDir}`);
  }

  // Registry auth is the job's to set up, not this command's. Because npm runs from the staging
  // directory, it sees user, global, and environment config, but never the repo's own .npmrc.
  try {
    if (
      !options.dryRun &&
      (await isAlreadyPublished(`${npmPackageName}@${version}`, stagingDir, options.npmRegistry))
    ) {
      logger.info(`${npmPackageName}@${version} is already published. Skipping.`);
      appendToEnvFile(outFile, publishedKeys);
      return { skipped: true, published: false, alreadyPublished: true, packageName: npmPackageName, version, distTag };
    }

    await buildStagedPackage(stagingDir, target, options);

    if (options.dryRun) {
      const tarball = await packTarball(stagingDir);
      logger.success(`Dry run: packed ${npmPackageName}@${version} to ${tarball}. Nothing was published.`);
      return { skipped: false, published: false, packageName: npmPackageName, version, distTag, tarball };
    }

    await publishStaged(stagingDir, distTag, options);
    logger.success(`Published ${npmPackageName}@${version} (dist-tag ${distTag}).`);
    appendToEnvFile(outFile, publishedKeys);

    return { skipped: false, published: true, packageName: npmPackageName, version, distTag };
  } finally {
    if (options.debug) {
      logger.debug(`Leaving the staging directory in place for inspection: ${stagingDir}`);
    } else {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
}
