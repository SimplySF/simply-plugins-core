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

import { execa } from 'execa';
import { createVcsProvider, type VcsProviderKind } from '../vcs/index.js';
import { logger } from '../logger.js';
import { installFlowDeltaPlugin } from '../sfPlugins.js';

/**
 * One of the upstream `@syntax-syllogism/flow-delta` diff tools. Each ships a diff binary plus one
 * reporter binary per platform, named `<binary>-<provider kind>`.
 */
export type DeltaTool = {
  /** The diff binary, e.g. `flow-delta`. */
  binary: string;
  /** Glob the diff binary scans. */
  path: string;
  /** Output directory used when the caller doesn't name one. */
  defaultOut: string;
  /** Sentence-case label for log lines, e.g. `Flow`. */
  label: string;
};

export const FLOW_DELTA: DeltaTool = {
  binary: 'flow-delta',
  path: '**/*.flow-meta.xml',
  defaultOut: 'flow-delta-out',
  label: 'Flow',
};

export const FLEXIPAGE_DELTA: DeltaTool = {
  binary: 'flexipage-delta',
  path: '**/*.flexipage-meta.xml',
  defaultOut: 'flexipage-delta-out',
  label: 'Flexipage',
};

/**
 * Pipeline context handed to the reporter. Everything is optional: each reporter falls back to its
 * platform's own CI environment variables, which the child process inherits, for anything we don't
 * pass explicitly.
 */
export type DeltaReporterContext = {
  /** Which platform's reporter to run. Defaults to `gitlab`. */
  vcsProvider?: VcsProviderKind;
  /** Hostname of the VCS instance, used to derive the reporter's `--api-url`. */
  vcsHost?: string;
  /** Token the reporter authenticates with when posting the diff. */
  projectAccessToken?: string;
  commitSha?: string;
  /** GitLab: numeric project ID. */
  ciProjectId?: string;
  /** GitLab: merge request internal ID. */
  ciMergeRequestIid?: string;
  /** GitHub: `owner/repo`. */
  ciRepository?: string;
  /** GitHub: pull request number. */
  ciPullRequestNumber?: string;
  /** GitHub: Actions run ID, used to build artifact links. */
  ciRunId?: string;
  /** GitHub: server URL, for non-github.com instances. */
  ciServerUrl?: string;
};

export type RunDeltaOptions = DeltaReporterContext & {
  from: string;
  to: string;
  out?: string;
  debug?: boolean;
};

/** Appends `--flag value` only when a value is present, so the reporter's env fallbacks still apply. */
function pushIfPresent(args: string[], flag: string, value: string | undefined): void {
  if (value) {
    args.push(flag, value);
  }
}

/**
 * Builds the reporter argv for the selected platform. The two reporters take different context
 * flags — GitLab addresses a merge request by project ID and IID, GitHub a pull request by
 * `owner/repo` and number — which is the whole reason this is routed through the VCS choice.
 */
export function buildReporterArgs(kind: VcsProviderKind, out: string, context: DeltaReporterContext): string[] {
  const args = ['--in', out];
  pushIfPresent(args, '--token', context.projectAccessToken);
  pushIfPresent(args, '--commit-sha', context.commitSha);

  // Ask the provider where its API lives rather than rebuilding the URL here.
  if (context.projectAccessToken) {
    const { apiUrl } = createVcsProvider(kind, { host: context.vcsHost, token: context.projectAccessToken });
    args.push('--api-url', apiUrl);
  }

  if (kind === 'github') {
    pushIfPresent(args, '--repo', context.ciRepository);
    pushIfPresent(args, '--pr', context.ciPullRequestNumber);
    pushIfPresent(args, '--run-id', context.ciRunId);
    pushIfPresent(args, '--server-url', context.ciServerUrl);
  } else {
    pushIfPresent(args, '--project-id', context.ciProjectId);
    pushIfPresent(args, '--mr-iid', context.ciMergeRequestIid);
  }

  return args;
}

/**
 * Runs a delta tool: the diff binary over the `from..to` range, then the reporter binary for the
 * selected platform to post the result back to the change request. Does not catch its own errors;
 * callers decide how to handle them.
 */
export async function runDelta(tool: DeltaTool, options: RunDeltaOptions): Promise<void> {
  const { from, to, out = tool.defaultOut, debug = false, vcsProvider = 'gitlab' } = options;
  if (!from || !to) {
    throw new Error('Missing "from" or "to" commit SHA. Provide --from/--to arguments.');
  }

  await installFlowDeltaPlugin(debug);
  await execa(
    tool.binary,
    ['--repo', '.', '--from', from, '--to', to, '--path', tool.path, '--changed-only', '--out', out, '--json'],
    { stdio: 'inherit' },
  );

  await execa(`${tool.binary}-${vcsProvider}`, buildReporterArgs(vcsProvider, out, options), { stdio: 'inherit' });
}

function extractErrorMessage(error: unknown, tool: DeltaTool): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return `Unknown error running ${tool.binary}`;
}

export type GenerateDiffOptions = RunDeltaOptions & { disabled?: boolean };
export type GenerateDiffResult = { skipped: boolean; success: boolean };

/**
 * Action-handler wrapper around `runDelta`: checks the job-level skip flag, then runs the delta and
 * logs (rather than throws) on failure, since a diff-posting step shouldn't fail the build.
 */
export async function generateDiff(tool: DeltaTool, options: GenerateDiffOptions): Promise<GenerateDiffResult> {
  const lowerLabel = tool.label.toLowerCase();

  if (options.disabled) {
    logger.info(`${tool.label} diff generation is disabled. Skipping.`);
    return { skipped: true, success: false };
  }

  logger.info(`Generating ${lowerLabel} diff using ${tool.binary}...`);
  try {
    await runDelta(tool, options);
    logger.success(`${tool.label} diff generation completed.`);
    return { skipped: false, success: true };
  } catch (error) {
    logger.error(`${tool.label} diff generation failed.`);
    logger.error(extractErrorMessage(error, tool));
    return { skipped: false, success: false };
  }
}
