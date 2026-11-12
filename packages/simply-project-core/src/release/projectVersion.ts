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

import { type ReleaseBranch, versionNumberMatchesBranch } from './releaseBranches.js';

type JsonObject = Record<string, unknown>;

export type ProjectVersionBump = {
  /** The bumped project. */
  project: JsonObject;
  /** The `package` of each directory that was bumped. */
  bumped: string[];
  /** The `package` of each bumped directory whose `versionName` didn't contain the old version. */
  versionNameUnchanged: string[];
};

/** `MAJOR.MINOR.PATCH`, with a missing patch read as 0, as `versionNumber` always has one. */
const semver = (branch: ReleaseBranch): string => `${branch.major}.${branch.minor}.${branch.patch ?? 0}`;

const escape = (text: string): string => text.replaceAll('.', '\\.');

/** Replaces the version in a `versionName` like `Core v1.2.0`, matching only a whole version. */
function bumpVersionName(versionName: string, source: ReleaseBranch, target: ReleaseBranch): string | undefined {
  const candidates: Array<[string, string]> = [[semver(source), semver(target)]];
  if (source.patch === undefined) {
    candidates.push([`${source.major}.${source.minor}`, `${target.major}.${target.minor}`]);
  }
  for (const [from, to] of candidates) {
    const pattern = new RegExp(`(?<![\\d.])${escape(from)}(?![\\d.]*\\d)`);
    if (pattern.test(versionName)) {
      return versionName.replace(pattern, to);
    }
  }
  return undefined;
}

/**
 * Bumps every package directory whose `versionNumber` matches `source` to `target`'s version,
 * keeping its build part (`NEXT` in practice). Directories for other packages are left alone.
 */
export function bumpProjectVersion(
  project: JsonObject,
  source: ReleaseBranch,
  target: ReleaseBranch,
): ProjectVersionBump {
  const copy = structuredClone(project);
  const bumped: string[] = [];
  const versionNameUnchanged: string[] = [];
  const directories = Array.isArray(copy.packageDirectories) ? (copy.packageDirectories as JsonObject[]) : [];

  for (const directory of directories) {
    const { versionNumber, versionName } = directory;
    if (typeof versionNumber !== 'string' || !versionNumberMatchesBranch(versionNumber, source)) {
      continue;
    }
    const build = versionNumber.split('.')[3] ?? 'NEXT';
    directory.versionNumber = `${semver(target)}.${build}`;
    const name = [directory.package, directory.path].find((value) => typeof value === 'string') ?? '(unnamed)';
    bumped.push(name);

    if (typeof versionName === 'string') {
      const renamed = bumpVersionName(versionName, source, target);
      if (renamed === undefined) {
        versionNameUnchanged.push(name);
      } else {
        directory.versionName = renamed;
      }
    }
  }
  return { project: copy, bumped, versionNameUnchanged };
}

/** Whether a project already carries `target`'s version for at least one package directory. */
export function hasVersion(project: JsonObject, target: ReleaseBranch): boolean {
  const directories = Array.isArray(project.packageDirectories) ? (project.packageDirectories as JsonObject[]) : [];
  return directories.some(
    ({ versionNumber }) => typeof versionNumber === 'string' && versionNumberMatchesBranch(versionNumber, target),
  );
}
