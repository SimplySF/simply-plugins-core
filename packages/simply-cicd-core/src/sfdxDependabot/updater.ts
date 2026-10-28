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

import { logger } from '../logger.js';

type SfdxProjectDependency = { package?: string };
type SfdxProjectPackageDirectory = { dependencies?: SfdxProjectDependency[] };
type SfdxProject = {
  packageDirectories?: SfdxProjectPackageDirectory[];
  packageAliases?: Record<string, string>;
};

export type UpdateSfdxProjectResult = {
  changed: boolean;
  newJsonContent: string;
  oldVersions: string[];
  hasDependency: boolean;
};

/** Detects the indentation of a JSON string. Defaults to 2 spaces if none is detected. */
export function detectIndentation(jsonString: string): string | number {
  let indent: string | number = 2;
  const lines = jsonString.split('\n');
  const firstIndentedLine = lines.find((line) => line.startsWith(' ') || line.startsWith('\t'));
  if (firstIndentedLine) {
    const match = /^([ \t]+)/.exec(firstIndentedLine);
    if (match) {
      indent = match[1];
    }
  }
  return indent;
}

/**
 * Parses and updates a released package's dependency version(s) within `sfdx-project.json`
 * content. Also swaps the package's `packageAliases` entry to point at the new subscriber
 * package version ID, removing stale alias entries for the versions it replaced.
 */
export function updateSfdxProject(
  jsonString: string,
  releasedPackageName: string,
  releasedPackageVersion: string,
  subscriberPackageVersionId: string,
): UpdateSfdxProjectResult {
  let sfdxProject: SfdxProject;
  try {
    sfdxProject = JSON.parse(jsonString) as SfdxProject;
  } catch (error) {
    throw new Error(`Malformed JSON in sfdx-project.json: ${(error as Error).message}`, { cause: error });
  }

  let changed = false;
  let hasDependency = false;
  const oldVersionsSet = new Set<string>();

  if (Array.isArray(sfdxProject.packageDirectories)) {
    for (const dir of sfdxProject.packageDirectories) {
      if (Array.isArray(dir.dependencies)) {
        for (const dep of dir.dependencies) {
          if (dep.package) {
            const lastAtIndex = dep.package.lastIndexOf('@');
            if (lastAtIndex !== -1) {
              const name = dep.package.substring(0, lastAtIndex);
              const version = dep.package.substring(lastAtIndex + 1);

              if (name === releasedPackageName) {
                hasDependency = true;
                if (version !== releasedPackageVersion) {
                  oldVersionsSet.add(version);
                  dep.package = `${releasedPackageName}@${releasedPackageVersion}`;
                  changed = true;
                }
              }
            } else if (dep.package === releasedPackageName) {
              const hasAlias = sfdxProject.packageAliases?.[releasedPackageName] !== undefined;
              if (hasAlias) {
                logger.warn(
                  `Dependency reference "${dep.package}" is in alias-only format and matches the released package, but cannot be auto-updated because it lacks a version suffix (@version).`,
                );
              }
            }
          }
        }
      }
    }
  }

  if (changed) {
    sfdxProject.packageAliases ??= {};
    for (const oldVersion of oldVersionsSet) {
      const oldAliasKey = `${releasedPackageName}@${oldVersion}`;
      if (sfdxProject.packageAliases[oldAliasKey] !== undefined) {
        delete sfdxProject.packageAliases[oldAliasKey];
      }
    }
    sfdxProject.packageAliases[`${releasedPackageName}@${releasedPackageVersion}`] = subscriberPackageVersionId;
  }

  const indent = detectIndentation(jsonString);
  const newJsonContent = JSON.stringify(sfdxProject, null, indent) + '\n';

  return {
    changed,
    newJsonContent,
    oldVersions: [...oldVersionsSet],
    hasDependency,
  };
}
