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

/** A release branch, parsed from a name like `release/v1.2.0`. */
export type ReleaseBranch = {
  name: string;
  /** The name without the prefix, e.g. `v1.2.0`. */
  label: string;
  major: number;
  minor: number;
  /** Absent when the branch is named for a minor line, e.g. `release/1.2`. */
  patch?: number;
};

/** One merge in a roll-forward chain. */
export type ReleaseBranchPair = { source: ReleaseBranch; target: ReleaseBranch };

function compareReleaseBranches(a: ReleaseBranch, b: ReleaseBranch): number {
  return a.major - b.major || a.minor - b.minor || (a.patch ?? 0) - (b.patch ?? 0);
}

/** Parses `<prefix>[v]MAJOR.MINOR[.PATCH]`, returning undefined for anything else (e.g. `release/uat`). */
export function parseReleaseBranch(name: string, prefix: string): ReleaseBranch | undefined {
  if (!name.startsWith(prefix)) {
    return undefined;
  }
  const label = name.slice(prefix.length);
  const groups = /^v?(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?$/.exec(label)?.groups;
  if (!groups) {
    return undefined;
  }
  return {
    name,
    label,
    major: Number(groups.major),
    minor: Number(groups.minor),
    ...(groups.patch === undefined ? {} : { patch: Number(groups.patch) }),
  };
}

/** Parses and numerically sorts branch names, ignoring non-release branches. */
export function sortReleaseBranches(names: string[], prefix: string): ReleaseBranch[] {
  const branches = names
    .map((name) => parseReleaseBranch(name, prefix))
    .filter((branch): branch is ReleaseBranch => branch !== undefined)
    .sort(compareReleaseBranches);

  for (const [index, branch] of branches.entries()) {
    const next = branches[index + 1];
    if (next && compareReleaseBranches(branch, next) === 0) {
      throw new Error(`Release branches ${branch.name} and ${next.name} name the same version.`);
    }
  }
  return branches;
}

/**
 * Returns each adjacent pair between `source` and `target`, defaulting to the full range. Every
 * branch in between is always included, because each version must contain everything before it.
 */
export function selectReleasePairs(branches: ReleaseBranch[], source?: string, target?: string): ReleaseBranchPair[] {
  const indexOf = (name: string): number => {
    const index = branches.findIndex((branch) => branch.name === name);
    if (index === -1) {
      throw new Error(`${name} is not a release branch on the remote.`);
    }
    return index;
  };
  const start = source === undefined ? 0 : indexOf(source);
  const end = target === undefined ? branches.length - 1 : indexOf(target);

  if (source !== undefined && target !== undefined && start >= end) {
    throw new Error(`Can't roll ${source} into ${target}: the source must be a lower version than the target.`);
  }
  return branches.slice(start, end).map((branch, index) => ({ source: branch, target: branches[start + index + 1] }));
}

/** Whether a `versionNumber` like `1.2.0.NEXT` agrees with the version in the branch's name. */
export function versionNumberMatchesBranch(versionNumber: string, branch: ReleaseBranch): boolean {
  const [major, minor, patch] = versionNumber.split('.');
  return (
    Number(major) === branch.major &&
    Number(minor) === branch.minor &&
    (branch.patch === undefined || Number(patch) === branch.patch)
  );
}
