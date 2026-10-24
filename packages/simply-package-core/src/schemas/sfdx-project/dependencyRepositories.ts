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

/** Where `sfdx-project.json` keeps per-package settings, keyed by package alias (or ID). */
export const PACKAGES_CONFIG_PATH = 'plugins.simply.packages';

/**
 * Whether `ref` is a ref name git would accept, per `git check-ref-format`, and doesn't start with
 * `-`. A ref from a dependency's project file is third-party input that ends up in git's
 * arguments, so a leading `-` must never be read as an option.
 */
function isSafeRef(ref: string): boolean {
  return (
    !ref.startsWith('-') &&
    // eslint-disable-next-line no-control-regex -- control characters are exactly what's being refused
    !/[\x00-\x20\x7f~^:?*[\\]/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('@{') &&
    !ref.includes('//') &&
    !/^\/|[/.]$|\.lock$|(^|\/)\./.test(ref) &&
    ref !== '@'
  );
}

/** Whether `value` is a relative path that stays inside the repository: not absolute, and no `..` segment. */
function isInsideRepository(value: string): boolean {
  return !/^([\\/]|[a-z]:)/i.test(value) && !value.split(/[\\/]/).includes('..');
}

/**
 * The `repository` of a `plugins.simply.packages` entry: where that package's source lives.
 * Unknown keys are kept, so a later version can add fields without older ones rejecting the file.
 */
export const DependencyRepositorySchema = z
  .object({
    url: z.string().min(1).describe('Anything `git clone` accepts. Never include credentials.'),
    ref: z
      .string()
      .min(1)
      .refine(isSafeRef, 'must be a branch, tag, or commit SHA that git accepts, and not start with "-"')
      .optional()
      .describe("Branch, tag, or commit SHA. Default: the remote's default branch."),
    path: z
      .string()
      .min(1)
      .refine(isInsideRepository, 'must be a relative path inside the repository, with no ".."')
      .optional()
      .describe("Subdirectory holding the repository's sfdx-project.json. Default: the repository root."),
  })
  .catchall(z.unknown());

/**
 * One entry in `plugins.simply.packages`: settings for one package. `repository` is the only
 * setting so far. Unknown keys are kept, so later settings can sit beside it.
 */
export const PackageConfigSchema = z
  .object({ repository: DependencyRepositorySchema.optional() })
  .catchall(z.unknown());

/** `plugins.simply.packages`, keyed by package alias (or ID). */
export const PackagesConfigSchema = z.record(z.string(), PackageConfigSchema);

/** The `repository` of a `plugins.simply.packages` entry. */
export type DependencyRepository = z.infer<typeof DependencyRepositorySchema>;
/** One entry in `plugins.simply.packages`. */
export type PackageConfig = z.infer<typeof PackageConfigSchema>;
/** `plugins.simply.packages`, keyed by package alias (or ID). */
export type PackagesConfig = z.infer<typeof PackagesConfigSchema>;
/** The `repository` of every `plugins.simply.packages` entry that has one, keyed the same way. */
export type DependencyRepositories = Record<string, DependencyRepository>;

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
 * Read and validate a project's `plugins.simply.packages` map, and return the `repository` of
 * each entry that has one.
 *
 * @param project - The parsed project manifest.
 * @param source - What to call the project in error messages, e.g. its file path.
 * @returns The repositories by package key, or an empty object if the project maps none.
 * @throws {SfError} `InvalidRepositoryConfigError` if the map or an entry has the wrong shape, or
 * `CredentialsInUrlError` if a repository's `url` contains credentials. Both name the offending key.
 */
export function readDependencyRepositories(project: SfdxProject, source = 'sfdx-project.json'): DependencyRepositories {
  const raw = getPluginConfig<unknown>(project, PACKAGES_CONFIG_PATH);
  if (raw === undefined) return {};

  const result = PackagesConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${[PACKAGES_CONFIG_PATH, ...issue.path].join('.')}: ${issue.message}`)
      .join('\n');
    throw new SfError(`Invalid repository configuration in ${source}:\n${issues}`, 'InvalidRepositoryConfigError');
  }

  const repositories: DependencyRepositories = {};
  for (const [key, { repository }] of Object.entries(result.data)) {
    if (!repository) continue;
    if (hasCredentialsInUrl(repository.url)) {
      throw new SfError(
        `The repository url for "${key}" in ${source} contains credentials. Remove them and let git supply them instead (an SSH key or a credential helper).`,
        'CredentialsInUrlError',
      );
    }
    repositories[key] = repository;
  }

  return repositories;
}
