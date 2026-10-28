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
  FLOW_DELTA,
  generateDiff,
  runDelta,
  type GenerateDiffOptions,
  type GenerateDiffResult,
  type RunDeltaOptions,
} from './deltaRunner.js';

export type RunFlowDeltaOptions = RunDeltaOptions;
export type GenerateFlowDiffOptions = GenerateDiffOptions;
export type GenerateFlowDiffResult = GenerateDiffResult;

/**
 * Runs the upstream `flow-delta` binary over the commit range, then the reporter binary for the
 * selected VCS platform. Does not catch its own errors; callers decide how to handle them.
 */
export async function runFlowDelta(options: RunFlowDeltaOptions): Promise<void> {
  return runDelta(FLOW_DELTA, options);
}

/**
 * Action-handler wrapper around `runFlowDelta`: checks the job-level skip flag, then runs the flow
 * delta and logs (rather than throws) on failure, since a diff-posting step shouldn't fail the build.
 *
 * Fixes a bug from the original: the CLI wired its skip flag as `--disabled`, but this function
 * checked `options.disableFlowDiff` — a property nothing ever set — so `--disabled` was a no-op.
 */
export async function generateFlowDiff(options: GenerateFlowDiffOptions): Promise<GenerateFlowDiffResult> {
  return generateDiff(FLOW_DELTA, options);
}
