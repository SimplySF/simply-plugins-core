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

import type { VcsProject, VcsProvider } from '../vcs/index.js';
import { runSfJson } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { updateSfdxProject } from './updater.js';
import type { UpdateSfdxProjectResult } from './updater.js';

type SubscriberPackageVersionRecord = {
  Name?: string;
  MajorVersion?: number;
  MinorVersion?: number;
  PatchVersion?: number;
  BuildNumber?: number;
};

export type ResolvePackageDetailsResult = { packageName: string; packageVersion: string };

/** Queries the DevHub for a released subscriber package version's name and semantic version. */
export async function resolvePackageDetails(
  devhubUsername: string,
  subscriberPackageVersionId: string,
): Promise<ResolvePackageDetailsResult> {
  if (!devhubUsername) {
    throw new Error('Missing DevHub username/alias (PACKAGING_DEVHUB_USERNAME).');
  }
  if (!subscriberPackageVersionId) {
    throw new Error('Missing subscriber package version ID (SUBSCRIBER_PACKAGE_VERSION_ID).');
  }

  logger.info(`Querying DevHub for package details of 04t version: ${subscriberPackageVersionId}...`);

  const query = `SELECT MajorVersion, MinorVersion, PatchVersion, Name, BuildNumber FROM SubscriberPackageVersion WHERE Id = '${subscriberPackageVersionId}'`;
  const args = ['data', 'query', '-o', devhubUsername, '-q', query, '--use-tooling-api', '--json'];

  try {
    const queryResult = await runSfJson<{
      records?: SubscriberPackageVersionRecord[];
      result?: { records?: SubscriberPackageVersionRecord[] };
    }>(args);
    const records = queryResult.result?.records ?? queryResult.records;

    if (!records || records.length === 0) {
      throw new Error(`No records found for Id: ${subscriberPackageVersionId}`);
    }

    const record = records[0];
    const rawName = record.Name ?? '';
    const packageName = rawName.replace(/\s+v\d+\.\d+(\.\d+)?.*$/, '');
    const { MajorVersion: major, MinorVersion: minor, PatchVersion: patch, BuildNumber: build } = record;

    if (!packageName || major === undefined || minor === undefined || patch === undefined || build === undefined) {
      throw new Error(`Incomplete package details returned from DevHub query for ID: ${subscriberPackageVersionId}`);
    }

    const packageVersion = `${major}.${minor}.${patch}-${build}`;
    logger.success(`Resolved package details: ${packageName}@${packageVersion}`);
    return { packageName, packageVersion };
  } catch (error) {
    logger.error(`Failed to query DevHub for package version details: ${(error as Error).message}`);
    throw error;
  }
}

export type FilterProjectOptions = {
  upstreamProjectPath?: string;
  upstreamProjectId?: string;
  skipArchived?: boolean;
  skipForks?: boolean;
  allowlist?: string;
  denylist?: string;
};

export type FilterProjectResult = { keep: boolean; reason?: string };

/** Decides whether a discovered project should be scanned, per the upstream/archived/fork/allow-deny rules. */
export function filterProject(project: VcsProject, options: FilterProjectOptions = {}): FilterProjectResult {
  const { upstreamProjectPath, upstreamProjectId, skipArchived, skipForks, allowlist, denylist } = options;
  const pathWithNamespace = project.pathWithNamespace;

  if (pathWithNamespace.toLowerCase() === upstreamProjectPath?.toLowerCase()) {
    return { keep: false, reason: 'Upstream repository (CI_PROJECT_PATH)' };
  }
  if (upstreamProjectId && project.id === Number(upstreamProjectId)) {
    return { keep: false, reason: 'Upstream repository (CI_PROJECT_ID)' };
  }

  if (skipArchived && project.archived) {
    return { keep: false, reason: 'Archived project' };
  }

  if (project.empty || !project.defaultBranch) {
    return { keep: false, reason: 'Empty repository or missing default branch' };
  }

  if (skipForks && project.isFork) {
    return { keep: false, reason: 'Forked repository' };
  }

  if (allowlist && allowlist.trim() !== '') {
    const list = allowlist.split(',').map((item) => item.trim().toLowerCase());
    const matches = list.some(
      (item) => pathWithNamespace.toLowerCase() === item || pathWithNamespace.toLowerCase().includes(item),
    );
    if (!matches) {
      return { keep: false, reason: 'Not in project allowlist' };
    }
  }

  if (denylist && denylist.trim() !== '') {
    const list = denylist.split(',').map((item) => item.trim().toLowerCase());
    const matches = list.some(
      (item) => pathWithNamespace.toLowerCase() === item || pathWithNamespace.toLowerCase().includes(item),
    );
    if (matches) {
      return { keep: false, reason: 'In project denylist' };
    }
  }

  return { keep: true };
}

