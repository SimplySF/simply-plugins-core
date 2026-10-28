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
import { execa } from 'execa';
import { getDefaultPackageDirectory, getPluginConfig, readSfdxProject, type SfdxProject } from '@simplysf/simply-core';
import { createVcsProvider, type VcsProviderKind } from '../vcs/index.js';
import { runSf } from '../exec/sfCli.js';
import { addGitRemote } from '../git.js';
import { logger } from '../logger.js';
import { VersionTagFormat } from './versionTagFormat.js';

type PackageVersionCreateReport = { Status: string; Error?: string; SubscriberPackageVersionId?: string };

/**
 * Whether this build's ref is a release-branch build.
 *
 * Exported for `publishUtamPageObjects`, which derives its npm version from the same
 * release-vs-feature-branch decision this module makes for the git tag.
 */
export function refIncludesPrefix(ciCommitRefName: string, packageReleaseBranchPrefix?: string): boolean {
  return packageReleaseBranchPrefix !== undefined && ciCommitRefName.includes(packageReleaseBranchPrefix);
}

function determineBranchArgs(
  branchAttribute: string | undefined,
  ciCommitRefName: string,
  packageReleaseBranchPrefix?: string,
): string[] {
  if (branchAttribute) {
    return ['--branch', branchAttribute];
  }
  if (!refIncludesPrefix(ciCommitRefName, packageReleaseBranchPrefix)) {
    return ['--branch', ciCommitRefName];
  }
  return [];
}

/**
 * The suffix appended to this build's version tag: the package's `branch` attribute, else the CI ref
 * unless this is a release-branch build, which gets none. A build with neither a `branch` attribute
 * nor a ref is treated like a release build, the only reading that doesn't produce a tag ending in
 * `-undefined`.
 *
 * Exported because `publishUtamPageObjects` derives its npm version from the same suffix, so that
 * the published page-object version reads like the tag rather than being a second, parallel rule.
 */
export function determineTagSuffix(
  branchAttribute: string | undefined,
  ciCommitRefName: string | undefined,
  packageReleaseBranchPrefix?: string,
): string | undefined {
  if (branchAttribute) {
    return branchAttribute;
  }
  if (!ciCommitRefName || refIncludesPrefix(ciCommitRefName, packageReleaseBranchPrefix)) {
    return undefined;
  }
  return ciCommitRefName;
}

function resolveMinimumCoverage(codeCoverageMinimum: string | undefined, sfdxProjectJson: SfdxProject): number {
  let minCoverage = parseInt(codeCoverageMinimum ?? '75', 10);
  if (Number.isNaN(minCoverage)) {
    minCoverage = 75;
  }
  const projectMinCoverage = getPluginConfig<string>(
    sfdxProjectJson,
    'plugins.simply.coverageRequirement.minimumCoverageRequired',
  );
  if (projectMinCoverage) {
    const parsedProjectMin = parseInt(projectMinCoverage, 10);
    if (!Number.isNaN(parsedProjectMin)) {
      minCoverage = parsedProjectMin;
    }
  }
  return minCoverage;
}

/**
 * Logs the package Id (`0Ho…`) recorded under `packageAliases` for the project's top-level `name`,
 * warning rather than failing when either is missing — the Id is informational only.
 */
function logPackageId(sfdxProjectJson: SfdxProject): void {
  // `name` isn't a declared SfdxProject property, so it arrives as `unknown` via the index signature.
  const projectName = typeof sfdxProjectJson.name === 'string' ? sfdxProjectJson.name : undefined;
  const packageId = projectName ? sfdxProjectJson.packageAliases?.[projectName] : undefined;
  if (packageId) {
    logger.info(`Package Id: ${packageId}`);
  } else {
    logger.warn(`No package Id found in packageAliases for project name "${projectName ?? ''}" in sfdx-project.json`);
  }
}

async function pollPackageVersionCreation(createRequestId: string, packagingDevhub: string): Promise<string> {
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- each poll must wait for the previous one's result before deciding to continue
    const { stdout: reportStdout } = await runSf([
      'package',
      'version',
      'create',
      'report',
      '--package-create-request-id',
      createRequestId,
      '--target-dev-hub',
      packagingDevhub,
      '--json',
    ]);
    const report = (JSON.parse(reportStdout) as { result: PackageVersionCreateReport[] }).result[0];
    logger.info(`Polling package creation status: ${report.Status}`);
    if (report.Status === 'Error') {
      throw new Error(`Package creation failed: ${report.Error ?? 'unknown error'}`);
    }
    if (report.Status === 'Success') {
      const subscriberPackageVersionId = report.SubscriberPackageVersionId ?? '';
      logger.success(`Package version created successfully: ${subscriberPackageVersionId}`);
      return subscriberPackageVersionId;
    }
    // eslint-disable-next-line no-await-in-loop -- polling must space requests out; nothing else to do meanwhile
    await new Promise((resolve) => {
      setTimeout(resolve, 60_000);
    });
  }
}

