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

import { execa } from 'execa';

// Git for the developer-run happy-soup commands. Every call passes an argument array, never a shell
// string, and nothing here forces a checkout, resets, or force-pushes.

/** Runs git without prompting, so a missing credential fails instead of waiting on a hidden prompt. */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}

export async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  const { exitCode } = await execa('git', args, { cwd, reject: false, env: { GIT_TERMINAL_PROMPT: '0' } });
  return exitCode === 0;
}

/** @returns The repository root that contains `cwd`. */
export async function repositoryRoot(cwd: string): Promise<string> {
  return runGit(cwd, ['rev-parse', '--show-toplevel']);
}

/** Only a configured remote is accepted, because git would run an option-like value such as `--upload-pack=...`. */
export async function assertKnownRemote(cwd: string, remote: string): Promise<void> {
  const remotes = (await runGit(cwd, ['remote'])).split(/\r?\n/);
  if (!remotes.includes(remote)) {
    throw new Error(`${remote} is not a configured remote of this repository.`);
  }
}

/** Refuses an unfinished merge or uncommitted changes to tracked files, which a branch switch could carry or lose. */
export async function assertCleanWorkingTree(cwd: string): Promise<void> {
  if (await gitSucceeds(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) {
    throw new Error('A merge is still in progress. Finish it with `git commit`, or run `git merge --abort`.');
  }
  if (await runGit(cwd, ['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('The working tree has uncommitted changes. Commit or stash them first.');
  }
}

/** Fetches the remote's branches into its remote-tracking refs, pruning deleted ones. Tags aren't needed here. */
export async function fetchRemote(cwd: string, remote: string): Promise<void> {
  await runGit(cwd, ['fetch', '--prune', '--', remote, `+refs/heads/*:refs/remotes/${remote}/*`]);
}

export const localBranchExists = (cwd: string, branch: string): Promise<boolean> =>
  gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${branch}`]);

/** Whether the last fetch saw `branch` on `remote`. */
export const remoteBranchExists = (cwd: string, remote: string, branch: string): Promise<boolean> =>
  gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/remotes/${remote}/${branch}`]);

/** Whether `path` exists at `ref`. */
export const fileExistsAt = (cwd: string, ref: string, filePath: string): Promise<boolean> =>
  gitSucceeds(cwd, ['cat-file', '-e', `${ref}:${filePath}`]);

/** The content of `path` at `ref`, byte for byte. */
export async function readFileAt(cwd: string, ref: string, filePath: string): Promise<string> {
  const { stdout } = await execa('git', ['show', `${ref}:${filePath}`], { cwd, stripFinalNewline: false });
  return stdout;
}

/**
 * Refuses a branch-name segment that isn't a single valid git ref component: empty, containing `/`
 * (which would add a level), or anything `git check-ref-format` rejects.
 */
export async function assertValidSegment(cwd: string, label: string, value: string): Promise<void> {
  if (!value.trim() || value.includes('/')) {
    throw new Error(`The ${label} "${value}" can't be used in a branch name: it must be non-empty and contain no "/".`);
  }
  await assertValidBranchName(cwd, value, label);
}

/** Refuses a name `git check-ref-format --branch` rejects, such as one with spaces, `..`, or `~^:?*[\`. */
export async function assertValidBranchName(cwd: string, name: string, label = 'branch name'): Promise<void> {
  if (name.startsWith('-') || !(await gitSucceeds(cwd, ['check-ref-format', '--branch', name]))) {
    throw new Error(`The ${label} "${name}" isn't a valid git branch name.`);
  }
}

/**
 * The remote's branches under any of `prefixes` (such as `environment/` and `release/`), from the
 * last fetch, sorted, with `first` moved to the front when present.
 */
export async function listRemoteBranches(
  cwd: string,
  remote: string,
  prefixes: string[],
  first?: string,
): Promise<string[]> {
  const output = await runGit(cwd, [
    'for-each-ref',
    '--format=%(refname)',
    ...prefixes.map((prefix) => `refs/remotes/${remote}/${prefix}`),
  ]);
  const trackingPrefix = `refs/remotes/${remote}/`;
  const branches = [
    ...new Set(
      output
        .split(/\r?\n/)
        .filter((ref) => ref.startsWith(trackingPrefix) && !ref.endsWith('/HEAD'))
        .map((ref) => ref.slice(trackingPrefix.length)),
    ),
  ].sort();
  return first && branches.includes(first) ? [first, ...branches.filter((branch) => branch !== first)] : branches;
}

/** What {@link checkOutExisting} did with a branch that already exists on the remote. */
export type ExistingCheckout = 'Created tracking branch' | 'Up to date' | 'Fast-forwarded' | 'Ahead' | 'Diverged';

/**
 * Checks out a branch that already exists on the remote: creates a local tracking branch if there is
 * none, fast-forwards a local copy that is only behind, and otherwise leaves the local copy as it is.
 */
export async function checkOutExisting(cwd: string, remote: string, branch: string): Promise<ExistingCheckout> {
  const remoteRef = `${remote}/${branch}`;
  if (!(await localBranchExists(cwd, branch))) {
    await runGit(cwd, ['switch', '--track', '-c', branch, remoteRef]);
    return 'Created tracking branch';
  }
  await runGit(cwd, ['switch', branch]);
  const local = await runGit(cwd, ['rev-parse', 'HEAD']);
  const upstream = await runGit(cwd, ['rev-parse', remoteRef]);
  if (local === upstream) {
    return 'Up to date';
  }
  if (await gitSucceeds(cwd, ['merge-base', '--is-ancestor', 'HEAD', remoteRef])) {
    await runGit(cwd, ['merge', '--ff-only', remoteRef]);
    return 'Fast-forwarded';
  }
  if (await gitSucceeds(cwd, ['merge-base', '--is-ancestor', remoteRef, 'HEAD'])) {
    return 'Ahead';
  }
  return 'Diverged';
}

/** A warning for a local copy {@link checkOutExisting} left alone, or `undefined`. */
export function existingCheckoutWarning(state: ExistingCheckout, remote: string, branch: string): string | undefined {
  if (state === 'Diverged') {
    return `Your local ${branch} has diverged from ${remote}/${branch}, so it was left as it is. Reconcile it with \`git pull\` or \`git rebase\`.`;
  }
  if (state === 'Ahead') {
    return `Your local ${branch} has commits that aren't on ${remote} yet.`;
  }
  return undefined;
}

/**
 * Refuses a local branch named `branch` that isn't on the remote, which a new branch would collide
 * with. Such a branch is usually a leftover from an earlier run with `--no-push` or a rejected commit.
 */
export async function assertNoLocalOnlyBranch(cwd: string, remote: string, branch: string): Promise<void> {
  if (await localBranchExists(cwd, branch)) {
    throw new Error(
      `A local ${branch} already exists but isn't on ${remote}. Push it with \`git push -u ${remote} ${branch}\` and re-run, or delete it with \`git branch -D ${branch}\`.`,
    );
  }
}
