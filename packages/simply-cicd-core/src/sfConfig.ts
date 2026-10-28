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

import fs from 'node:fs';
import type { VcsProviderKind } from './vcs/index.js';
import { logger } from './logger.js';

/** Where a packaged dependency's source lives, for happy-soup story lookups. */
export type PackageOriginOverride = {
  vcsProvider: VcsProviderKind;
  host?: string;
  projectPath: string;
};

type SfDevRcConfig = {
  almProjectKey?: string;
  almProjectKeys?: string[];
  /** @deprecated Renamed to `almProjectKey`. Still read, but warns. */
  jiraProjectKey?: string;
  /** @deprecated Renamed to `almProjectKeys`. Still read, but warns. */
  jiraProjectKeys?: string[];
  /**
   * Maps a package name to the VCS project its source lives in, for happy-soup dependency story
   * lookups. Only needed for packages whose `sf package version report` `Description` doesn't hold
   * a recognizable CI pipeline URL (e.g. externally-vendored packages not built by this pipeline).
   */
  packageOriginOverrides?: Record<string, PackageOriginOverride>;
};

/** Reads and parses `.sfdevrc.json`, or returns `undefined` if it's missing or invalid. */
function readSfDevRcConfig(): SfDevRcConfig | undefined {
  try {
    if (!fs.existsSync('.sfdevrc.json')) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync('.sfdevrc.json', 'utf8')) as SfDevRcConfig;
  } catch {
    return undefined;
  }
}

/** Collects a single-key and multi-key field into one deduplicated, non-empty list. */
function collectKeys(single: string | undefined, multiple: string[] | undefined): string[] {
  const keys: string[] = [];
  if (single) {
    keys.push(single);
  }
  if (Array.isArray(multiple)) {
    keys.push(...multiple);
  }
  return [...new Set(keys.filter(Boolean))];
}

/**
 * Retrieves ALM project keys from the `.sfdevrc.json` configuration file, or falls back to a
 * provided default. Reads a single or multiple project keys from the configuration, deduplicates
 * them, and filters out empty values.
 *
 * The legacy `jiraProjectKey`/`jiraProjectKeys` fields are still honored, so existing repositories
 * keep working, but `almProjectKey`/`almProjectKeys` win outright when present — the two sets are
 * not merged, so a repository migrating one key at a time gets the new value rather than a blend.
 */
export function getAlmProjectKeys(passedProjectKey?: string): string[] {
  let projectKeys: string[] = [];
  try {
    if (fs.existsSync('.sfdevrc.json')) {
      const content = fs.readFileSync('.sfdevrc.json', 'utf8');
      const config = JSON.parse(content) as SfDevRcConfig;

      projectKeys = collectKeys(config.almProjectKey, config.almProjectKeys);

      if (projectKeys.length === 0) {
        const legacyKeys = collectKeys(config.jiraProjectKey, config.jiraProjectKeys);
        if (legacyKeys.length > 0) {
          logger.warn(
            'The .sfdevrc.json fields "jiraProjectKey" and "jiraProjectKeys" are deprecated. Rename them to "almProjectKey" and "almProjectKeys"; the old names will be removed in a future release.',
          );
          projectKeys = legacyKeys;
        }
      }
    }
  } catch {
    // Ignore and fall back to the passed command-line project key.
  }

  if (projectKeys.length > 0) {
    return projectKeys;
  }

  return passedProjectKey ? [passedProjectKey] : [];
}

/**
 * Looks up an explicit VCS project override for a package name from `.sfdevrc.json`'s
 * `packageOriginOverrides`. Returns `undefined` if the file, the field, or an entry for this
 * package doesn't exist.
 */
export function getPackageOriginOverride(packageName: string): PackageOriginOverride | undefined {
  return readSfDevRcConfig()?.packageOriginOverrides?.[packageName];
}
