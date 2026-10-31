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

/* eslint-disable no-await-in-loop -- hops run strictly in order, since each merge feeds the next */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { logger } from '../logger.js';
import {
  defaultVersionNumber,
  identityMismatches,
  stringifyProject,
  unionAliases,
  withTargetIdentity,
} from './projectIdentity.js';
import {
  type ReleaseBranch,
  type ReleaseBranchPair,
  selectReleasePairs,
  sortReleaseBranches,
  versionNumberMatchesBranch,
} from './releaseBranches.js';

const PROJECT_FILE = 'sfdx-project.json';

type JsonObject = Record<string, unknown>;

export type RollForwardHopStatus =
  'Rolled' | 'Up to date' | 'Conflict' | 'Merged, not pushed' | 'Would roll' | 'Not started';

export type RollForwardHop = {
  source: string;
  target: string;
  status: RollForwardHopStatus;
  /** The working branch the merge happens on. */
  rollBranch: string;
  /** Tags on the source that aren't yet in the target's history. */
  tags: string[];
  mergeCommit?: string;
  /** Files needing the lead's attention, when `status` is `Conflict`. */
  conflictedFiles?: string[];
};

export type RollForwardResult = {
  hops: RollForwardHop[];
  /** True when the `confirm` callback declined, so nothing was changed. */
  declined: boolean;
};

export type RollForwardOptions = {
  /** Oldest release branch to roll from. Defaults to the lowest with work to roll. */
  source?: string;
  /** Newest release branch to roll into. Defaults to the highest. */
  target?: string;
  packageReleaseBranchPrefix?: string;
  remote?: string;
  dryRun?: boolean;
  /** Stop after the merge, leaving the roll branch for a merge request. */
  noPush?: boolean;
  /** Asked once before anything is changed, with the hops that will be rolled. */
  confirm?: (hops: RollForwardHop[]) => Promise<boolean>;
  cwd?: string;
};

type Hop = RollForwardHop & { pair: ReleaseBranchPair; remoteSource: string; remoteTarget: string };

/** Runs git without prompting, so a missing credential fails instead of waiting on a hidden prompt. */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  const { exitCode } = await execa('git', args, { cwd, reject: false, env: { GIT_TERMINAL_PROMPT: '0' } });
  return exitCode === 0;
}

async function readProjectAt(cwd: string, ref: string): Promise<string> {
  const { stdout } = await execa('git', ['show', `${ref}:${PROJECT_FILE}`], { cwd, stripFinalNewline: false });
  return stdout;
}

const unfinishedMergeMessage = (rollBranch: string): string =>
  `A merge is still in progress on ${rollBranch}. Resolve the conflicts and run \`git commit\`, then re-run this command, or run \`git merge --abort\` to give up on it.`;

