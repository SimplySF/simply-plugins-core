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
  assertUniquePermissionSetNames,
  checkPermissionSets,
  findPermissionSetBuildFiles,
  loadPermissionSetBuildFile,
  PermissionSetBuildError,
  type PermissionSetCheckResult,
  type PermissionSetSpec,
} from '@simplysf/simply-permissions-core';
import { logger } from '../logger.js';

export type RunCheckPermissionSetsOptions = { disabled?: boolean };
export type PermissionSetBuildFileCheck = { file: string; permissionSet: PermissionSetCheckResult };
export type RunCheckPermissionSetsResult = { skipped: boolean; files: PermissionSetBuildFileCheck[] };

/** The same text `simply permissions build` reports for each `PermissionSetBuildError` code. */
function describeBuildError(error: PermissionSetBuildError): string {
  switch (error.code) {
    case 'scan-failed':
      return `Failed to scan the Salesforce project directory: ${error.args[0]}`;
    case 'invalid-config':
      return `The configuration file ${error.args[0]} is invalid: ${error.args[1]}`;
    case 'config-not-found':
      return `The configuration file ${error.args[0]} does not exist.`;
    case 'directory-not-found':
      return `The source directory ${error.args[0]} for permission set ${error.args[1]} does not exist.`;
    case 'legacy-format':
      return `${error.args[0]} uses the old format, a "permissionSets" list, which is no longer supported. Split it into one .psbuild.json file per permission set, with each permission set's settings at the top level.`;
    case 'duplicate-name':
      return `Permission set ${error.args[0]} is defined by both ${error.args[1]} and ${error.args[2]}. Each permission set must be defined by exactly one .psbuild.json file.`;
  }
}

/** Logs `message` and throws it, keeping the build error as the cause. */
function fail(message: string, cause: PermissionSetBuildError): never {
  logger.error(message);
  throw new Error(message, { cause });
}

/** Loads every file in order, naming the file in any validation error, then checks names are unique across files. */
async function loadFiles(files: string[]): Promise<Array<{ file: string; spec: PermissionSetSpec }>> {
  const entries: Array<{ file: string; spec: PermissionSetSpec }> = [];
  for (const file of files) {
    logger.info(`Loading permission set build file ${file}...`);
    try {
      // eslint-disable-next-line no-await-in-loop -- files are loaded in order so the first invalid one is the one reported
      entries.push({ file, spec: await loadPermissionSetBuildFile(file) });
    } catch (error) {
      if (error instanceof PermissionSetBuildError) {
        fail(`Permission set build file ${file}: ${describeBuildError(error)}`, error);
      }
      throw error;
    }
  }
  try {
    assertUniquePermissionSetNames(entries);
  } catch (error) {
    if (error instanceof PermissionSetBuildError) {
      fail(describeBuildError(error), error);
    }
    throw error;
  }
  return entries;
}

/**
 * Finds every permission set build file in the repo and checks the permission set each defines
 * against the generated file on disk, writing nothing. A repo with no permission set build files is
 * a skip. Every file is loaded and validated, and names are checked for duplicates across files,
 * before anything is checked; then every permission set is checked before failing, so one run
 * reports every stale permission set.
 *
 * @throws When any permission set has drifted or is missing, or a permission set build file is invalid.
 */
export async function runCheckPermissionSets(
  options: RunCheckPermissionSetsOptions,
): Promise<RunCheckPermissionSetsResult> {
  if (options.disabled) {
    logger.warn('check-permission-sets is disabled. Skipping.');
    return { skipped: true, files: [] };
  }

  const files = await findPermissionSetBuildFiles();
  if (files.length === 0) {
    logger.warn('No permission set build files found. Skipping.');
    return { skipped: true, files: [] };
  }

  const entries = await loadFiles(files);
  const results = await checkPermissionSets(entries.map(({ spec }) => spec));
  const checks = entries.map(({ file }, i) => ({ file, permissionSet: results[i] }));

  const stale = checks.filter(({ permissionSet }) => permissionSet.status !== 'up-to-date');
  for (const { file, permissionSet } of stale) {
    logger.error(`${permissionSet.name} ${permissionSet.status} ${permissionSet.path} (${file})`);
  }

  if (stale.length > 0) {
    logger.log('Regenerate with: sf simply permissions build');
    const message = `${stale.length} of ${checks.length} permission set(s) have drifted from their source metadata or are missing.`;
    logger.error(message);
    throw new Error(message);
  }

  logger.success(`All ${checks.length} permission set(s) are up to date.`);
  return { skipped: false, files: checks };
}
