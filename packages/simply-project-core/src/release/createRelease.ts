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
import type { VcsProjectRef, VcsProvider } from '@simplysf/simply-core';
import { logger } from '../logger.js';
import {
  assertKnownRemote,
  assertValidMessage,
  assertWorkingTreeReady,
  commitWithHooks,
  fetchRemote,
  gitSucceeds,
  PROJECT_FILE,
  readProjectAt,
  restoreStart,
  runGit,
} from './git.js';
import { stringifyProject } from './projectIdentity.js';
import { bumpProjectVersion, hasVersion } from './projectVersion.js';
import {
  isValidIncrement,
  nextReleaseBranch,
  parseReleaseBranch,
  RELEASE_TYPES,
  type ReleaseBranch,
  type ReleaseType,
  sameReleaseVersion,
  sortReleaseBranches,
  versionNumberMatchesBranch,
} from './releaseBranches.js';
import { readReleasePluginConfig } from './releaseConfig.js';

type JsonObject = Record<string, unknown>;

/** Passes commitlint's conventional rules, without the `chore(release):` type and scope of a publish commit. */
const DEFAULT_MESSAGE = 'chore: bump version to {VERSION}';

export type { ReleaseType };

/** The platform client and the project it addresses, for the optional release and default-branch steps. */
export type CreateReleaseVcs = { provider: VcsProvider; project: VcsProjectRef };

export type CreateReleaseStatus = 'Created' | 'Would create' | 'Commit rejected' | 'Declined';

export type CreateReleaseResult = {
  /** The release branch cut from, e.g. `release/v1.2.0`. */
  source: string;
  /** The new release branch, e.g. `release/v1.3.0`. */
  branch: string;
  /** The new branch's version, e.g. `1.3.0`. */
  version: string;
  status: CreateReleaseStatus;
  /** The version-bump commit, once made. */
  commit?: string;
  /** The `package` of each directory whose `versionNumber` was bumped. */
  bumpedPackages: string[];
  /** The platform release for the source's version, when one was asked for. */
  release?: { tagName: string; name: string; status: 'Created' | 'Already exists' | 'Would create'; webUrl?: string };
  /** Whether the new branch became the project's default, when that was asked for. */
  defaultBranch?: { status: 'Set' | 'Would set' | 'Not set' };
  /** The hook's output, when `status` is `Commit rejected`. */
  commitError?: string;
};

export type CreateReleaseOptions = {
  type: ReleaseType;
  /**
   * How far `type`'s part of the version moves. Defaults to the source branch's
   * `plugins.simply.release.increments` in `sfdx-project.json`, else 1.
   */
  increment?: number;
  /** The release branch to cut from. Defaults to the current branch. */
  source?: string;
  packageReleaseBranchPrefix?: string;
  remote?: string;
  /** Commit message template, with an optional `{VERSION}` placeholder. */
  message?: string;
  /** Publish a platform release for the source's version before cutting. Needs `vcs`. */
  createRelease?: boolean;
  /** The tag to publish the release from. Implies `createRelease`. Defaults to the source version's latest build tag. */
  releaseTag?: string;
  /** Make the new branch the project's default after pushing. Needs `vcs`. */
  setDefault?: boolean;
  vcs?: CreateReleaseVcs;
  dryRun?: boolean;
  /** Asked once before anything is changed, with the planned result. */
  confirm?: (plan: CreateReleaseResult) => Promise<boolean>;
  cwd?: string;
};

type Plan = {
  cwd: string;
  remote: string;
  source: ReleaseBranch;
  target: ReleaseBranch;
  remoteSource: string;
  message: string;
  result: CreateReleaseResult;
};

/** `MAJOR.MINOR.PATCH` of a branch, reading a missing patch as 0. */
const versionOf = (branch: ReleaseBranch): string => `${branch.major}.${branch.minor}.${branch.patch ?? 0}`;

const lines = (output: string): string[] => output.split(/\r?\n/).filter(Boolean);

/** `releaseTag` implies `createRelease`. */
const wantsPlatformRelease = (options: CreateReleaseOptions): boolean =>
  Boolean(options.createRelease) || options.releaseTag !== undefined;

