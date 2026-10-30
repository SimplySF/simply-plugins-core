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

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import {
  getDefaultPackageDirectory,
  isSubscriberPackageVersionId,
  readSfdxProject,
  type SfdxPackageDirectoryDependency,
} from '@simplysf/simply-core';
import { appendToEnvFile } from '../env.js';
import { logger } from '../logger.js';
import {
  getPackage2Info,
  getPackageVersionReport,
  type Package2Info,
  type PackageVersionReportResult,
  resolveDependencyVersionId,
} from '../sfPackages.js';
import { readAerVersion, resolveAerBinary } from './aerBinary.js';
import {
  AER_PACKAGE_FILE_KEY,
  AER_PACKAGE_URL_KEY,
  AER_PACKAGE_VERSION_KEY,
  hasApexSources,
  parseRepositoryHeader,
  readAerPluginConfig,
  renderRepositoryUrl,
  toAerPackageFile,
} from './aerPackage.js';
import { resolveSubscriberPackageVersionId, toDistTag, toNpmVersion } from './packageVersionArtifact.js';
import { getSkipReason } from './skipGuard.js';

/** The default dotenv file, matching what `create-package-version`/`create-fallback-tag` write. */
const DEFAULT_ENV_FILE = 'subscriberPackageVersionId.env';

/** How much of a failed response's body goes into the error. */
const RESPONSE_EXCERPT_LENGTH = 500;

export type PublishAerPackageOptions = {
  /** The packaging Dev Hub's alias. Must already be authenticated. */
  packagingDevhub: string;
  /** URL template to upload to. Overrides `plugins.simply.aer.repositoryUrl`. */
  repositoryUrl?: string;
  /** One `Name: value` header sent with every repository request. Never logged. */
  repositoryHeader?: string;
  subscriberPackageVersionId?: string;
  /** Directories of `.pkg` files for dependencies this command can't download, e.g. managed packages. */
  dependencyPackageDirs?: string[];
  /** The aer binary. Otherwise `AER_BIN`, the aer sf plugin's download, then `PATH`. */
  aerPath?: string;
  /** Build the package and copy it to the working directory, but don't upload it. */
  dryRun?: boolean;
  /** Dotenv file to append the published URL, file name and version to. */
  out?: string;
  /** Dotenv file to read `SUBSCRIBER_PACKAGE_VERSION_ID` from. */
  envFile?: string;
  debug?: boolean;
  disabled?: boolean;
};

export type PublishAerPackageResult = {
  skipped: boolean;
  published: boolean;
  /** True when this exact version was already in the repository, so nothing needed uploading. */
  alreadyPublished?: boolean;
  packageName?: string;
  namespace?: string;
  version?: string;
  url?: string;
  /** The package's file name, or its local path on `--dry-run`. */
  file?: string;
  aerVersion?: string;
};

/** A run that did nothing, in the shape every guard returns. */
function skip(): PublishAerPackageResult {
  return { skipped: true, published: false };
}

/** One package version's place in the repository. */
type PublishedLocation = {
  name: string;
  namespace: string;
  /** Has no namespace in Salesforce, so its aer namespace is its own name. */
  namespaceless: boolean;
  file: string;
  /** The derived semver version. */
  version: string;
  url: string;
};

/**
 * Where a package version lives in the repository.
 *
 * Producer and dependent both call this, so they always agree. Everything comes from the Dev Hub
 * rather than either repo's checkout: the package's name and namespace from `Package2`, and the
 * git tag suffix from the version's `Branch`, which `create-package-version` sets from the same
 * decision it makes for the tag.
 */
function locate(package2: Package2Info, report: PackageVersionReportResult, template: string): PublishedLocation {
  if (!report.Version) {
    throw new Error(`Could not read a version number for ${package2.Name} from its package version report.`);
  }

  const { file, name, namespace } = toAerPackageFile(package2.Name, package2.NamespacePrefix);
  const suffix = report.Branch ?? undefined;
  const version = toNpmVersion(report.Version, suffix);
  const url = renderRepositoryUrl(template, {
    name,
    version,
    versionNumber: report.Version,
    channel: toDistTag(suffix),
    namespace,
    file,
  });

  return { name, namespace, namespaceless: !package2.NamespacePrefix, file, version, url };
}

