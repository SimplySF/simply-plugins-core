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

import type { VcsMergeability, VcsMergeRequest, VcsProvider } from '../vcs/index.js';
import type { HappySoupReleaseVcs } from './createReleaseBranch.js';

// See docs/design/0065-happy-soup-merge-release.md.

/**
 * The commit messages `deployment-close-out` writes. They are the only commits `merge-release` lets
 * through on top of the one the pipeline deployed, so both stages read them from here.
 */
export const CLOSE_OUT_COMMIT_MESSAGES = {
  archive: 'Archiving deploy.json [skip ci]',
  remove: 'Removing obsolete config/deploy.json [skip ci]',
} as const;

const CLOSE_OUT_SUBJECTS: ReadonlySet<string> = new Set(Object.values(CLOSE_OUT_COMMIT_MESSAGES));

/** The default for {@link MergeReleaseMergeRequestOptions.waitMinutes}. */
export const DEFAULT_MERGE_WAIT_MINUTES = 10;

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export type MergeReleaseMergeRequestStatus = 'Merged' | 'Would merge' | 'Already merged';

export type MergeReleaseMergeRequestResult = {
  mergeRequest: { iid: number; title: string; webUrl?: string };
  status: MergeReleaseMergeRequestStatus;
  /** The source commit that was (or would be) merged. */
  headSha?: string;
  /** The commit on the target branch, when the platform reports it. */
  mergeCommitSha?: string;
  /** The close-out commits merged on top of the deployed one. */
  closeOutCommits: string[];
  /** Things worth telling the user that didn't stop the run. */
  warnings: string[];
};

export type MergeReleaseMergeRequestOptions = {
  vcs: HappySoupReleaseVcs;
  /** The release branch, which is the merge request's source. */
  sourceBranch: string;
  /** The production branch, which is the merge request's target. */
  targetBranch: string;
  /** The commit the pipeline deployed. The merge request may hold only this plus close-out commits. */
  deployedSha: string;
  /** Merge this one instead of looking it up by source and target branch. */
  mergeRequestIid?: number;
  squash?: boolean;
  /** Delete the source branch after merging (GitLab only). Defaults to `false`: release branches are kept. */
  removeSourceBranch?: boolean;
  /** How long to wait for the platform to work out mergeability. Defaults to 10 minutes. */
  waitMinutes?: number;
  /** How often to ask while waiting. Defaults to 10 seconds. */
  pollIntervalMs?: number;
  /** Check everything, but don't mark ready or merge. */
  dryRun?: boolean;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  /** For tests. */
  now?: () => number;
};

type MergingProvider = VcsProvider &
  Required<
    Pick<
      VcsProvider,
      'getMergeRequest' | 'findMergeRequests' | 'getMergeability' | 'markMergeRequestReady' | 'mergeMergeRequest'
    >
  >;

function assertMergingProvider(provider: VcsProvider): asserts provider is MergingProvider {
  const missing = (
    ['getMergeRequest', 'findMergeRequests', 'getMergeability', 'markMergeRequestReady', 'mergeMergeRequest'] as const
  ).filter((method) => typeof provider[method] !== 'function');
  if (missing.length > 0) {
    throw new Error(
      `The ${provider.kind} provider does not support merging ${provider.terminology.changeRequest}s (missing ${missing.join(', ')}).`,
    );
  }
}

const label = (provider: VcsProvider, mergeRequest: Pick<VcsMergeRequest, 'iid' | 'webUrl'>): string =>
  `${provider.terminology.changeRequestShort} ${provider.kind === 'github' ? '#' : '!'}${mergeRequest.iid}${mergeRequest.webUrl ? ` (${mergeRequest.webUrl})` : ''}`;

const subject = (message: string): string => message.split(/\r?\n/, 1)[0].trim();

const short = (sha: string): string => sha.slice(0, 8);