/** Checks every precondition that doesn't need git, so a bad call fails before anything runs. */
function assertOptions(options: CreateReleaseOptions, message: string): void {
  if (!RELEASE_TYPES.includes(options.type)) {
    throw new Error(`Invalid release type "${String(options.type)}". Use ${RELEASE_TYPES.join(', ')}.`);
  }
  assertValidMessage(message, ['{VERSION}']);
  if (options.increment !== undefined && !isValidIncrement(options.increment)) {
    throw new Error(
      `Invalid ${options.type} increment ${String(options.increment)}. Use a whole number of at least 1.`,
    );
  }

  const wantsRelease = wantsPlatformRelease(options);
  if ((wantsRelease || options.setDefault) && !options.vcs) {
    throw new Error('Creating a release or setting the default branch needs a VCS provider and project.');
  }
  const provider = options.vcs?.provider;
  if (wantsRelease && (!provider?.createRelease || !provider.findRelease)) {
    throw new Error(`The ${String(provider?.kind)} provider doesn't support creating releases.`);
  }
  if (options.setDefault && !provider?.setDefaultBranch) {
    throw new Error(`The ${String(provider?.kind)} provider doesn't support setting the default branch.`);
  }
}

const onRemote = (cwd: string, remote: string, branch: ReleaseBranch): Promise<boolean> =>
  gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/remotes/${remote}/${branch.name}`]);

/**
 * The remote release branch whose tip is `HEAD`'s parent. After a rejected commit, the lead commits on
 * the new, unpushed branch and re-runs from there, so this finds the branch it was cut from.
 */
async function sourceOfUnpushedBranch(cwd: string, remote: string, prefix: string): Promise<ReleaseBranch | undefined> {
  if (!(await gitSucceeds(cwd, ['rev-parse', '-q', '--verify', 'HEAD^']))) {
    return undefined;
  }
  const names = lines(
    await runGit(cwd, [
      'for-each-ref',
      '--points-at',
      'HEAD^',
      '--format=%(refname:strip=3)',
      `refs/remotes/${remote}/`,
    ]),
  );
  const candidates = names
    .map((name) => parseReleaseBranch(name, prefix))
    .filter((branch): branch is ReleaseBranch => branch !== undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The branch to cut from, and the unpushed branch being resumed when it was inferred from one. */
async function resolveSource(
  cwd: string,
  remote: string,
  prefix: string,
  name?: string,
): Promise<{ source: ReleaseBranch; resuming?: ReleaseBranch }> {
  const sourceName = name ?? (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']));
  const source = parseReleaseBranch(sourceName, prefix);
  if (!source) {
    throw new Error(
      name === undefined
        ? `The current branch, ${sourceName}, isn't a release branch named ${prefix}[v]MAJOR.MINOR[.PATCH]. Switch to one, or pass --source.`
        : `${sourceName} isn't a release branch named ${prefix}[v]MAJOR.MINOR[.PATCH].`,
    );
  }
  if (await onRemote(cwd, remote, source)) {
    return { source };
  }
  const inferred = name === undefined ? await sourceOfUnpushedBranch(cwd, remote, prefix) : undefined;
  if (!inferred) {
    throw new Error(`${source.name} doesn't exist on ${remote}. Push it first.`);
  }
  logger.info(`${source.name} isn't on ${remote} yet, so this finishes cutting it from ${inferred.name}.`);
  return { source: inferred, resuming: source };
}

async function assertSourceVersion(cwd: string, remoteSource: string, source: ReleaseBranch): Promise<JsonObject> {
  const project = JSON.parse(await readProjectAt(cwd, remoteSource)) as JsonObject;
  const directories = Array.isArray(project.packageDirectories) ? (project.packageDirectories as JsonObject[]) : [];
  const versionNumber = directories.find((directory) => directory.default)?.versionNumber;
  if (typeof versionNumber !== 'string' || !versionNumberMatchesBranch(versionNumber, source)) {
    throw new Error(
      `${source.name} declares versionNumber ${typeof versionNumber === 'string' ? versionNumber : '(none)'} in ${PROJECT_FILE}, which doesn't match its name.`,
    );
  }
  return project;
}