/** The URL without its query string, which for a presigned URL is the credential. */
function forLog(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?…`;
}

function requestHeaders(header?: { name: string; value: string }): Record<string, string> {
  return header ? { [header.name]: header.value } : {};
}

async function responseExcerpt(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim();
    return body.length > 0 ? `: ${body.slice(0, RESPONSE_EXCERPT_LENGTH)}` : '';
  } catch {
    return '';
  }
}

/**
 * Whether `url` already holds a published package.
 *
 * Anything but a 2xx — including a network failure — is read as "not yet": the common cause is the
 * 404 for a version that doesn't exist, and any real problem fails the upload right after with a
 * better message than this check could give.
 */
async function isAlreadyPublished(url: string, header?: { name: string; value: string }): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', headers: requestHeaders(header) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Everything about the package version being published, once every input has been resolved. */
type PublishTarget = {
  subscriberPackageVersionId: string;
  /** Absolute path to the default package directory aer compiles. */
  packageDir: string;
  dependencies: SfdxPackageDirectoryDependency[];
  packageAliases: Record<string, string>;
  template: string;
  header?: { name: string; value: string };
  location: PublishedLocation;
};

/**
 * Resolve every input the publish needs, or decide there is nothing to publish.
 *
 * @returns `undefined` when a guard says to skip, having already logged why.
 */
async function resolveTarget(options: PublishAerPackageOptions): Promise<PublishTarget | undefined> {
  const envFile = options.envFile ?? DEFAULT_ENV_FILE;
  const subscriberPackageVersionId = await resolveSubscriberPackageVersionId({
    flagValue: options.subscriberPackageVersionId,
    envFile,
  });
  if (!subscriberPackageVersionId) {
    logger.warn(
      `No package version ID given, in the environment, or in ${envFile}. ` +
        'This build created no package version, so there is no aer package to publish. Skipping.',
    );
    return undefined;
  }

  const sfdxProjectJson = await readSfdxProject();
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  if (!defaultPackageDir?.path) {
    throw new Error('A default package directory with a `path` must be specified in sfdx-project.json.');
  }

  const packageDir = path.resolve(defaultPackageDir.path);
  if (!(await hasApexSources(packageDir))) {
    logger.info(`No Apex classes or triggers found under ${defaultPackageDir.path}. Skipping.`);
    return undefined;
  }

  const template = options.repositoryUrl ?? readAerPluginConfig(sfdxProjectJson).repositoryUrl;
  if (!template) {
    throw new Error(
      'No repository to publish to. Pass --repository-url, or set `plugins.simply.aer.repositoryUrl` in sfdx-project.json.',
    );
  }
  const header = options.repositoryHeader ? parseRepositoryHeader(options.repositoryHeader) : undefined;

  const report = await getPackageVersionReport(subscriberPackageVersionId, options.packagingDevhub);
  if (!report.Package2Id) {
    throw new Error(`Could not read a package ID for ${subscriberPackageVersionId} from its package version report.`);
  }
  const package2 = await getPackage2Info(report.Package2Id, options.packagingDevhub);

  return {
    subscriberPackageVersionId,
    packageDir,
    dependencies: defaultPackageDir.dependencies ?? [],
    packageAliases: sfdxProjectJson.packageAliases ?? {},
    template,
    header,
    location: locate(package2, report, template),
  };
}

/** A dependency this command downloaded, for the log and for explaining a type error. */
type StagedDependency = { label: string; location: PublishedLocation };

/**
 * The `04t` a declared dependency points at: its alias or ID directly, or a `package` +
 * `versionNumber` pair resolved through the Dev Hub.
 */
async function dependencyVersionId(
  dependency: SfdxPackageDirectoryDependency,
  packageAliases: Record<string, string>,
  devHub: string,
): Promise<string> {
  const declared = dependency.package ?? '';
  const id = packageAliases[declared] ?? declared;

  if (dependency.versionNumber) {
    return resolveDependencyVersionId(id, dependency.versionNumber, devHub, dependency.branch);
  }
  if (!isSubscriberPackageVersionId(id)) {
    throw new Error(`Dependency "${declared}" doesn't resolve to a subscriber package version ID (04t).`);
  }
  return id;
}

