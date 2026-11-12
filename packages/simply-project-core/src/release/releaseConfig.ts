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

import { getPluginConfig } from '@simplysf/simply-core';
import { isValidIncrement, RELEASE_TYPES, type ReleaseType } from './releaseBranches.js';

/** Where in `sfdx-project.json` a project declares its release settings. */
export const RELEASE_CONFIG_PATH = 'plugins.simply.release';

/** `plugins.simply.release` in `sfdx-project.json`. Every field is optional. */
export type ReleasePluginConfig = {
  /** How far each release type moves its part of the version. A missing type moves by 1. */
  increments?: Partial<Record<ReleaseType, number>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads and validates `plugins.simply.release`. A missing `plugins`, `simply`, or `release` key
 * means nothing is set.
 *
 * @param project - The parsed `sfdx-project.json`.
 * @param source - Where the file came from, named in errors (for example `origin/release/v1.2.0`).
 * @returns The release settings, or an empty object when the project declares none.
 * @throws {Error} If `release` or `increments` isn't an object, or an increment isn't a whole number
 * of at least 1.
 */
export function readReleasePluginConfig(project: Record<string, unknown>, source?: string): ReleasePluginConfig {
  const where = source ? ` in ${source}'s sfdx-project.json` : ' in sfdx-project.json';
  const config = getPluginConfig<unknown>(project, RELEASE_CONFIG_PATH);
  if (config === undefined) {
    return {};
  }
  if (!isRecord(config)) {
    throw new Error(`${RELEASE_CONFIG_PATH}${where} must be an object.`);
  }
  const increments = config.increments;
  if (increments === undefined) {
    return {};
  }
  if (!isRecord(increments)) {
    throw new Error(`${RELEASE_CONFIG_PATH}.increments${where} must be an object.`);
  }

  const result: Partial<Record<ReleaseType, number>> = {};
  for (const type of RELEASE_TYPES) {
    const value = increments[type];
    if (value === undefined) {
      continue;
    }
    if (!isValidIncrement(value)) {
      throw new Error(
        `${RELEASE_CONFIG_PATH}.increments.${type}${where} must be a whole number of at least 1, not ${JSON.stringify(value)}.`,
      );
    }
    result[type] = value;
  }
  return { increments: result };
}
