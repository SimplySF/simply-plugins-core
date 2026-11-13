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
import { createVcsProvider, loadSfDevRc, resolveVcsSettings, type VcsProviderKind } from '@simplysf/simply-core';
import type { VcsProjectRef, VcsProvider } from '../vcs/index.js';
import { determineDeployConfigFile } from '../deploy/deployCommon.js';
import {
  assertCleanWorkingTree,
  assertKnownRemote,
  assertNoLocalOnlyBranch,
  assertValidBranchName,
  checkOutExisting,
  existingCheckoutWarning,
  fetchRemote,
  fileExistsAt,
  readFileAt,
  remoteBranchExists,
  repositoryRoot,
  runGit,
} from './branches.js';
import { loadReleaseConfig, type HappySoupReleaseConfig } from './releaseConfig.js';

const DEFAULT_MESSAGE = 'chore: set up release {DATE}';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Where a release's manual deployment steps live. */
export const deploymentStepsFile = (date: string): string => `deployment-steps/${date}.md`;

/** The VCS project to open the draft merge request in. */
export type HappySoupReleaseVcs = { provider: VcsProvider; project: VcsProjectRef };

export type CreateReleaseBranchStatus = 'Created' | 'Would create' | 'Already exists';

export type CreateReleaseBranchMergeRequest = {
  status: 'Created' | 'Would create' | 'Already open';
  title: string;
  target: string;
  iid?: number;
  webUrl?: string;
};

export type CreateReleaseBranchResult = {
  /** `release/<date>`. */
  branch: string;
  /** The branch it was cut from, and the merge request's target. */
  base: string;
  status: CreateReleaseBranchStatus;
  /** The commit that added the template files, when one was made. */
  commit?: string;
  /** The files copied from templates (or that would be), relative to the repository root. */
  files: string[];
  /** Templates that don't exist on the base branch, so weren't copied. */
  skippedTemplates: string[];
  /** Whether the branch was pushed (or would be). */
  pushed: boolean;
  mergeRequest?: CreateReleaseBranchMergeRequest;
  /** Things worth telling the user that didn't stop the run. */
  warnings: string[];
};

export type CreateReleaseBranchOptions = {
  /** The release date, `YYYY-MM-DD`. */
  date: string;
  /** Defaults to the configuration's `productionBranch`. */
  baseBranch?: string;
  /** Defaults to loading `config/release.json` (see `loadReleaseConfig`). */
  config?: HappySoupReleaseConfig;
  /** Read when `config` isn't given. */
  configPath?: string;
  remote?: string;
  /** Commit message template, with an optional `{DATE}` placeholder. */
  message?: string;
  /** Push the new branch. Defaults to `true`; without a push there is no merge request. */
  push?: boolean;
  /** Open a draft merge request into the base branch. Defaults to `true`; needs `vcs`. */
  mergeRequest?: boolean;
  vcs?: HappySoupReleaseVcs;
  dryRun?: boolean;
  /** Any directory inside the repository. Defaults to `process.cwd()`. */
  cwd?: string;
};

/**
 * Refuses anything but a real calendar date in `YYYY-MM-DD` form.
 *
 * @throws {Error} For `2026-1-9`, `2026-02-30`, and the like.
 */
export function assertReleaseDate(date: string): void {
  const match = DATE_PATTERN.exec(date);
  const [year, month, day] = (match ?? []).slice(1).map(Number);
  // Date.UTC rolls an impossible day over (2026-02-30 becomes March 2), so a round trip catches it.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const valid =
    match !== null &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!valid) {
    throw new Error(`Invalid release date "${date}". Use a real date in YYYY-MM-DD form, such as 2026-10-19.`);
  }
}

function assertValidMessage(message: string): void {
  if (!message.trim()) {
    throw new Error('The commit message is empty.');
  }
  const unknown = (message.match(/\{[^{}]*\}/g) ?? []).filter((token) => token !== '{DATE}');
  if (unknown.length > 0) {
    throw new Error(`The commit message has unknown placeholders: ${unknown.join(', ')}. Use {DATE}.`);
  }
}