/** Splits the comma-separated label option into the label list the VCS provider expects. */
export function splitLabels(labels: string | undefined): string[] | undefined {
  if (!labels?.trim()) {
    return undefined;
  }
  const parsed = labels
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export type GenerateMrDescriptionInput = {
  packageName: string;
  oldVersions: string[];
  packageVersion: string;
  subscriberPackageVersionId: string;
  /** The platform's word for a proposed change, from `VcsProvider.terminology`. */
  changeRequest?: string;
};

/** Renders the markdown description body for a dependency-bump change request. */
export function generateMrDescription({
  packageName,
  oldVersions,
  packageVersion,
  subscriberPackageVersionId,
  changeRequest = 'merge request',
}: GenerateMrDescriptionInput): string {
  const previousVersionsStr = oldVersions.length > 0 ? oldVersions.join(', ') : 'unknown';
  return `## SFDX Project Dependabot Update

This ${changeRequest} updates a Salesforce 2GP package dependency.

| Field                         | Value            |
| ----------------------------- | ---------------- |
| Package                       | \`${packageName}\` |
| Previous version              | \`${previousVersionsStr}\`  |
| New version                   | \`${packageVersion}\`  |
| Subscriber package version ID | \`${subscriberPackageVersionId}\`       |

### Files changed

- \`sfdx-project.json\`

### Validation

This ${changeRequest} should be validated by the downstream repository pipeline
before merge.

### Notes

This ${changeRequest} was generated automatically by \`sf simply cicd sfdx-dependabot\`.`;
}

export type SfdxDependabotSummary = {
  packageName: string;
  packageVersion: string;
  subscriberPackageVersionId: string;
  projectsDiscovered: number;
  projectsEligible: number;
  projectsUpdated: number;
  mergeRequestsCreated: number;
  mergeRequestsAlreadyOpen: number;
  alreadyCurrent: number;
  noDependencyFound: number;
  missingSfdxProjectFile: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

export type ResolvedOptions = {
  vcsHost?: string;
  vcsApiUrl?: string;
  vcsToken: string;
  rootGroupId: string;
  subscriberPackageVersionId: string;
  devhubUsername: string;
  dryRun: boolean;
  projectAllowlist: string;
  projectDenylist: string;
  skipArchived: boolean;
  skipForks: boolean;
  branchPrefix: string;
  changeRequestLabels: string;
  failOnError: boolean;
  maxProjects?: number;
};

export type SfdxDependabotCounters = {
  projectsUpdated: number;
  mergeRequestsCreated: number;
  mergeRequestsAlreadyOpen: number;
  alreadyCurrent: number;
  noDependencyFound: number;
  missingSfdxProjectFile: number;
  skipped: number;
  failed: number;
};

/** Applies the `--max-projects` safety cap, returning the trimmed list and how many extra projects that skipped. */
export function applyMaxProjectsLimit(
  filteredProjects: VcsProject[],
  maxProjects: number | undefined,
): { projectsToProcess: VcsProject[]; additionalSkipped: number } {
  if (maxProjects === undefined || maxProjects <= 0 || maxProjects >= filteredProjects.length) {
    return { projectsToProcess: filteredProjects, additionalSkipped: 0 };
  }

  logger.warn(
    `Applying safety limit: only scanning first ${maxProjects} of ${filteredProjects.length} eligible projects.`,
  );
  return {
    projectsToProcess: filteredProjects.slice(0, maxProjects),
    additionalSkipped: filteredProjects.length - maxProjects,
  };
}
/** Discovers all projects under the root group and applies the upstream/archived/fork/allow-deny filters. */
export async function discoverEligibleProjects(
  vcsProvider: VcsProvider,
  rootGroupId: string,
  options: ResolvedOptions,
): Promise<{ allProjects: VcsProject[]; filteredProjects: VcsProject[]; skippedCount: number }> {
  logger.info(`Discovering projects in group/path: ${rootGroupId}...`);
  let allProjects: VcsProject[];
  try {
    allProjects = await vcsProvider.listProjects(rootGroupId);
  } catch (error) {
    throw new Error(`Failed to access root group "${rootGroupId}": ${(error as Error).message}`, { cause: error });
  }

  logger.info(`Discovered ${allProjects.length} projects in group.`);

  const { projectPath: upstreamProjectPath, projectId: upstreamProjectId } = vcsProvider.getCiContext();

  const filteredProjects: VcsProject[] = [];
  let skippedCount = 0;

  for (const project of allProjects) {
    const filterResult = filterProject(project, {
      upstreamProjectPath,
      upstreamProjectId,
      skipArchived: options.skipArchived,
      skipForks: options.skipForks,
      allowlist: options.projectAllowlist,
      denylist: options.projectDenylist,
    });

    if (filterResult.keep) {
      filteredProjects.push(project);
    } else {
      skippedCount++;
      logger.debug(`Skipping project ${project.pathWithNamespace}: ${filterResult.reason ?? 'unknown reason'}`);
    }
  }

  logger.info(`Identified ${filteredProjects.length} eligible projects after filtering.`);

  return { allProjects, filteredProjects, skippedCount };
}

/**
 * Processes a single eligible project: reads its `sfdx-project.json`, checks its opt-in status,
 * and (unless already current, not opted in, or a dry run) opens or updates a merge request.
 */
export async function processProject(
  project: VcsProject,
  vcsProvider: VcsProvider,
  options: ResolvedOptions,
  packageName: string,
  packageVersion: string,
  counters: SfdxDependabotCounters,
): Promise<void> {
  const projectPath = project.pathWithNamespace;
  logger.info(`Processing project: ${projectPath}...`);

  let sfdxProjectContent: string;
  try {
    sfdxProjectContent = await vcsProvider.getFileContent(
      project,
      'sfdx-project.json',
      project.defaultBranch ?? 'HEAD',
    );
  } catch (error) {
    if ((error as Error).message.includes('404')) {
      logger.info(`Project ${projectPath} is missing sfdx-project.json.`);
      counters.missingSfdxProjectFile++;
      return;
    }
    throw error;
  }

  let isExplicitlyEnabled = false;
  try {
    const variables = await vcsProvider.getProjectVariables(project);
    const enabledVar = variables.find((variable) => variable.key === 'SFDX_DEPENDABOT_ENABLED');
    if (enabledVar?.value === 'TRUE') {
      isExplicitlyEnabled = true;
    }
  } catch (err) {
    logger.debug(`Could not retrieve project variables for ${projectPath}: ${(err as Error).message}`);
  }

  if (!isExplicitlyEnabled) {
    logger.info(
      `Project ${projectPath} is skipped because automatic dependabot updates are off by default. To enable, configure the repository-level ${vcsProvider.terminology.projectVariable} SFDX_DEPENDABOT_ENABLED=TRUE.`,
    );
    counters.skipped++;
    return;
  }

  const updateResult = updateSfdxProject(
    sfdxProjectContent,
    packageName,
    packageVersion,
    options.subscriberPackageVersionId,
  );

  if (!updateResult.hasDependency) {
    logger.debug(`Project ${projectPath} does not depend on ${packageName}.`);
    counters.noDependencyFound++;
    return;
  }

  if (!updateResult.changed) {
    logger.info(`Project ${projectPath} is already current for dependency ${packageName}.`);
    counters.alreadyCurrent++;
    return;
  }

  const branchName = `${options.branchPrefix}/${packageName}`;
  logger.info(`Project ${projectPath} requires update on branch: ${branchName}`);

  if (options.dryRun) {
    logger.info(`[DRY-RUN] Planned update in ${projectPath}:`);
    logger.info(`[DRY-RUN] - Branch: ${branchName}`);
    logger.info(
      `[DRY-RUN] - Dependency update: ${packageName} (previous: ${updateResult.oldVersions.join(', ') || 'unknown'} -> current: ${packageVersion})`,
    );
    logger.info(
      `[DRY-RUN] - Package alias added: "${packageName}@${packageVersion}": "${options.subscriberPackageVersionId}"`,
    );
    counters.projectsUpdated++;
    counters.mergeRequestsCreated++;
    return;
  }

  await applyProjectUpdate(
    project,
    vcsProvider,
    options,
    packageName,
    packageVersion,
    branchName,
    updateResult,
    counters,
  );
}

/** Creates/reuses the update branch, commits the dependency bump if needed, and opens/updates the merge request. */
export async function applyProjectUpdate(
  project: VcsProject,
  vcsProvider: VcsProvider,
  options: ResolvedOptions,
  packageName: string,
  packageVersion: string,
  branchName: string,
  updateResult: UpdateSfdxProjectResult,
  counters: SfdxDependabotCounters,
): Promise<void> {
  const projectPath = project.pathWithNamespace;
  const defaultBranch = project.defaultBranch ?? 'HEAD';

  const branchAlreadyExists = await vcsProvider.branchExists(project, branchName);
  if (!branchAlreadyExists) {
    logger.info(`Creating branch ${branchName} in ${projectPath}...`);
    await vcsProvider.createBranch(project, branchName, defaultBranch);
  } else {
    logger.info(`Branch ${branchName} already exists in ${projectPath}.`);
  }

  let branchNeedsCommit = true;
  if (branchAlreadyExists) {
    try {
      const branchContent = await vcsProvider.getFileContent(project, 'sfdx-project.json', branchName);
      const branchUpdateCheck = updateSfdxProject(
        branchContent,
        packageName,
        packageVersion,
        options.subscriberPackageVersionId,
      );
      if (!branchUpdateCheck.changed) {
        branchNeedsCommit = false;
        logger.info(`Branch ${branchName} is already up to date in ${projectPath}.`);
      }
    } catch (e) {
      logger.warn(`Could not parse sfdx-project.json from existing branch ${branchName}: ${(e as Error).message}`);
    }
  }

  if (branchNeedsCommit) {
    logger.info(`Committing updated sfdx-project.json to ${branchName} in ${projectPath}...`);
    const commitMessage = `chore: bump ${packageName} dependency to ${packageVersion}`;
    await vcsProvider.commitFile(project, branchName, commitMessage, 'sfdx-project.json', updateResult.newJsonContent);
  }

  const { changeRequest, changeRequestShort } = vcsProvider.terminology;

  logger.info(`Checking for existing open ${changeRequestShort} for branch ${branchName} in ${projectPath}...`);
  const existing = await vcsProvider.findOpenMergeRequest(project, branchName, defaultBranch);

  const title = `chore: bump ${packageName} to ${packageVersion}`;
  const description = generateMrDescription({
    packageName,
    oldVersions: updateResult.oldVersions,
    packageVersion,
    subscriberPackageVersionId: options.subscriberPackageVersionId,
    changeRequest,
  });
  const labels = splitLabels(options.changeRequestLabels);

  if (existing) {
    logger.info(
      `Found existing open ${changeRequestShort} for ${projectPath}: ${
        existing.webUrl ?? 'unknown URL'
      }. Updating title, description, and labels...`,
    );
    const updated = await vcsProvider.updateMergeRequest(project, existing, title, description, labels);
    logger.success(`Successfully updated ${changeRequest} in ${projectPath}: ${updated.webUrl ?? 'unknown URL'}`);
    counters.mergeRequestsAlreadyOpen++;
    counters.projectsUpdated++;
  } else {
    logger.info(`Creating new ${changeRequestShort} for branch ${branchName} in ${projectPath}...`);
    const created = await vcsProvider.createMergeRequest(
      project,
      branchName,
      defaultBranch,
      title,
      description,
      labels,
    );
    logger.success(`Successfully created ${changeRequest} in ${projectPath}: ${created.webUrl ?? 'unknown URL'}`);
    counters.mergeRequestsCreated++;
    counters.projectsUpdated++;
  }
}
