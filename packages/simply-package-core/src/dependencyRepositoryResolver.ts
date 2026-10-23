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

import type { DependencyRepositories, DependencyRepository } from './schemas/sfdx-project/dependencyRepositories.js';

/** A dependency matched to its `plugins.simply.packages` entry. */
export type ResolvedDependencyRepository = {
  /** The map key that matched. */
  key: string;
  repository: DependencyRepository;
};

/** @returns `alias` up to its first `@`, the part `sf package version create` keeps per package. */
function aliasPrefix(alias: string): string {
  const at = alias.indexOf('@');
  return at > 0 ? alias.slice(0, at) : alias;
}

/**
 * Find a dependency's repository entry.
 *
 * Tried in order, first match wins:
 *
 * 1. the dependency's `package` value, exactly;
 * 2. that value up to its first `@`, so a key such as `fflib` keeps matching after
 * `dependencies manage` rewrites `fflib@3.0.0-1` to `fflib@3.1.0-2`;
 * 3. the ID the value resolves to through `packageAliases`, and then every other alias (and alias
 * prefix) for that same ID, which covers a dependency written as a bare `0Ho`/`04t` ID.
 *
 * @param packageRef - The dependency's `package` value: an alias or an ID.
 * @param repositories - The project's repository map.
 * @param packageAliases - The project's `packageAliases`.
 * @returns The matching entry, or `undefined` if there isn't one.
 */
export function resolveDependencyRepository(
  packageRef: string,
  repositories: DependencyRepositories,
  packageAliases: Record<string, string> = {},
): ResolvedDependencyRepository | undefined {
  const candidates = [packageRef, aliasPrefix(packageRef)];

  const id = packageAliases[packageRef] ?? packageRef;
  candidates.push(id);
  for (const [alias, aliasId] of Object.entries(packageAliases)) {
    if (aliasId === id) candidates.push(alias, aliasPrefix(alias));
  }

  for (const key of candidates) {
    if (Object.hasOwn(repositories, key)) {
      return { key, repository: repositories[key] };
    }
  }
  return undefined;
}

/**
 * Whether a dependency is listed in `plugins.simply.dependencies.ignore`, by its `package` value,
 * that value's alias prefix, or the ID it resolves to.
 *
 * @param packageRef - The dependency's `package` value.
 * @param ignore - The ignore list: aliases or IDs.
 * @param packageAliases - The project's `packageAliases`.
 * @returns `true` if the dependency should be skipped.
 */
export function isIgnoredDependency(
  packageRef: string,
  ignore: readonly string[],
  packageAliases: Record<string, string> = {},
): boolean {
  if (ignore.length === 0) return false;
  const id = packageAliases[packageRef] ?? packageRef;
  return ignore.some((entry) => entry === packageRef || entry === aliasPrefix(packageRef) || entry === id);
}
