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

/** Jobs that only make sense to run when the package actually changed. */
const PACKAGE_CHANGED_GATED_JOBS = new Set([
  'create-scratch',
  'install-dependencies',
  'push-scratch',
  'test-scratch',
  'delete-scratch',
  'create-package-version',
  'publish-utam-page-objects',
]);

/**
 * Returns a warning message (and thus "should skip") if `job` should be skipped given the current
 * `PACKAGE_CHANGED` environment variable set by `determine-package-changes` earlier in the
 * pipeline: scratch-org-lifecycle jobs skip when nothing changed, `create-fallback-tag` skips when
 * something did (since a real package version will be created instead). Returns `undefined`
 * (don't skip) otherwise.
 */
export function getSkipReason(job: string): string | undefined {
  if (PACKAGE_CHANGED_GATED_JOBS.has(job) && process.env.PACKAGE_CHANGED === 'FALSE') {
    return `No package changes detected (PACKAGE_CHANGED=FALSE). Skipping job: ${job}`;
  }

  if (job === 'create-fallback-tag' && process.env.PACKAGE_CHANGED === 'TRUE') {
    return 'Package changes detected (PACKAGE_CHANGED=TRUE). Skipping fallback tag creation.';
  }

  return undefined;
}
