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
import { logger } from '../logger.js';

export const PROJECT_FILE = 'sfdx-project.json';

/** Runs git without prompting, so a missing credential fails instead of waiting on a hidden prompt. */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}

export async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  const { exitCode } = await execa('git', args, { cwd, reject: false, env: { GIT_TERMINAL_PROMPT: '0' } });
  return exitCode === 0;
}

export async function readProjectAt(cwd: string, ref: string): Promise<string> {
  const { stdout } = await execa('git', ['show', `${ref}:${PROJECT_FILE}`], { cwd, stripFinalNewline: false });
  return stdout;
}

export const unfinishedMergeMessage = (branch: string): string =>
  `A merge is still in progress on ${branch}. Resolve the conflicts and run \`git commit\`, then re-run this command, or run \`git merge --abort\` to give up on it.`;

/** Only a configured remote is accepted, because git would run an option-like value such as `--upload-pack=...`. */
export async function assertKnownRemote(cwd: string, remote: string): Promise<void> {
  const remotes = (await runGit(cwd, ['remote'])).split(/\r?\n/);
  if (!remotes.includes(remote)) {
    throw new Error(`${remote} is not a configured remote of this repository.`);
  }
}

export async function assertWorkingTreeReady(cwd: string): Promise<void> {
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

/** Fetches the remote's branches into its remote-tracking refs, and its tags, pruning deleted ones. */
export async function fetchRemote(cwd: string, remote: string): Promise<void> {
  await runGit(cwd, ['fetch', '--tags', '--prune', '--', remote, `+refs/heads/*:refs/remotes/${remote}/*`]);
}

/** Refuses a blank message or a mistyped placeholder, which would otherwise end up in the commit. */
export function assertValidMessage(message: string, placeholders: string[]): void {
  if (!message.trim()) {
    throw new Error('The commit message is empty.');
  }
  const unknown = (message.match(/\{[^{}]*\}/g) ?? []).filter((token) => !placeholders.includes(token));
  if (unknown.length > 0) {
    throw new Error(
      `The commit message has unknown placeholders: ${unknown.join(', ')}. Use ${placeholders.join(' and ')}.`,
    );
  }
}

/**
 * Switches back to where the lead started: their branch if it still exists, else the commit they were on.
 * It runs after the work is pushed, so a failed switch is logged as a warning instead of failing the run.
 *
 * @returns `false` if the switch failed.
 */
export async function restoreStart(cwd: string, startBranch: string, startCommit: string): Promise<boolean> {
  let args: string[];
  if (startBranch === 'HEAD') {
    args = ['switch', '--detach', startCommit];
  } else if (await gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${startBranch}`])) {
    args = ['switch', startBranch];
  } else {
    return true;
  }
  const { exitCode, stderr } = await execa('git', args, { cwd, reject: false });
  if (exitCode === 0) {
    return true;
  }
  logger.warn(
    `Everything was pushed, but switching back failed. Check \`git status\`, then run \`git ${args.join(' ')}\`.\n${stderr}`,
  );
  return false;
}

/** How many times a hook's changes are amended into the commit before giving up. */
const MAX_HOOK_AMENDS = 2;

/** Tracked files that differ from `HEAD`, staged or not. */
async function dirtyTrackedFiles(cwd: string): Promise<string[]> {
  return (await runGit(cwd, ['diff', '--name-only', 'HEAD'])).split(/\r?\n/).filter(Boolean);
}

/**
 * Commits what is staged, running the repository's hooks. A pre-commit hook that rewrites files without
 * restaging them (a formatter, say) leaves them dirty, so they're staged and amended into the same commit,
 * which runs the hooks again. Callers start from a clean tree, so anything dirty was written by a hook.
 *
 * @returns The hook's output if it rejected the commit, else `undefined`.
 * @throws If the hooks still change files after {@link MAX_HOOK_AMENDS} amends; nothing has been pushed.
 */
export async function commitWithHooks(cwd: string, message: string): Promise<string | undefined> {
  let commit = await execa('git', ['commit', '-m', message], { cwd, reject: false, all: true });
  for (let amends = 0; commit.exitCode === 0; amends++) {
    // eslint-disable-next-line no-await-in-loop -- each pass checks the commit the previous one made
    const dirty = await dirtyTrackedFiles(cwd);
    if (dirty.length === 0) {
      return undefined;
    }
    if (amends === MAX_HOOK_AMENDS) {
      throw new Error(
        `A pre-commit hook keeps changing ${dirty.join(', ')} after every commit, so nothing was pushed. Make the hook's output stable, or have it restage what it changes, then re-run this command.`,
      );
    }
    logger.info(`A pre-commit hook changed ${dirty.join(', ')}, so its changes are amended into the commit.`);
    // eslint-disable-next-line no-await-in-loop
    await runGit(cwd, ['add', '-u']);
    // --allow-empty: a hook that undid the whole change should fail the caller's own checks, not this amend.
    // eslint-disable-next-line no-await-in-loop
    commit = await execa('git', ['commit', '--amend', '--no-edit', '--allow-empty'], { cwd, reject: false, all: true });
  }
  return commit.all ?? '';
}
