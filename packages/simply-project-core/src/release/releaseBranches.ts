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

export type ReleaseType = 'major' | 'minor' | 'patch';

export const RELEASE_TYPES: readonly ReleaseType[] = ['major', 'minor', 'patch'];

/** Whether two branches name the same version, e.g. `release/1.3` and `release/v1.3.0`. */
export function sameReleaseVersion(a: ReleaseBranch, b: ReleaseBranch): boolean {
  return compareReleaseBranches(a, b) === 0;
}

/** Whether `value` can be used as a release increment: a whole number of at least 1. */
export function isValidIncrement(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The branch after `branch` for a semantic bump, keeping its label's shape: `v1.2.0` → `v1.3.0`,
 * `1.2` → `1.3`. `increment` is how far the bumped part moves (`v1.20.0` → `v1.30.0` for a minor
 * increment of 10); the parts below it reset to 0. A minor-line branch has no patch to bump, so
 * `patch` on one is an error.
 */
export function nextReleaseBranch(
  branch: ReleaseBranch,
  type: ReleaseType,
  prefix: string,
  increment = 1,
): ReleaseBranch {
  if (!isValidIncrement(increment)) {
    throw new Error(`Invalid ${type} increment ${String(increment)}. Use a whole number of at least 1.`);
  }
  if (type === 'patch' && branch.patch === undefined) {
    throw new Error(`${branch.name} names a minor line, which has no patch version to bump. Use minor or major.`);
  }
  const major = type === 'major' ? branch.major + increment : branch.major;
  const minor = type === 'major' ? 0 : type === 'minor' ? branch.minor + increment : branch.minor;
  const patch = branch.patch === undefined ? undefined : type === 'patch' ? branch.patch + increment : 0;
  const v = branch.label.startsWith('v') ? 'v' : '';
  const label = `${v}${major}.${minor}${patch === undefined ? '' : `.${patch}`}`;
  return { name: `${prefix}${label}`, label, major, minor, ...(patch === undefined ? {} : { patch }) };
}
