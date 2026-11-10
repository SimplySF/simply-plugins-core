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
  loadSfDevRc,
  resolveAlmProjectKeys,
  sfDevRcSchema,
  VCS_PROVIDER_KINDS,
  type LoadSfDevRcResult,
} from '@simplysf/simply-core';
import { z } from 'zod';
import { logger } from './logger.js';

const packageOriginOverrideSchema = z.object({
  vcsProvider: z.enum(VCS_PROVIDER_KINDS),
  host: z.string().min(1).optional(),
  projectPath: z.string().min(1),
});

/** Where a packaged dependency's source lives, for happy-soup story lookups. */
export type PackageOriginOverride = z.infer<typeof packageOriginOverrideSchema>;

/**
 * The `.sfdevrc.json` schema as `simply-cicd` reads it: the shared base fields from
 * `@simplysf/simply-core` plus the sections this package owns. Other consumers' sections (e.g.
 * `simply-project`'s `setup`) pass through unvalidated.
 */
export const cicdSfDevRcSchema = sfDevRcSchema.extend({
  /** Extra Salesforce CLI plugins to install before a deployment, on top of the defaults. */
  deploymentPlugins: z.array(z.string().min(1)).optional(),
  /**
   * Maps a package name to the VCS project its source lives in, for happy-soup dependency story
   * lookups. Only needed for packages whose `sf package version report` `Description` doesn't hold
   * a recognizable CI pipeline URL (e.g. externally-vendored packages not built by this pipeline).
   */
  packageOriginOverrides: z.record(z.string(), packageOriginOverrideSchema).optional(),
});

/** The parsed `.sfdevrc.json`, including the sections `simply-cicd` owns. */
export type CicdSfDevRc = z.infer<typeof cicdSfDevRcSchema>;

/**
 * Loads `.sfdevrc.json` (or the legacy `.sfdevrc`) from `cwd`, overlays the plugin-neutral
 * `SIMPLY_*` environment variables (`SFDEVRC_ENV_VARS` in `@simplysf/simply-core`), and validates
 * the result against {@link cicdSfDevRcSchema}. Warnings go through this package's logger.
 * Returns an empty config when nothing is set; throws `SfDevRcError` when the file or a variable is
 * malformed.
 */
export function loadCicdSfDevRc(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): LoadSfDevRcResult<CicdSfDevRc> {
  return loadSfDevRc({
    cwd,
    schema: cicdSfDevRcSchema,
    warn: (message) => logger.warn(message),
    env,
  });
}

/**
 * Retrieves ALM project keys. Precedence: `passedProjectKey` (the `--alm-project-key` flag) >
 * `.sfdevrc.json`'s `alm.projectKeys` > none. Legacy `almProjectKey(s)` / `jiraProjectKey(s)`
 * fields are still read, with a deprecation warning.
 *
 * @deprecated Load once with {@link loadCicdSfDevRc} and call `resolveAlmProjectKeys` from
 * `@simplysf/simply-core`. Kept for one minor version.
 */
export function getAlmProjectKeys(passedProjectKey?: string): string[] {
  return resolveAlmProjectKeys(loadCicdSfDevRc().config, passedProjectKey);
}

/**
 * Looks up an explicit VCS project override for a package name from `.sfdevrc.json`'s
 * `packageOriginOverrides`. Returns `undefined` if the file, the field, or an entry for this
 * package doesn't exist. Pass an already-loaded `config` to avoid re-reading the file per package.
 */
export function getPackageOriginOverride(
  packageName: string,
  config: CicdSfDevRc = loadCicdSfDevRc().config,
): PackageOriginOverride | undefined {
  return config.packageOriginOverrides?.[packageName];
}
