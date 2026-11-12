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

import { CICD_ENV_VARS, readCicdEnvVar } from '../cicdEnvVars.js';

/** Jobs that only make sense to run when the package actually changed. */
const PACKAGE_CHANGED_GATED_JOBS = new Set([
  'create-scratch',
  'install-dependencies',
  'push-scratch',
  'test-scratch',
  'delete-scratch',
  'create-package-version',
  'publish-utam-page-objects',
  'publish-aer-package',
]);

/**
 * Returns a warning message (and thus "should skip") if `job` should be skipped given the current
 * `SIMPLY_CICD_PACKAGE_CHANGED` environment variable set by `determine-package-changes` earlier in
 * the pipeline (or the deprecated `PACKAGE_CHANGED`, with a warning): scratch-org-lifecycle jobs
 * skip when nothing changed, `create-fallback-tag` skips when something did (since a real package
 * version will be created instead). Returns `undefined` (don't skip) otherwise.
 */
export function getSkipReason(job: string): string | undefined {
  const gated = PACKAGE_CHANGED_GATED_JOBS.has(job);
  if (!gated && job !== 'create-fallback-tag') {
    return undefined;
  }

  const packageChanged = readCicdEnvVar(CICD_ENV_VARS.packageChanged);
  if (gated && packageChanged?.value === 'FALSE') {
    return `No package changes detected (${packageChanged.name}=FALSE). Skipping job: ${job}`;
  }

  if (job === 'create-fallback-tag' && packageChanged?.value === 'TRUE') {
    return `Package changes detected (${packageChanged.name}=TRUE). Skipping fallback tag creation.`;
  }

  return undefined;
}
