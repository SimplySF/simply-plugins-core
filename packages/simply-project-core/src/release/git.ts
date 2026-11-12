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

/** Switches back to where the lead started: their branch if it still exists, else the commit they were on. */
export async function restoreStart(cwd: string, startBranch: string, startCommit: string): Promise<void> {
  if (startBranch === 'HEAD') {
    await runGit(cwd, ['switch', '--detach', startCommit]);
  } else if (await gitSucceeds(cwd, ['show-ref', '--verify', '-q', `refs/heads/${startBranch}`])) {
    await runGit(cwd, ['switch', startBranch]);
  }
}