export type CreatePackageVersionOptions = {
  ciCommitRefName: string;
  ciCommitSha: string;
  ciPipelineId: string;
  ciPipelineSource?: string;
  ciPipelineUrl: string;
  ciProjectPath: string;
  projectAccessToken: string;
  /** The packaging DevHub's alias. Must already be authenticated. */
  packagingDevhub: string;
  debug?: boolean;
  alwaysCreatePackage?: boolean;
  packageReleaseBranchPrefix?: string;
  codeCoverageMinimum?: string;
  vcsHost?: string;
  vcsProvider: VcsProviderKind;
};

/**
 * Creates a new package version for the default package directory, verifies it meets minimum code
 * coverage, and creates/pushes a version-tracking git tag. No-ops (without error) when the pipeline
 * was triggered by a merge request, or when this isn't a release-branch build and
 * `alwaysCreatePackage` wasn't requested.
 */
export async function createPackageVersion(options: CreatePackageVersionOptions): Promise<void> {
  if (options.ciPipelineSource === 'merge_request_event') {
    logger.info('Not a release branch build. Skipping package creation.');
    return;
  }
  if (!options.alwaysCreatePackage && !refIncludesPrefix(options.ciCommitRefName, options.packageReleaseBranchPrefix)) {
    logger.info('Not a release branch build and alwaysCreatePackage is not TRUE. Skipping package creation.');
    return;
  }

  logger.info('Creating new package version...');
  const vcsProvider = createVcsProvider(options.vcsProvider, {
    host: options.vcsHost,
    token: options.projectAccessToken,
  });
  const remoteAlias = await addGitRemote(
    options.ciPipelineId,
    options.projectAccessToken,
    options.ciProjectPath,
    vcsProvider,
  );

  const sfdxProjectJson = await readSfdxProject();
  const defaultPackageDir = getDefaultPackageDirectory(sfdxProjectJson);
  const { definitionFile, package: packageAlias, branch: branchAttribute } = defaultPackageDir ?? {};
  if (!definitionFile || !packageAlias) {
    throw new Error(
      '`package` and `definitionFile` must be specified in the default package directory in sfdx-project.json',
    );
  }

  // Validated before `sf package version create`, so a bad format can't cost a package version
  // whose tag then can't be written.
  const versionTagFormat = VersionTagFormat.fromProject(sfdxProjectJson);

  logPackageId(sfdxProjectJson);

  const branchArgs = determineBranchArgs(branchAttribute, options.ciCommitRefName, options.packageReleaseBranchPrefix);
  const { stdout: createStdout } = await runSf([
    'package',
    'version',
    'create',
    '--code-coverage',
    '--package',
    packageAlias,
    '--definition-file',
    definitionFile,
    '--version-description',
    options.ciPipelineUrl,
    '--tag',
    options.ciCommitSha,
    '--target-dev-hub',
    options.packagingDevhub,
    ...branchArgs,
    '--installation-key-bypass',
    '--wait',
    '0',
    '--json',
  ]);
  const createRequestId = (JSON.parse(createStdout) as { result: { Id: string } }).result.Id;
  logger.info(`Package version creation requested. Request ID: ${createRequestId}`);

  const subscriberPackageVersionId = await pollPackageVersionCreation(createRequestId, options.packagingDevhub);
  await fs.writeFile('subscriberPackageVersionId.env', `SUBSCRIBER_PACKAGE_VERSION_ID=${subscriberPackageVersionId}`);

  const { stdout: versionReportStdout } = await runSf([
    'package',
    'version',
    'report',
    '--package',
    subscriberPackageVersionId,
    '--target-dev-hub',
    options.packagingDevhub,
    '--json',
  ]);
  const versionReport = (
    JSON.parse(versionReportStdout) as {
      result: { Version: string; CodeCoverage: { apexCodeCoveragePercentage: number } };
    }
  ).result;
  const codeCoverage = versionReport.CodeCoverage.apexCodeCoveragePercentage;
  const minCoverage = resolveMinimumCoverage(options.codeCoverageMinimum, sfdxProjectJson);
  logger.info(`Actual code coverage: ${codeCoverage}%. Required minimum: ${minCoverage}%.`);
  if (codeCoverage < minCoverage) {
    throw new Error(`Code coverage of ${codeCoverage}% is less than the required minimum of ${minCoverage}%.`);
  }

  const versionTag = versionTagFormat.render(
    versionReport.Version,
    determineTagSuffix(branchAttribute, options.ciCommitRefName, options.packageReleaseBranchPrefix),
  );
  await execa('git', ['tag', '-a', versionTag, '-m', subscriberPackageVersionId]);
  await execa('git', ['push', remoteAlias, versionTag]);
  logger.success(`Successfully created and pushed git tag: ${versionTag}`);
}