/** Finds the merge request to merge, or the one that already merged. */
async function resolveMergeRequest(
  provider: MergingProvider,
  options: MergeReleaseMergeRequestOptions,
): Promise<VcsMergeRequest> {
  const { vcs, sourceBranch, targetBranch, mergeRequestIid } = options;
  const term = provider.terminology.changeRequest;

  if (mergeRequestIid !== undefined) {
    const mergeRequest = await provider.getMergeRequest(vcs.project, mergeRequestIid);
    if (mergeRequest.sourceBranch !== sourceBranch || mergeRequest.targetBranch !== targetBranch) {
      throw new Error(
        `${label(provider, mergeRequest)} is from ${mergeRequest.sourceBranch} into ${mergeRequest.targetBranch}, not from ${sourceBranch} into ${targetBranch}. Check --merge-request-iid and --target-branch.`,
      );
    }
    return mergeRequest;
  }

  const [open] = await provider.findMergeRequests(vcs.project, sourceBranch, targetBranch, 'open');
  if (open) {
    return open;
  }
  const [merged] = await provider.findMergeRequests(vcs.project, sourceBranch, targetBranch, 'merged');
  if (merged) {
    // The listing doesn't always carry the state, and the caller decides on it.
    return { ...merged, state: 'merged' };
  }
  throw new Error(
    `There is no open ${term} from ${sourceBranch} into ${targetBranch}. Open one (for example with \`sf simply cicd happy-soup release create\`), or pass --merge-request-iid.`,
  );
}

/**
 * Checks that the merge request holds exactly what was deployed, plus `deployment-close-out`'s
 * commits, and returns those commits' SHAs.
 */
async function assertOnlyCloseOutCommits(
  provider: MergingProvider,
  options: MergeReleaseMergeRequestOptions,
  mergeRequest: VcsMergeRequest,
  headSha: string,
): Promise<string[]> {
  const { vcs, deployedSha, sourceBranch } = options;
  if (headSha === deployedSha) {
    return [];
  }

  const term = provider.terminology.changeRequest;
  // Anything the deployed commit has that the head doesn't means the head isn't built on it.
  const missing = await provider.compareRefs(vcs.project, headSha, deployedSha);
  if (missing.length > 0) {
    throw new Error(
      `${label(provider, mergeRequest)} points at ${short(headSha)}, which doesn't contain the deployed commit ${short(deployedSha)}. ${sourceBranch} was rewritten after it was deployed, so the ${term} wasn't merged.`,
    );
  }

  const added = await provider.compareRefs(vcs.project, deployedSha, headSha);
  const unexpected = added.filter((commit) => !CLOSE_OUT_SUBJECTS.has(subject(commit.message)));
  if (unexpected.length > 0) {
    const list = unexpected.map((commit) => `  ${commit.sha ? short(commit.sha) : '?'} ${subject(commit.message)}`);
    throw new Error(
      [
        `${sourceBranch} has commits that were pushed after ${short(deployedSha)} was deployed, so they never reached production. The ${term} wasn't merged:`,
        ...list,
        `Deploy ${sourceBranch} again, or merge ${label(provider, mergeRequest)} by hand.`,
      ].join('\n'),
    );
  }
  return added.map((commit) => commit.sha).filter((sha): sha is string => Boolean(sha));
}

function blockedMessage(
  provider: VcsProvider,
  mergeRequest: VcsMergeRequest,
  mergeability: Extract<VcsMergeability, { state: 'blocked' }>,
  options: MergeReleaseMergeRequestOptions,
): string {
  const which = label(provider, mergeRequest);
  const status = `(${provider.kind} reports "${mergeability.detail}")`;
  switch (mergeability.reason) {
    case 'approvals':
      return `${which} can't merge until it has the approvals it needs ${status}. This stage doesn't approve its own ${provider.terminology.changeRequest}; approve it, then retry the job.`;
    case 'checks':
      return `${which} can't merge because the required pipeline or status checks haven't passed ${status}. The deployment-close-out commit is [skip ci], so it never runs one. On GitLab, turn on "Skipped pipelines are considered successful" next to "Pipelines must succeed"; on GitHub, don't require status checks on ${options.targetBranch} for this merge.`;
    case 'conflict':
      return `${which} can't merge because ${options.targetBranch} has moved on since ${options.sourceBranch} was cut ${status}. Merge ${options.targetBranch} into ${options.sourceBranch} and deploy it again.`;
    case 'discussions':
      return `${which} can't merge while it has unresolved threads ${status}. Resolve them, then retry the job.`;
    case 'draft':
      return `${which} is still a draft ${status}. Mark it ready, then retry the job.`;
    case 'other':
      return provider.kind === 'github' && mergeability.detail === 'blocked'
        ? `${which} is blocked by branch protection on ${options.targetBranch}: a required review or a required status check is missing ${status}. The deployment-close-out commit is [skip ci], so it never runs status checks.`
        : `${which} can't merge ${status}.`;
  }
}