/**
 * Download the `.pkg` of every dependency this Dev Hub owns into `targetDir`.
 *
 * A dependency the Dev Hub can't report on (a managed package, or one from another Dev Hub) isn't
 * fetched; it's expected in a `--dependency-package-dir`. aer decides whether anything is missing.
 */
async function stageDependencies(
  target: PublishTarget,
  targetDir: string,
  options: PublishAerPackageOptions,
): Promise<StagedDependency[]> {
  const staged: StagedDependency[] = [];
  const external: string[] = [];

  for (const dependency of target.dependencies) {
    const label = dependency.package ?? '(unnamed dependency)';
    // eslint-disable-next-line no-await-in-loop -- a handful of dependencies; ordering keeps the log readable
    const versionId = await dependencyVersionId(dependency, target.packageAliases, options.packagingDevhub);

    let report: PackageVersionReportResult;
    try {
      // eslint-disable-next-line no-await-in-loop -- as above
      report = await getPackageVersionReport(versionId, options.packagingDevhub);
    } catch {
      external.push(label);
      continue;
    }
    if (!report.Package2Id) {
      external.push(label);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- as above
    const location = locate(await getPackage2Info(report.Package2Id, options.packagingDevhub), report, target.template);
    // eslint-disable-next-line no-await-in-loop -- as above
    const response = await fetch(location.url, { headers: requestHeaders(target.header) });
    if (!response.ok) {
      throw new Error(
        `Could not download the aer package for dependency ${label} from ${forLog(location.url)} ` +
          // eslint-disable-next-line no-await-in-loop -- as above
          `(HTTP ${response.status}${await responseExcerpt(response)}). Has its pipeline published it?`,
      );
    }
    // eslint-disable-next-line no-await-in-loop -- as above
    await fs.writeFile(path.join(targetDir, location.file), Buffer.from(await response.arrayBuffer()));
    logger.info(`Downloaded ${location.file} ${location.version} for dependency ${label}.`);
    staged.push({ label, location });
  }

  if (external.length > 0) {
    logger.info(
      `Not owned by this Dev Hub, so expected in --dependency-package-dir: ${external.join(', ')}. ` +
        'A managed package can be mocked with `aer package mock <namespace>`.',
    );
  }

  return staged;
}

/** Run `aer package create`, turning a failure into an error that carries aer's own message. */
async function buildPackage(
  aerBinary: string,
  outputFile: string,
  packageDirs: string[],
  target: PublishTarget,
  staged: StagedDependency[],
  debug: boolean,
): Promise<void> {
  const args = ['package', 'create', '-o', outputFile];
  for (const dir of packageDirs) {
    args.push('--package-dir', dir);
  }
  args.push(target.packageDir);

  // `.aerrc` files are ignored so that a developer's or a repo's test settings can't change what
  // gets published, and auto-update is off so the pinned binary is the one that runs.
  const result = await execa(aerBinary, args, {
    env: { AER_NO_RC: '1', AER_AUTOUPDATE_DISABLED: '1' },
    reject: false,
    stdio: debug ? 'inherit' : 'pipe',
  });
  if (result.exitCode === 0) {
    return;
  }

  const output = [result.stderr, result.stdout]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join('\n')
    .trim();
  let message = `aer package create failed (exit ${String(result.exitCode)})${output ? `:\n${output}` : '.'}`;

  // aer only resolves a reference into a .pkg when it's namespace-qualified, and `create` has no
  // `--default-namespace`, so a namespaceless package calling a namespaceless dependency can't build.
  const namespaceless = staged.filter((dependency) => dependency.location.namespaceless);
  if (target.location.namespaceless && namespaceless.length > 0 && /type check/i.test(output)) {
    message +=
      `\n\nThis package and ${namespaceless.map((d) => d.label).join(', ')} have no namespace. aer resolves ` +
      'references into a dependency package only when they are namespace-qualified, and `aer package create` ' +
      'has no --default-namespace, so this package cannot be built as an aer package yet.';
  }

  throw new Error(message);
}

/** `PUT` the package, with a SHA-256 header Artifactory verifies and other repositories ignore. */
async function upload(file: string, target: PublishTarget): Promise<void> {
  const body = await fs.readFile(file);
  const response = await fetch(target.location.url, {
    method: 'PUT',
    headers: {
      ...requestHeaders(target.header),
      'Content-Type': 'application/octet-stream',
      'X-Checksum-Sha256': createHash('sha256').update(body).digest('hex'),
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Uploading ${target.location.file} to ${forLog(target.location.url)} failed ` +
        `(HTTP ${response.status}${await responseExcerpt(response)}).`,
    );
  }
}

/**
 * Build the project's aer package (`.pkg`) for one package version and upload it to an artifact
 * repository, under a path derived from the Salesforce version number.
 *
 * Runs after `create-package-version`, whose `04t` it takes as input, so that every Unlocked
 * Package version has a matching aer package a consumer can test against locally. See
 * `docs/design/0059-aer-package-publish.md` in `simply-plugins` for the reasoning, particularly why
 * the file name carries the namespace and the version lives only in the path.
 *
 * Skips (without failing) when the package didn't change, when the job is disabled, when no `04t`
 * can be found, when the package has no Apex, or when this exact version is already uploaded.
 * Everything past those guards throws on failure: a missing aer package would silently break every
 * consumer pinned to that version.
 */
export async function publishAerPackage(options: PublishAerPackageOptions): Promise<PublishAerPackageResult> {
  const skipReason = getSkipReason('publish-aer-package');
  if (skipReason) {
    logger.warn(skipReason);
    return skip();
  }

  if (options.disabled) {
    logger.warn('publish-aer-package is disabled. Skipping.');
    return skip();
  }

  const target = await resolveTarget(options);
  if (!target) {
    return skip();
  }

  const { location } = target;
  const outFile = options.out ?? DEFAULT_ENV_FILE;
  const publishedKeys = {
    [AER_PACKAGE_URL_KEY]: location.url,
    [AER_PACKAGE_FILE_KEY]: location.file,
    [AER_PACKAGE_VERSION_KEY]: location.version,
  };
  const described = { packageName: location.name, namespace: location.namespace, version: location.version };
  logger.info(`Publishing ${location.file} ${location.version} to ${forLog(location.url)}.`);

  if (!options.dryRun && (await isAlreadyPublished(location.url, target.header))) {
    logger.info(`${location.file} ${location.version} is already published. Skipping.`);
    appendToEnvFile(outFile, publishedKeys);
    return {
      skipped: true,
      published: false,
      alreadyPublished: true,
      ...described,
      url: location.url,
      file: location.file,
    };
  }

  const aerBinary = await resolveAerBinary({ aerPath: options.aerPath });
  const aerVersion = await readAerVersion(aerBinary);
  logger.info(`Using aer ${aerVersion ?? '(unknown version)'} at ${aerBinary}.`);

  // Never inside the repo: aer compiles the package directory, and nothing generated should land in it.
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-cicd-aer-'));
  if (options.debug) {
    logger.debug(`Staging directory: ${stagingDir}`);
  }

  try {
    const dependenciesDir = path.join(stagingDir, 'dependencies');
    await fs.mkdir(dependenciesDir);
    const staged = await stageDependencies(target, dependenciesDir, options);

    const outputFile = path.join(stagingDir, location.file);
    await buildPackage(
      aerBinary,
      outputFile,
      [dependenciesDir, ...(options.dependencyPackageDirs ?? []).map((dir) => path.resolve(dir))],
      target,
      staged,
      options.debug ?? false,
    );

    if (options.dryRun) {
      const destination = path.join(process.cwd(), location.file);
      await fs.copyFile(outputFile, destination);
      logger.success(`Dry run: built ${destination}. Nothing was uploaded.`);
      return { skipped: false, published: false, ...described, url: location.url, file: destination, aerVersion };
    }

    await upload(outputFile, target);
    logger.success(`Published ${location.file} ${location.version}.`);
    appendToEnvFile(outFile, publishedKeys);

    return { skipped: false, published: true, ...described, url: location.url, file: location.file, aerVersion };
  } finally {
    if (options.debug) {
      logger.debug(`Leaving the staging directory in place for inspection: ${stagingDir}`);
    } else {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
}
