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

import { SfError } from '@salesforce/core';
import { getPluginConfig, type SfdxProject } from '@simplysf/simply-core';
import { z } from 'zod';

/** Where `sfdx-project.json` keeps the dependency-to-repository map. */
export const DEPENDENCY_REPOSITORIES_CONFIG_PATH = 'plugins.simply.dependencies.repositories';

/**
 * One entry in `plugins.simply.dependencies.repositories`: where a dependency's source lives.
 * Unknown keys are kept, so a later version can add fields without older ones rejecting the file.
 */
export const DependencyRepositorySchema = z
  .object({
    url: z.string().min(1).describe('Anything `git clone` accepts. Never include credentials.'),
    ref: z.string().min(1).optional().describe("Branch, tag, or commit SHA. Default: the remote's default branch."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Subdirectory holding the repository's sfdx-project.json. Default: the repository root."),
  })
  .catchall(z.unknown());

/** `plugins.simply.dependencies.repositories`, keyed by package alias (or ID). */
export const DependencyRepositoriesSchema = z.record(z.string(), DependencyRepositorySchema);

/** One entry in `plugins.simply.dependencies.repositories`. */
export type DependencyRepository = z.infer<typeof DependencyRepositorySchema>;
/** `plugins.simply.dependencies.repositories`, keyed by package alias (or ID). */
export type DependencyRepositories = z.infer<typeof DependencyRepositoriesSchema>;

/**
 * Whether a git URL carries credentials that shouldn't be committed to `sfdx-project.json`.
 *
 * A password in any URL counts. So does any username on an `http(s)` URL, because that's where
 * hosts accept a bare token (`https://<token>@github.com/…`). An `ssh` username such as `git@`
 * doesn't, and neither does the scp-like `git@host:path` form, which can't hold a password.
 *
 * @param url - The repository URL.
 * @returns `true` if `url` contains credentials.
 */
export function hasCredentialsInUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not URL-shaped: the scp-like `user@host:path` form, or a local path.
    return false;
  }

  if (parsed.password) return true;
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.username !== '';
}

/**
 * Read and validate a project's `plugins.simply.dependencies.repositories` map.
 *
 * @param project - The parsed project manifest.
 * @param source - What to call the project in error messages, e.g. its file path.
 * @returns The map, or an empty object if the project doesn't have one.
 * @throws {SfError} `InvalidRepositoryConfigError` if the map or an entry has the wrong shape, or
 * `CredentialsInUrlError` if an entry's `url` contains credentials. Both name the offending key.
 */
export function readDependencyRepositories(project: SfdxProject, source = 'sfdx-project.json'): DependencyRepositories {
  const raw = getPluginConfig<unknown>(project, DEPENDENCY_REPOSITORIES_CONFIG_PATH);
  if (raw === undefined) return {};

  const result = DependencyRepositoriesSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${[DEPENDENCY_REPOSITORIES_CONFIG_PATH, ...issue.path].join('.')}: ${issue.message}`)
      .join('\n');
    throw new SfError(`Invalid repository configuration in ${source}:\n${issues}`, 'InvalidRepositoryConfigError');
  }

  for (const [key, repository] of Object.entries(result.data)) {
    if (hasCredentialsInUrl(repository.url)) {
      throw new SfError(
        `The url for "${key}" in ${source} contains credentials. Remove them and let git supply them instead (an SSH key or a credential helper).`,
        'CredentialsInUrlError',
      );
    }
  }

  return result.data;
}