/** Polls until the platform has decided, or the wait runs out. */
async function waitForMergeability(
  provider: MergingProvider,
  options: MergeReleaseMergeRequestOptions,
  mergeRequest: VcsMergeRequest,
  justMarkedReady: boolean,
): Promise<VcsMergeability> {
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const waitMinutes = options.waitMinutes ?? DEFAULT_MERGE_WAIT_MINUTES;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = now() + waitMinutes * 60_000;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polling is inherently sequential
    const mergeability = await provider.getMergeability(options.vcs.project, mergeRequest);
    // Right after it's marked ready, the platform can still report the draft it just cleared.
    const settling =
      mergeability.state === 'checking' ||
      (justMarkedReady && mergeability.state === 'blocked' && mergeability.reason === 'draft');
    if (!settling) {
      return mergeability;
    }
    if (now() + interval > deadline) {
      throw new Error(
        `${provider.kind} was still working out whether ${label(provider, mergeRequest)} can merge after ${waitMinutes} minute(s) (last status "${mergeability.detail}"). Retry the job, or raise --wait.`,
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(interval);
  }
}

/**
 * Merges a happy-soup release branch's merge request into production, after the production
 * `deployment-close-out` has run. It refuses to merge anything that wasn't deployed: the merge
 * request's head must be the deployed commit, or that commit plus close-out's own commits. A draft
 * is marked ready first. The merge passes the checked head SHA, so the platform refuses it if the
 * branch moves in between.
 *
 * Prints nothing; the caller reports the result.
 *
 * @throws {Error} If the provider can't merge, there's no merge request, it holds commits that
 * weren't deployed, or the platform won't merge it.
 */
export async function mergeReleaseMergeRequest(
  options: MergeReleaseMergeRequestOptions,
): Promise<MergeReleaseMergeRequestResult> {
  const { provider } = options.vcs;
  assertMergingProvider(provider);
  const term = provider.terminology.changeRequest;
  const warnings: string[] = [];

  let mergeRequest = await resolveMergeRequest(provider, options);
  const summary = (): MergeReleaseMergeRequestResult['mergeRequest'] => ({
    iid: mergeRequest.iid,
    title: mergeRequest.title,
    webUrl: mergeRequest.webUrl,
  });

  if (mergeRequest.state === 'merged') {
    return {
      mergeRequest: summary(),
      status: 'Already merged',
      headSha: mergeRequest.headSha,
      closeOutCommits: [],
      warnings,
    };
  }
  if (mergeRequest.state === 'closed') {
    throw new Error(`${label(provider, mergeRequest)} was closed without merging. Reopen it, then retry the job.`);
  }

  const { headSha } = mergeRequest;
  if (!headSha) {
    throw new Error(`${provider.kind} didn't report which commit ${label(provider, mergeRequest)} points at.`);
  }
  const closeOutCommits = await assertOnlyCloseOutCommits(provider, options, mergeRequest, headSha);

  if (options.dryRun) {
    if (mergeRequest.draft) {
      warnings.push(`${label(provider, mergeRequest)} is a draft, and would be marked ready first.`);
    }
    return { mergeRequest: summary(), status: 'Would merge', headSha, closeOutCommits, warnings };
  }

  const wasDraft = Boolean(mergeRequest.draft);
  if (wasDraft) {
    mergeRequest = await provider.markMergeRequestReady(options.vcs.project, mergeRequest);
  }

  const mergeability = await waitForMergeability(provider, options, mergeRequest, wasDraft);
  if (mergeability.state === 'blocked') {
    throw new Error(blockedMessage(provider, mergeRequest, mergeability, options));
  }

  try {
    const result = await provider.mergeMergeRequest(options.vcs.project, mergeRequest, {
      sha: headSha,
      squash: options.squash ?? false,
      removeSourceBranch: options.removeSourceBranch ?? false,
    });
    return {
      mergeRequest: summary(),
      status: 'Merged',
      headSha,
      mergeCommitSha: result.mergeCommitSha,
      closeOutCommits,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Both platforms answer 409 when the `sha` guard no longer matches the branch.
    if (/\b409\b/.test(message)) {
      throw new Error(
        `${options.sourceBranch} moved after ${short(headSha)} was checked, so the ${term} wasn't merged. Retry the job to check it again.`,
        { cause: error },
      );
    }
    throw new Error(`${provider.kind} refused to merge ${label(provider, mergeRequest)}: ${message}`, { cause: error });
  }
}
