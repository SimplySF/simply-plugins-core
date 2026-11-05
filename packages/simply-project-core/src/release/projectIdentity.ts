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

type JsonObject = Record<string, unknown>;

/** Fields that say which package version a branch builds, so a merge must never change them. */
const IDENTITY_FIELDS = ['versionNumber', 'versionName', 'ancestorVersion', 'ancestorId'] as const;

function packageDirectoriesOf(project: JsonObject): JsonObject[] {
  return Array.isArray(project.packageDirectories) ? (project.packageDirectories as JsonObject[]) : [];
}

function findPackageDirectory(project: JsonObject, packageName: unknown): JsonObject | undefined {
  return packageDirectoriesOf(project).find((directory) => directory.package === packageName);
}

/** The default package directory's `versionNumber`, if the project declares one. */
export function defaultVersionNumber(project: JsonObject): string | undefined {
  const versionNumber = packageDirectoriesOf(project).find((directory) => directory.default)?.versionNumber;
  return typeof versionNumber === 'string' ? versionNumber : undefined;
}

/**
 * Returns a copy of `project` carrying the target's identity fields and the given aliases. A package
 * directory the target doesn't have is left alone, since it has no identity to protect.
 */
export function withTargetIdentity(project: JsonObject, target: JsonObject, aliases: unknown): JsonObject {
  const copy = structuredClone(project);
  for (const directory of packageDirectoriesOf(copy)) {
    const targetDirectory = findPackageDirectory(target, directory.package);
    if (targetDirectory) {
      for (const field of IDENTITY_FIELDS) {
        if (field in targetDirectory) {
          directory[field] = targetDirectory[field];
        } else {
          delete directory[field];
        }
      }
    }
  }
  if (aliases !== undefined) {
    copy.packageAliases = aliases;
  }
  return copy;
}

/** Both sides' `packageAliases`, with the target's value winning for a shared alias. */
export function unionAliases(target: JsonObject, source: JsonObject): JsonObject | undefined {
  if (target.packageAliases === undefined && source.packageAliases === undefined) {
    return undefined;
  }
  return { ...(source.packageAliases as JsonObject), ...(target.packageAliases as JsonObject) };
}

/** Lists each identity field in `actual` that differs from `target`, as `package.field`. */
export function identityMismatches(actual: JsonObject, target: JsonObject): string[] {
  return packageDirectoriesOf(target).flatMap((targetDirectory) => {
    const directory = findPackageDirectory(actual, targetDirectory.package);
    return IDENTITY_FIELDS.filter((field) => directory?.[field] !== targetDirectory[field]).map(
      (field) => `${String(targetDirectory.package)}.${field}`,
    );
  });
}

/** Serializes a project using the indentation of `likeText`, so a rewrite doesn't reformat the file. */
export function stringifyProject(project: JsonObject, likeText: string): string {
  const indent = /^(?<indent>[ \t]+)"/m.exec(likeText)?.groups?.indent ?? '  ';
  return `${JSON.stringify(project, undefined, indent)}\n`;
}
