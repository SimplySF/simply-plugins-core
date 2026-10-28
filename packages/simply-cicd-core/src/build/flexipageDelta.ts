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
  FLEXIPAGE_DELTA,
  generateDiff,
  runDelta,
  type GenerateDiffOptions,
  type GenerateDiffResult,
  type RunDeltaOptions,
} from './deltaRunner.js';

export type RunFlexipageDeltaOptions = RunDeltaOptions;
export type GenerateFlexipageDiffOptions = GenerateDiffOptions;
export type GenerateFlexipageDiffResult = GenerateDiffResult;

/**
 * Runs the upstream `flexipage-delta` binary over the commit range, then the reporter binary for
 * the selected VCS platform. Does not catch its own errors; callers decide how to handle them.
 */
export async function runFlexipageDelta(options: RunFlexipageDeltaOptions): Promise<void> {
  return runDelta(FLEXIPAGE_DELTA, options);
}

/**
 * Action-handler wrapper around `runFlexipageDelta`: checks the job-level skip flag, then runs the
 * flexipage delta and logs (rather than throws) on failure, since a diff-posting step shouldn't
 * fail the build.
 *
 * Fixes a bug from the original: the CLI wired its skip flag as `--disabled`, but this function
 * checked `options.disableFlexipageDiff` — a property nothing ever set — so `--disabled` was a no-op.
 */
export async function generateFlexipageDiff(
  options: GenerateFlexipageDiffOptions,
): Promise<GenerateFlexipageDiffResult> {
  return generateDiff(FLEXIPAGE_DELTA, options);
}
