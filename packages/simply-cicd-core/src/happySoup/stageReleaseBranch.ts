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

import {
  assertCleanWorkingTree,
  assertKnownRemote,
  assertValidBranchName,
  assertValidSegment,
  checkOutExisting,
  existingCheckoutWarning,
  fetchRemote,
  listRemoteBranches,
  localBranchExists,
  remoteBranchExists,
  repositoryRoot,
  runGit,
} from './branches.js';

/** The remote branch families a staging branch is usually cut from. */
export const STAGING_BASE_PREFIXES = ['environment/', 'release/'];

export type StageReleaseBranchStatus = 'Created' | 'Would create' | 'Already exists';

export type StageReleaseBranchResult = {
  /** `<team>/<app>/<name>`. */
  branch: string;
  base: string;
  status: StageReleaseBranchStatus;
  warnings: string[];
};

export type StageReleaseBranchOptions = {
  team: string;
  app: string;
  /** The release name or ticket, such as `PROJ-1058`. */
  name: string;
  /** The branch to stage from. The command defaults it to the configuration's `productionBranch`. */
  baseBranch: string;
  remote?: string;
  dryRun?: boolean;
  /** Any directory inside the repository. Defaults to `process.cwd()`. */
  cwd?: string;
};

export type ListStagingBaseBranchesOptions = {
  remote?: string;
  /** Moved to the front of the list. */
  productionBranch?: string;
  cwd?: string;
};

/**
 * Fetches the remote and lists the branches a staging branch is usually cut from: its
 * `environment/*` and `release/*` branches, with the production branch first. For a prompt.
 */
export async function listStagingBaseBranches(options: ListStagingBaseBranchesOptions = {}): Promise<string[]> {
  const cwd = await repositoryRoot(options.cwd ?? process.cwd());
  const remote = options.remote ?? 'origin';
  await assertKnownRemote(cwd, remote);
  await fetchRemote(cwd, remote);
  return listRemoteBranches(cwd, remote, STAGING_BASE_PREFIXES, options.productionBranch);
}

/**
 * Starts a staging branch, `<team>/<app>/<name>`, from the remote's copy of the base branch, and
 * checks it out. It isn't pushed. If the branch is already on the remote, it is checked out instead
 * (see `checkOutExisting`), and one that exists only locally is switched to. Every segment and the base are validated, and a dirty working tree is
 * refused, before anything changes.
 */
export async function stageReleaseBranch(options: StageReleaseBranchOptions): Promise<StageReleaseBranchResult> {
  const cwd = await repositoryRoot(options.cwd ?? process.cwd());
  const remote = options.remote ?? 'origin';
  for (const [label, value] of [
    ['team', options.team],
    ['application', options.app],
    ['release name', options.name],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- each reports its own error
    await assertValidSegment(cwd, label, value);
  }
  const branch = `${options.team}/${options.app}/${options.name}`;
  const base = options.baseBranch;
  await assertValidBranchName(cwd, branch);
  await assertValidBranchName(cwd, base, 'base branch');
  await assertKnownRemote(cwd, remote);
  await assertCleanWorkingTree(cwd);
  await fetchRemote(cwd, remote);
  if (!(await remoteBranchExists(cwd, remote, base))) {
    throw new Error(`The base branch ${base} doesn't exist on ${remote}.`);
  }

  const result: StageReleaseBranchResult = { branch, base, status: 'Would create', warnings: [] };
  if (await remoteBranchExists(cwd, remote, branch)) {
    result.status = 'Already exists';
    if (!options.dryRun) {
      const warning = existingCheckoutWarning(await checkOutExisting(cwd, remote, branch), remote, branch);
      if (warning) result.warnings.push(warning);
    }
    return result;
  }
  // Staging branches aren't pushed, so one that exists only locally is simply the one to go back to.
  if (await localBranchExists(cwd, branch)) {
    result.status = 'Already exists';
    if (!options.dryRun) {
      await runGit(cwd, ['switch', branch]);
    }
    return result;
  }
  if (options.dryRun) {
    return result;
  }

  await runGit(cwd, ['switch', '--no-track', '-c', branch, `${remote}/${base}`]);
  result.status = 'Created';
  return result;
}