async function assertWorkingTreeReady(cwd: string): Promise<void> {
  if ((await runGit(cwd, ['rev-parse', '--is-shallow-repository'])) === 'true') {
    throw new Error('This is a shallow clone, so its tag history is incomplete. Run `git fetch --unshallow` first.');
  }
  if (await gitSucceeds(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) {
    throw new Error(unfinishedMergeMessage(await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])));
  }
  if (await runGit(cwd, ['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('The working tree has uncommitted changes. Commit or stash them first.');
  }
}

async function listReleaseBranches(cwd: string, remote: string, prefix: string): Promise<ReleaseBranch[]> {
  const output = await runGit(cwd, ['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${remote}/`]);
  return sortReleaseBranches(output.split(/\r?\n/).filter(Boolean), prefix);
}

/** Refuses a branch whose `versionNumber` disagrees with its name, since the plan would be built on a wrong assumption. */
async function assertVersionMatchesName(cwd: string, remote: string, branch: ReleaseBranch): Promise<void> {
  const ref = `${remote}/${branch.name}`;
  const versionNumber = defaultVersionNumber(JSON.parse(await readProjectAt(cwd, ref)) as JsonObject);
  if (!versionNumber || !versionNumberMatchesBranch(versionNumber, branch)) {
    throw new Error(
      `${branch.name} declares versionNumber ${versionNumber ?? '(none)'} in ${PROJECT_FILE}, which doesn't match its name.`,
    );
  }
}

/** Plans every hop. Once one hop is needed, all later ones are too, because the merge changes their source. */
async function planHops(cwd: string, remote: string, pairs: ReleaseBranchPair[], prefix: string): Promise<Hop[]> {
  const hops: Hop[] = [];
  let needed = false;
  for (const pair of pairs) {
    const remoteSource = `${remote}/${pair.source.name}`;
    const remoteTarget = `${remote}/${pair.target.name}`;
    needed = needed || !(await gitSucceeds(cwd, ['merge-base', '--is-ancestor', remoteSource, remoteTarget]));

    const rollBranch = `roll-forward/${pair.source.label}-to-${pair.target.label}`;
    if (rollBranch.includes(prefix)) {
      throw new Error(
        `The working branch ${rollBranch} contains "${prefix}", so the pipeline would treat it as a release branch.`,
      );
    }
    const tags = needed
      ? (await runGit(cwd, ['tag', '--merged', remoteSource, '--no-merged', remoteTarget]))
          .split(/\r?\n/)
          .filter(Boolean)
      : [];
    hops.push({
      pair,
      remoteSource,
      remoteTarget,
      source: pair.source.name,
      target: pair.target.name,
      rollBranch,
      tags,
      status: needed ? 'Not started' : 'Up to date',
    });
  }
  return hops;
}

/** Runs `git merge-file` on temporary copies, returning the merged text and whether it conflicted. */
async function mergeText(ours: string, base: string, theirs: string): Promise<{ text: string; conflicted: boolean }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-roll-forward-'));
  try {
    const [oursFile, baseFile, theirsFile] = ['ours', 'base', 'theirs'].map((name) => path.join(directory, name));
    await Promise.all([fs.writeFile(oursFile, ours), fs.writeFile(baseFile, base), fs.writeFile(theirsFile, theirs)]);
    const { stdout, exitCode } = await execa(
      'git',
      ['merge-file', '-p', '-L', 'target', '-L', 'base', '-L', 'source', oursFile, baseFile, theirsFile],
      { reject: false, stripFinalNewline: false },
    );
    if (exitCode === undefined || exitCode < 0 || exitCode > 127) {
      throw new Error(`git merge-file failed on ${PROJECT_FILE}.`);
    }
    return { text: stdout, conflicted: exitCode !== 0 };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/**
 * Keeps the target's identity in the merged `sfdx-project.json`. For a conflict, each side is first
 * rewritten to carry the target's identity and the union of aliases, so a text merge only sees the
 * differences that are really the lead's to decide. Returns whether the file still conflicts.
 */
async function resolveProjectFile(cwd: string, hop: Hop, conflicted: boolean): Promise<boolean> {
  const filePath = path.join(cwd, PROJECT_FILE);
  const oursText = await readProjectAt(cwd, hop.remoteTarget);
  const ours = JSON.parse(oursText) as JsonObject;
  const theirs = JSON.parse(await readProjectAt(cwd, hop.remoteSource)) as JsonObject;
  const aliases = unionAliases(ours, theirs);
  const normalize = (project: JsonObject): string =>
    stringifyProject(withTargetIdentity(project, ours, aliases), oursText);

  if (!conflicted) {
    const merged = JSON.parse(await fs.readFile(filePath, 'utf8')) as JsonObject;
    const resolved = withTargetIdentity(merged, ours, aliases);
    if (JSON.stringify(resolved) !== JSON.stringify(merged)) {
      await fs.writeFile(filePath, stringifyProject(resolved, oursText));
      await runGit(cwd, ['add', PROJECT_FILE]);
    }
    return false;
  }

  const { stdout: baseText, exitCode } = await execa('git', ['show', `:1:${PROJECT_FILE}`], {
    cwd,
    reject: false,
    stripFinalNewline: false,
  });
  if (exitCode !== 0) {
    return true;
  }
  const { text, conflicted: stillConflicted } = await mergeText(
    normalize(ours),
    normalize(JSON.parse(baseText) as JsonObject),
    normalize(theirs),
  );
  await fs.writeFile(filePath, text);
  if (!stillConflicted) {
    await runGit(cwd, ['add', PROJECT_FILE]);
  }
  return stillConflicted;
}

/** Merges on a new roll branch. Returns the files the lead must resolve, or an empty list once committed. */
async function mergeHop(cwd: string, hop: Hop): Promise<string[]> {
  await runGit(cwd, ['switch', '--no-track', '-c', hop.rollBranch, hop.remoteTarget]);
  const merge = await execa('git', ['merge', '--no-ff', '--no-commit', hop.remoteSource], { cwd, reject: false });

  const unmerged = (await runGit(cwd, ['diff', '--name-only', '--diff-filter=U'])).split(/\r?\n/).filter(Boolean);
  if (merge.exitCode !== 0 && unmerged.length === 0) {
    throw new Error(`Merging ${hop.source} into ${hop.target} failed: ${merge.stderr}`);
  }

  const projectConflicted = await resolveProjectFile(cwd, hop, unmerged.includes(PROJECT_FILE));
  const remaining = unmerged.filter((file) => file !== PROJECT_FILE);
  if (projectConflicted) {
    remaining.unshift(PROJECT_FILE);
  }
  if (remaining.length > 0) {
    return remaining;
  }
  await runGit(cwd, ['commit', '-m', `chore(release): roll ${hop.source} forward into ${hop.target}`]);
  return [];
}

/** Confirms a finished merge really has the promised shape before it can be pushed. */
async function verifyMerge(cwd: string, hop: Hop): Promise<void> {
  const firstParent = await runGit(cwd, ['rev-parse', 'HEAD^1']);
  if (firstParent !== (await runGit(cwd, ['rev-parse', hop.remoteTarget]))) {
    throw new Error(`${hop.rollBranch}'s first parent isn't ${hop.target}'s current tip.`);
  }
  if (!(await gitSucceeds(cwd, ['merge-base', '--is-ancestor', hop.remoteSource, 'HEAD']))) {
    throw new Error(`${hop.rollBranch} doesn't contain ${hop.source}'s current tip.`);
  }
  const mismatches = identityMismatches(
    JSON.parse(await readProjectAt(cwd, 'HEAD')) as JsonObject,
    JSON.parse(await readProjectAt(cwd, hop.remoteTarget)) as JsonObject,
  );
  if (mismatches.length > 0) {
    throw new Error(`${hop.rollBranch} changes ${hop.target}'s package identity: ${mismatches.join(', ')}.`);
  }
}

/** Whether an existing roll branch holds a finished merge of the current source and target tips. */
async function holdsFinishedMerge(cwd: string, hop: Hop): Promise<boolean> {
  return (
    (await gitSucceeds(cwd, ['merge-base', '--is-ancestor', hop.remoteSource, hop.rollBranch])) &&
    (await gitSucceeds(cwd, ['merge-base', '--is-ancestor', hop.remoteTarget, hop.rollBranch]))
  );
}

async function pushHop(cwd: string, remote: string, hop: Hop): Promise<void> {
  await runGit(cwd, ['push', remote, `HEAD:refs/heads/${hop.target}`]);
  await runGit(cwd, ['fetch', remote, `+refs/heads/${hop.target}:refs/remotes/${remote}/${hop.target}`]);
}

async function leaveRollBranch(cwd: string, hop: Hop, returnTo: string): Promise<void> {
  await runGit(cwd, ['switch', '--detach', returnTo]);
  await runGit(cwd, ['branch', '-D', hop.rollBranch]);
}

/** Runs one hop. Returns false when the chain must stop here. */
async function runHop(cwd: string, remote: string, hop: Hop, noPush: boolean | undefined): Promise<boolean> {
  const resumed = await gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${hop.rollBranch}`]);
  if (resumed) {
    if (!(await holdsFinishedMerge(cwd, hop))) {
      throw new Error(
        `${hop.rollBranch} already exists but doesn't include the latest ${hop.source} and ${hop.target}. Delete it with \`git branch -D ${hop.rollBranch}\` and re-run this command.`,
      );
    }
    await runGit(cwd, ['switch', hop.rollBranch]);
  } else {
    const conflictedFiles = await mergeHop(cwd, hop);
    if (conflictedFiles.length > 0) {
      Object.assign(hop, { status: 'Conflict', conflictedFiles });
      logger.warn(`${unfinishedMergeMessage(hop.rollBranch)} Conflicted: ${conflictedFiles.join(', ')}`);
      return false;
    }
  }

  await verifyMerge(cwd, hop);
  hop.mergeCommit = await runGit(cwd, ['rev-parse', 'HEAD']);

  if (noPush) {
    hop.status = 'Merged, not pushed';
    logger.info(
      `Open a merge request from ${hop.rollBranch} into ${hop.target}, and merge it with a merge commit. A squash or rebase loses the tag history.`,
    );
    return false;
  }

  try {
    await pushHop(cwd, remote, hop);
  } catch (error) {
    // A merge made by this run can simply be made again; one the lead resolved by hand is theirs to keep.
    if (!resumed) {
      await leaveRollBranch(cwd, hop, hop.remoteTarget);
    }
    throw new Error(
      `Pushing to ${hop.target} failed, likely because it moved. Re-run this command. ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }
  await leaveRollBranch(cwd, hop, hop.remoteTarget);
  hop.status = 'Rolled';
  return true;
}

const toResult = (hops: Hop[], declined = false): RollForwardResult => ({
  declined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped so the internal fields stay out of the result
  hops: hops.map(({ pair, remoteSource, remoteTarget, ...hop }) => hop),
});

/**
 * Merges each release branch into the next higher one with a real merge commit, so the source's
 * version tags stay in the target's history, while the target keeps its own package identity.
 */
export async function rollForward(options: RollForwardOptions = {}): Promise<RollForwardResult> {
  const remote = options.remote ?? 'origin';
  const prefix = options.packageReleaseBranchPrefix ?? 'release/';
  const cwd = await runGit(options.cwd ?? process.cwd(), ['rev-parse', '--show-toplevel']);

  await assertWorkingTreeReady(cwd);
  await runGit(cwd, ['fetch', remote, '--tags', '--prune', `+refs/heads/*:refs/remotes/${remote}/*`]);

  const branches = await listReleaseBranches(cwd, remote, prefix);
  const pairs = selectReleasePairs(branches, options.source, options.target);
  const hops = await planHops(cwd, remote, pairs, prefix);
  const pending = hops.filter((hop) => hop.status !== 'Up to date');

  const toCheck = new Map(
    pending.flatMap(({ pair }) => [pair.source, pair.target]).map((branch) => [branch.name, branch]),
  );
  await Promise.all([...toCheck.values()].map((branch) => assertVersionMatchesName(cwd, remote, branch)));

  if (options.dryRun) {
    pending.forEach((hop) => Object.assign(hop, { status: 'Would roll' }));
    return toResult(hops);
  }
  if (pending.length === 0) {
    return toResult(hops);
  }
  if (options.confirm && !(await options.confirm(toResult(pending).hops))) {
    return toResult(hops, true);
  }

  const startBranch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const startCommit = await runGit(cwd, ['rev-parse', 'HEAD']);

  for (const hop of pending) {
    if (!(await runHop(cwd, remote, hop, options.noPush))) {
      if (hop.status === 'Conflict') {
        return toResult(hops);
      }
      break;
    }
  }

  // Back where the lead started. A roll branch they re-ran from is gone, so its target stands in.
  const startBranchExists =
    startBranch !== 'HEAD' && (await gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${startBranch}`]));
  if (startBranchExists) {
    await runGit(cwd, ['switch', startBranch]);
  } else if (startBranch === 'HEAD') {
    await runGit(cwd, ['switch', '--detach', startCommit]);
  }
  return toResult(hops);
}