export type ResolveHappySoupVcsOptions = {
  /** Explicit values, usually flags, which win over `SIMPLY_VCS_*` and `.sfdevrc.json`. */
  provider?: VcsProviderKind;
  host?: string;
  projectId?: string;
  /** The API token. Never read from `.sfdevrc.json`, which is committed. */
  token?: string;
  /** The directory holding `.sfdevrc.json`, usually the repository root. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
};

/**
 * Builds the provider for the release's draft merge request from flags, `SIMPLY_VCS_*`, and
 * `.sfdevrc.json` (including its deprecated `gitlabProjectId`), failing up front on a missing project
 * ID or token, before anything changes.
 */
export function resolveHappySoupVcs(options: ResolveHappySoupVcsOptions = {}): HappySoupReleaseVcs {
  const { config } = loadSfDevRc({ cwd: options.cwd, env: options.env, warn: options.warn });
  const { kind, host, projectId } = resolveVcsSettings(config, {
    provider: options.provider,
    host: options.host,
    projectId: options.projectId,
  });
  const optOut = 'or pass --no-merge-request to skip the merge request';
  if (!projectId) {
    throw new Error(
      `A VCS project ID is needed for the merge request. Pass --vcs-project-id, set SIMPLY_VCS_PROJECT_ID, or set vcs.projectId in .sfdevrc.json, ${optOut}.`,
    );
  }
  if (!options.token) {
    throw new Error(
      `A VCS API token is needed for the merge request. Pass --vcs-token or set SIMPLY_VCS_TOKEN, ${optOut}.`,
    );
  }
  return { provider: createVcsProvider(kind, { host, token: options.token }), project: projectId };
}

const mergeRequestTitle = (date: string): string => `Release ${date}`;

function mergeRequestDescription(date: string, files: string[]): string {
  const lines = [`Release ${date}, opened by \`sf simply cicd happy-soup release create\`.`];
  if (files.length > 0) {
    lines.push('', 'Set up from templates:', ...files.map((file) => `- \`${file}\``));
  }
  return lines.join('\n');
}

/** Opens the draft merge request, or reports the open one already there, so a re-run doesn't duplicate it. */
async function openMergeRequest(
  vcs: HappySoupReleaseVcs,
  branch: string,
  base: string,
  date: string,
  files: string[],
): Promise<CreateReleaseBranchMergeRequest> {
  const title = mergeRequestTitle(date);
  const existing = await vcs.provider.findOpenMergeRequest(vcs.project, branch, base);
  if (existing) {
    return { status: 'Already open', title: existing.title, target: base, iid: existing.iid, webUrl: existing.webUrl };
  }
  const created = await vcs.provider.createMergeRequest(
    vcs.project,
    branch,
    base,
    title,
    mergeRequestDescription(date, files),
    undefined,
    // Keep the release branch after it merges, as the original script's merge request did: it's the
    // release's record, and GitLab would otherwise delete it by default.
    { draft: true, removeSourceBranch: false },
  );
  return { status: 'Created', title: created.title, target: base, iid: created.iid, webUrl: created.webUrl };
}

type TemplateCopy = { template: string; destination: string };

type CopyPlan = { copies: TemplateCopy[]; skippedTemplates: string[]; warnings: string[] };

/** Decides which templates to copy, against the remote's base, which the new branch starts from. */
async function planCopies(
  cwd: string,
  remoteBase: string,
  base: string,
  config: HappySoupReleaseConfig,
  date: string,
): Promise<CopyPlan> {
  const candidates: TemplateCopy[] = [
    { template: config.deploymentStepsTemplate, destination: deploymentStepsFile(date) },
    // The deploy stages derive the same path from the branch name, so they find this file.
    { template: config.deploymentConfigsTemplate, destination: determineDeployConfigFile(`release/${date}`)! },
  ];
  const checked = await Promise.all(
    candidates.map(async (copy) => ({
      ...copy,
      templateExists: await fileExistsAt(cwd, remoteBase, copy.template),
      destinationExists: await fileExistsAt(cwd, remoteBase, copy.destination),
    })),
  );
  return {
    copies: checked
      .filter((copy) => copy.templateExists && !copy.destinationExists)
      .map(({ template, destination }) => ({ template, destination })),
    skippedTemplates: checked.filter((copy) => !copy.templateExists).map((copy) => copy.template),
    warnings: checked
      .filter((copy) => copy.templateExists && copy.destinationExists)
      .map((copy) => `${copy.destination} already exists on ${base}, so it was left as it is.`),
  };
}

/** Writes each template's content from the remote base to its destination, and commits them all at once. */
async function commitCopies(
  cwd: string,
  remote: string,
  remoteBase: string,
  branch: string,
  copies: TemplateCopy[],
  message: string,
): Promise<string> {
  await Promise.all(
    copies.map(async ({ template, destination }) => {
      const target = path.join(cwd, destination);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await readFileAt(cwd, remoteBase, template));
    }),
  );
  await runGit(cwd, ['add', '--', ...copies.map(({ destination }) => destination)]);
  try {
    await runGit(cwd, ['commit', '-m', message]);
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    throw new Error(
      `A hook rejected the commit on ${branch}, and the template files are still staged. Run \`git commit\` with a message your repository accepts, then \`git push -u ${remote} ${branch}\`, and re-run this command to open the merge request.\n${output}`,
      { cause: error },
    );
  }
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

/** Checks out a release branch that's already on the remote, and opens its merge request if that's missing. */
async function finishExisting(
  cwd: string,
  remote: string,
  result: CreateReleaseBranchResult,
  options: CreateReleaseBranchOptions,
  wantsMergeRequest: boolean,
): Promise<CreateReleaseBranchResult> {
  result.status = 'Already exists';
  if (!options.dryRun) {
    const state = await checkOutExisting(cwd, remote, result.branch);
    const warning = existingCheckoutWarning(state, remote, result.branch);
    if (warning) result.warnings.push(warning);
  }
  if (wantsMergeRequest) {
    result.mergeRequest = options.dryRun
      ? { status: 'Would create', title: mergeRequestTitle(options.date), target: result.base }
      : await openMergeRequest(options.vcs!, result.branch, result.base, options.date, []);
  }
  return result;
}

/**
 * Opens a happy-soup release: cuts `release/<date>` from the remote's copy of the production branch,
 * commits the deployment steps and config files copied from their templates, pushes, and opens a
 * draft merge request back into the base branch.
 *
 * The config file goes where {@link determineDeployConfigFile} looks for the branch, so the deploy
 * stages find it. Templates are read from the base branch on the remote. Nothing is changed before
 * every check passes, and a dirty working tree is refused rather than overwritten.
 *
 * If `release/<date>` is already on the remote, it is checked out (see `checkOutExisting`), and the
 * merge request is opened if it's missing, so a re-run finishes a run that failed at that step.
 */
export async function createReleaseBranch(options: CreateReleaseBranchOptions): Promise<CreateReleaseBranchResult> {
  const message = options.message ?? DEFAULT_MESSAGE;
  const push = options.push ?? true;
  const wantsMergeRequest = push && (options.mergeRequest ?? true);
  assertReleaseDate(options.date);
  assertValidMessage(message);
  if (wantsMergeRequest && !options.vcs) {
    throw new Error('Opening the merge request needs a VCS provider and project.');
  }

  const cwd = await repositoryRoot(options.cwd ?? process.cwd());
  const config =
    options.config ??
    loadReleaseConfig({ cwd: options.cwd ?? cwd, configPath: options.configPath, stopAt: cwd }).config;
  const remote = options.remote ?? 'origin';
  const base = options.baseBranch ?? config.productionBranch;
  const branch = `release/${options.date}`;

  await assertValidBranchName(cwd, base, 'base branch');
  await assertValidBranchName(cwd, branch);
  await assertKnownRemote(cwd, remote);
  await assertCleanWorkingTree(cwd);
  await fetchRemote(cwd, remote);
  if (!(await remoteBranchExists(cwd, remote, base))) {
    throw new Error(`The base branch ${base} doesn't exist on ${remote}.`);
  }

  const result: CreateReleaseBranchResult = {
    branch,
    base,
    status: 'Would create',
    files: [],
    skippedTemplates: [],
    pushed: push,
    warnings: [],
  };
  if (await remoteBranchExists(cwd, remote, branch)) {
    return finishExisting(cwd, remote, result, options, wantsMergeRequest);
  }
  await assertNoLocalOnlyBranch(cwd, remote, branch);

  const remoteBase = `${remote}/${base}`;
  const plan = await planCopies(cwd, remoteBase, base, config, options.date);
  result.files = plan.copies.map(({ destination }) => destination);
  result.skippedTemplates = plan.skippedTemplates;
  result.warnings.push(...plan.warnings);

  if (options.dryRun) {
    if (wantsMergeRequest) {
      result.mergeRequest = { status: 'Would create', title: mergeRequestTitle(options.date), target: base };
    }
    return result;
  }

  await runGit(cwd, ['switch', '--no-track', '-c', branch, remoteBase]);
  result.status = 'Created';
  if (plan.copies.length > 0) {
    const commitMessage = message.replaceAll('{DATE}', options.date);
    result.commit = await commitCopies(cwd, remote, remoteBase, branch, plan.copies, commitMessage);
  }
  if (push) {
    await runGit(cwd, ['push', '-u', '--', remote, `refs/heads/${branch}:refs/heads/${branch}`]);
  }
  if (wantsMergeRequest) {
    result.mergeRequest = await openMergeRequest(options.vcs!, branch, base, options.date, result.files);
  }
  return result;
}