/** Refuses a version that already has a branch, under any label shape (`release/1.3` and `release/v1.3.0`). */
async function assertTargetFree(cwd: string, remote: string, prefix: string, target: ReleaseBranch): Promise<void> {
  const names = lines(await runGit(cwd, ['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${remote}/`]));
  const clash = sortReleaseBranches(names, prefix).find((branch) => sameReleaseVersion(branch, target));
  if (clash) {
    throw new Error(`${clash.name} already exists on ${remote}, so ${target.name} has already been cut.`);
  }
}

/** The tags on the remote matching `pattern`, since the platform publishes a release from its own copy. */
async function remoteTags(cwd: string, remote: string, pattern: string): Promise<Set<string>> {
  const output = await runGit(cwd, ['ls-remote', '--tags', '--refs', '--', remote, `refs/tags/${pattern}`]);
  return new Set(lines(output).map((line) => line.split('\t')[1].replace(/^refs\/tags\//, '')));
}

/**
 * The tag to publish from: the highest `v<version>.<build>` that is reachable from the source and on
 * the remote. Fallback and feature-suffixed tags are skipped, so a release is never published from a
 * fallback build, and an unpushed local tag can't be picked.
 */
async function pickReleaseTag(plan: Plan, explicit?: string): Promise<string> {
  const { cwd, remote, source, remoteSource } = plan;
  if (explicit !== undefined) {
    if (!(await remoteTags(cwd, remote, explicit)).has(explicit)) {
      throw new Error(`Tag ${explicit} doesn't exist on ${remote}. Push it, or pass a tag that does.`);
    }
    return explicit;
  }
  const version = versionOf(source);
  const buildTag = new RegExp(`^v${version.replaceAll('.', '\\.')}\\.\\d+$`);
  const pushed = await remoteTags(cwd, remote, `v${version}.*`);
  const merged = await runGit(cwd, ['tag', '--merged', remoteSource, '--sort=v:refname', '--list', `v${version}.*`]);
  const tag = lines(merged)
    .filter((name) => buildTag.test(name) && pushed.has(name))
    .at(-1);
  if (!tag) {
    throw new Error(
      `No v${version}.<build> tag on ${remote} is reachable from ${source.name}, so there is no build to release.`,
    );
  }
  return tag;
}

/** Publishes the release, or reports the one already there, so a re-run doesn't fail. */
async function publishRelease(
  vcs: CreateReleaseVcs,
  release: NonNullable<CreateReleaseResult['release']>,
): Promise<void> {
  const { provider, project } = vcs;
  // Both methods were checked to exist in `assertOptions`.
  const existing = await provider.findRelease?.(project, release.tagName);
  if (existing) {
    Object.assign(release, { status: 'Already exists', webUrl: existing.webUrl });
    return;
  }
  const created = await provider.createRelease?.(project, { tagName: release.tagName, name: release.name });
  Object.assign(release, { status: 'Created', webUrl: created?.webUrl });
}

/**
 * Whether a local branch with the target's name holds a finished bump from an earlier run: exactly one
 * commit on top of the remote's source, carrying the new version. Anything else is the lead's to clear.
 */
async function resumable(plan: Plan): Promise<boolean> {
  const { cwd, target, remoteSource } = plan;
  if (!(await gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${target.name}`]))) {
    return false;
  }
  const ahead = await gitSucceeds(cwd, ['merge-base', '--is-ancestor', remoteSource, target.name]);
  const count = ahead ? await runGit(cwd, ['rev-list', '--count', `${remoteSource}..${target.name}`]) : '';
  const bumped = count === '1' && hasVersion(JSON.parse(await readProjectAt(cwd, target.name)) as JsonObject, target);
  if (!bumped) {
    throw new Error(
      `A local ${target.name} already exists, but it isn't one version-bump commit on top of ${remoteSource}. Delete it with \`git branch -D ${target.name}\` and re-run this command.`,
    );
  }
  return true;
}

/** Creates the branch from the remote's source and commits the bump. Returns the hook's output if it rejected the commit. */
async function cutBranch(plan: Plan, project: JsonObject): Promise<string | undefined> {
  const { cwd, source, target, remoteSource, result } = plan;
  await runGit(cwd, ['switch', '--no-track', '-c', target.name, remoteSource]);

  const filePath = path.join(cwd, PROJECT_FILE);
  const originalText = await fs.readFile(filePath, 'utf8');
  const bump = bumpProjectVersion(project, source, target);
  for (const name of bump.versionNameUnchanged) {
    logger.warn(`${name}'s versionName doesn't contain ${versionOf(source)}, so it was left as is.`);
  }
  await fs.writeFile(filePath, stringifyProject(bump.project, originalText));
  await runGit(cwd, ['add', '--', PROJECT_FILE]);

  const commitMessage = plan.message.replaceAll('{VERSION}', () => result.version);
  const commitError = await commitWithHooks(cwd, commitMessage);
  if (commitError === undefined && !hasVersion(JSON.parse(await readProjectAt(cwd, 'HEAD')) as JsonObject, target)) {
    throw new Error(
      `A commit hook changed ${PROJECT_FILE} so that it no longer declares ${versionOf(target)}, so nothing was pushed. Fix the hook, delete ${target.name} with \`git switch ${source.name} && git branch -D ${target.name}\`, and re-run this command.`,
    );
  }
  return commitError;
}

async function buildPlan(options: CreateReleaseOptions, message: string): Promise<{ plan: Plan; project: JsonObject }> {
  const remote = options.remote ?? 'origin';
  const prefix = options.packageReleaseBranchPrefix ?? 'release/';
  const cwd = await runGit(options.cwd ?? process.cwd(), ['rev-parse', '--show-toplevel']);

  await assertKnownRemote(cwd, remote);
  await assertWorkingTreeReady(cwd);
  await fetchRemote(cwd, remote);

  const { source, resuming } = await resolveSource(cwd, remote, prefix, options.source);
  const remoteSource = `${remote}/${source.name}`;
  const project = await assertSourceVersion(cwd, remoteSource, source);
  const increment = options.increment ?? readReleasePluginConfig(project, remoteSource).increments?.[options.type] ?? 1;
  const target = nextReleaseBranch(source, options.type, prefix, increment);
  if (resuming && resuming.name !== target.name) {
    throw new Error(
      `${resuming.name} was cut from ${source.name}, but a ${options.type} release of it with an increment of ${increment} is ${target.name}. Re-run with the release type and increment that name ${resuming.name}.`,
    );
  }
  await assertTargetFree(cwd, remote, prefix, target);

  const bumpedPackages = bumpProjectVersion(project, source, target).bumped;
  if (bumpedPackages.length === 0) {
    throw new Error(`No package directory in ${PROJECT_FILE} declares ${source.name}'s version.`);
  }

  const result: CreateReleaseResult = {
    source: source.name,
    branch: target.name,
    version: versionOf(target),
    status: 'Would create',
    bumpedPackages,
  };
  const plan: Plan = { cwd, remote, source, target, remoteSource, message, result };

  if (wantsPlatformRelease(options)) {
    const tagName = await pickReleaseTag(plan, options.releaseTag);
    result.release = { tagName, name: source.label, status: 'Would create' };
  }
  if (options.setDefault) {
    result.defaultBranch = { status: 'Would set' };
  }
  return { plan, project };
}

/**
 * Cuts the next release branch from a release branch: bumps its version in `sfdx-project.json`,
 * commits with the repository's hooks, and pushes it without force. It can also publish a platform
 * release for the version being closed out, and make the new branch the project's default.
 */
export async function createRelease(options: CreateReleaseOptions): Promise<CreateReleaseResult> {
  const message = options.message ?? DEFAULT_MESSAGE;
  assertOptions(options, message);
  const { plan, project } = await buildPlan(options, message);
  const { cwd, remote, target, result } = plan;
  // Checked before anything is published, since a stale local branch must stop the run.
  const resume = await resumable(plan);

  if (options.dryRun) {
    return result;
  }
  if (options.confirm && !(await options.confirm(structuredClone(result)))) {
    return { ...result, status: 'Declined' };
  }

  const vcs = options.vcs;
  if (result.release && vcs) {
    await publishRelease(vcs, result.release);
  }

  const startBranch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const startCommit = await runGit(cwd, ['rev-parse', 'HEAD']);

  if (resume) {
    await runGit(cwd, ['switch', target.name]);
  } else {
    const commitError = await cutBranch(plan, project);
    if (commitError !== undefined) {
      logger.warn(
        `A hook rejected the commit on ${target.name}, and the version bump is still staged. Run \`git commit\` with a message your repository accepts, then re-run this command from that branch.\n${commitError}`,
      );
      return {
        ...result,
        status: 'Commit rejected',
        commitError,
        ...(result.defaultBranch ? { defaultBranch: { status: 'Not set' } } : {}),
      };
    }
  }
  result.commit = await runGit(cwd, ['rev-parse', 'HEAD']);

  await runGit(cwd, ['push', '--set-upstream', '--', remote, `${target.name}:refs/heads/${target.name}`]);
  result.status = 'Created';

  if (result.defaultBranch && vcs) {
    await vcs.provider.setDefaultBranch?.(vcs.project, target.name);
    result.defaultBranch = { status: 'Set' };
  }

  await restoreStart(cwd, startBranch, startCommit);
  return result;
}
