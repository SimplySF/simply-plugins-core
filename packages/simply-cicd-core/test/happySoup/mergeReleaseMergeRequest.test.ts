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

import { describe, expect, it, vi } from 'vitest';
import type { VcsCommitLogEntry, VcsMergeability, VcsMergeRequest, VcsProvider } from '../../src/vcs/index.js';
import {
  CLOSE_OUT_COMMIT_MESSAGES,
  mergeReleaseMergeRequest,
  type MergeReleaseMergeRequestOptions,
} from '../../src/happySoup/mergeReleaseMergeRequest.js';

const SOURCE = 'release/2026-10-19';
const TARGET = 'environment/production';
const DEPLOYED = 'deployed0000';
const ARCHIVE = 'archive00000';

function mergeRequest(overrides: Partial<VcsMergeRequest> = {}): VcsMergeRequest {
  return {
    id: 1,
    iid: 42,
    title: 'Draft: Release 2026-10-19',
    sourceBranch: SOURCE,
    targetBranch: TARGET,
    webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/42',
    state: 'open',
    draft: true,
    headSha: ARCHIVE,
    raw: {},
    ...overrides,
  };
}

const commit = (sha: string, message: string): VcsCommitLogEntry => ({ sha, message, raw: {} });

type FakeSetup = {
  open?: VcsMergeRequest[];
  merged?: VcsMergeRequest[];
  /** Keyed by `from..to`. Unlisted pairs compare as empty. */
  compare?: Record<string, VcsCommitLogEntry[]>;
  mergeability?: VcsMergeability[];
  mergeError?: Error;
};

/** A provider with every merging method as a spy, defaulting to the happy path. */
function fakeProvider(setup: FakeSetup = {}) {
  const mergeabilities = [...(setup.mergeability ?? [{ state: 'mergeable', detail: 'mergeable' }])];
  const spies = {
    getMergeRequest: vi.fn((_project: unknown, iid: number) => Promise.resolve(mergeRequest({ iid }))),
    findMergeRequests: vi.fn((_project: unknown, _source: string, _target: string, state: string) =>
      Promise.resolve(state === 'open' ? (setup.open ?? [mergeRequest()]) : (setup.merged ?? [])),
    ),
    compareRefs: vi.fn((_project: unknown, from: string, to: string) =>
      Promise.resolve(
        setup.compare?.[`${from}..${to}`] ??
          (from === DEPLOYED && to === ARCHIVE ? [commit(ARCHIVE, `${CLOSE_OUT_COMMIT_MESSAGES.archive}\n`)] : []),
      ),
    ),
    getMergeability: vi.fn(() =>
      Promise.resolve(mergeabilities.length > 1 ? mergeabilities.shift()! : mergeabilities[0]),
    ),
    markMergeRequestReady: vi.fn((_project: unknown, current: VcsMergeRequest) =>
      Promise.resolve({ ...current, draft: false, title: 'Release 2026-10-19' }),
    ),
    mergeMergeRequest: vi.fn(() =>
      setup.mergeError ? Promise.reject(setup.mergeError) : Promise.resolve({ mergeCommitSha: 'merge0000', raw: {} }),
    ),
  };
  const provider = {
    kind: 'gitlab',
    terminology: { changeRequest: 'merge request', changeRequestShort: 'MR', projectVariable: 'variable' },
    ...spies,
  } as unknown as VcsProvider;
  return { provider, spies };
}

function run(setup: FakeSetup = {}, overrides: Partial<MergeReleaseMergeRequestOptions> = {}) {
  const fake = fakeProvider(setup);
  let clock = 0;
  const sleep = vi.fn((ms: number) => {
    clock += ms;
    return Promise.resolve();
  });
  const result = mergeReleaseMergeRequest({
    vcs: { provider: fake.provider, project: 'g/p' },
    sourceBranch: SOURCE,
    targetBranch: TARGET,
    deployedSha: DEPLOYED,
    sleep,
    now: () => clock,
    ...overrides,
  });
  return { result, ...fake, sleep };
}

describe('mergeReleaseMergeRequest', () => {
  it('marks a draft ready and merges the deployed commit plus the close-out commit, guarded by the head SHA', async () => {
    const { result, spies } = run();

    await expect(result).resolves.toEqual({
      mergeRequest: {
        iid: 42,
        title: 'Release 2026-10-19',
        webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/42',
      },
      status: 'Merged',
      headSha: ARCHIVE,
      mergeCommitSha: 'merge0000',
      closeOutCommits: [ARCHIVE],
      warnings: [],
    });
    expect(spies.findMergeRequests).toHaveBeenCalledWith('g/p', SOURCE, TARGET, 'open');
    expect(spies.markMergeRequestReady).toHaveBeenCalledOnce();
    expect(spies.mergeMergeRequest).toHaveBeenCalledWith('g/p', expect.objectContaining({ iid: 42 }), {
      sha: ARCHIVE,
      squash: false,
      removeSourceBranch: false,
    });
  });

  it('merges without comparing when the head is the deployed commit, and skips marking a ready one', async () => {
    const { result, spies } = run({ open: [mergeRequest({ headSha: DEPLOYED, draft: false })] });

    await expect(result).resolves.toMatchObject({ status: 'Merged', closeOutCommits: [] });
    expect(spies.compareRefs).not.toHaveBeenCalled();
    expect(spies.markMergeRequestReady).not.toHaveBeenCalled();
  });

  it('passes squash and removeSourceBranch through', async () => {
    const { result, spies } = run({}, { squash: true, removeSourceBranch: true });

    await result;
    expect(spies.mergeMergeRequest).toHaveBeenCalledWith('g/p', expect.anything(), {
      sha: ARCHIVE,
      squash: true,
      removeSourceBranch: true,
    });
  });

  it('accepts the remove-obsolete close-out commit too', async () => {
    const { result } = run({
      compare: { [`${DEPLOYED}..${ARCHIVE}`]: [commit(ARCHIVE, CLOSE_OUT_COMMIT_MESSAGES.remove)] },
    });

    await expect(result).resolves.toMatchObject({ status: 'Merged' });
  });

  it('refuses commits pushed after the deploy, naming them, and merges nothing', async () => {
    const { result, spies } = run({
      compare: {
        [`${DEPLOYED}..${ARCHIVE}`]: [
          commit('hotfix000000', 'fix: late hotfix\n\nbody'),
          commit(ARCHIVE, CLOSE_OUT_COMMIT_MESSAGES.archive),
        ],
      },
    });

    await expect(result).rejects.toThrow(/never reached production[\s\S]*hotfix00 fix: late hotfix/);
    expect(spies.markMergeRequestReady).not.toHaveBeenCalled();
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('refuses a head that does not contain the deployed commit', async () => {
    const { result, spies } = run({ compare: { [`${ARCHIVE}..${DEPLOYED}`]: [commit(DEPLOYED, 'feat: x')] } });

    await expect(result).rejects.toThrow(/doesn't contain the deployed commit deployed/);
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('polls while the platform is checking', async () => {
    const { result, spies, sleep } = run({
      mergeability: [
        { state: 'checking', detail: 'checking' },
        { state: 'checking', detail: 'checking' },
        { state: 'mergeable', detail: 'mergeable' },
      ],
    });

    await expect(result).resolves.toMatchObject({ status: 'Merged' });
    expect(spies.getMergeability).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through a stale draft status right after marking it ready', async () => {
    const { result } = run({
      mergeability: [
        { state: 'blocked', reason: 'draft', detail: 'draft_status' },
        { state: 'mergeable', detail: 'mergeable' },
      ],
    });

    await expect(result).resolves.toMatchObject({ status: 'Merged' });
  });

  it('gives up after --wait minutes', async () => {
    const { result, spies } = run({ mergeability: [{ state: 'checking', detail: 'unchecked' }] }, { waitMinutes: 1 });

    await expect(result).rejects.toThrow(/still working out .* after 1 minute\(s\) \(last status "unchecked"\)/);
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['approvals', /doesn't approve its own merge request/],
    ['checks', /\[skip ci\].*Skipped pipelines are considered successful/],
    ['conflict', /environment\/production has moved on/],
    ['discussions', /unresolved threads/],
    ['other', /can't merge \(gitlab reports "weird"\)/],
  ] as const)('explains a merge request blocked by %s', async (reason, message) => {
    const { result, spies } = run({
      open: [mergeRequest({ draft: false })],
      mergeability: [{ state: 'blocked', reason, detail: 'weird' }],
    });

    await expect(result).rejects.toThrow(message);
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('explains a moved branch when the SHA guard trips', async () => {
    const { result } = run({ mergeError: new Error('GitLab API error: 409 Conflict - SHA does not match HEAD') });

    await expect(result).rejects.toThrow(`${SOURCE} moved after archive0 was checked`);
  });

  it('wraps any other refusal', async () => {
    const { result } = run({ mergeError: new Error('GitLab API error: 405 Method Not Allowed') });

    await expect(result).rejects.toThrow(/gitlab refused to merge MR !42 .*405 Method Not Allowed/);
  });

  it('reports one that already merged, so a retry is harmless', async () => {
    const { result, spies } = run({ open: [], merged: [mergeRequest({ state: undefined, draft: false })] });

    await expect(result).resolves.toMatchObject({ status: 'Already merged', closeOutCommits: [] });
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('fails when there is no merge request at all', async () => {
    const { result } = run({ open: [], merged: [] });

    await expect(result).rejects.toThrow(`There is no open merge request from ${SOURCE} into ${TARGET}`);
  });

  it('fetches an explicit iid, and fails when its branches do not match', async () => {
    const ok = run({}, { mergeRequestIid: 42 });
    await expect(ok.result).resolves.toMatchObject({ status: 'Merged' });
    expect(ok.spies.getMergeRequest).toHaveBeenCalledWith('g/p', 42);
    expect(ok.spies.findMergeRequests).not.toHaveBeenCalled();

    const wrong = run({}, { mergeRequestIid: 42, targetBranch: 'environment/uat' });
    await expect(wrong.result).rejects.toThrow(/not from release\/2026-10-19 into environment\/uat/);
  });

  it('fails on a closed merge request', async () => {
    const fake = fakeProvider();
    fake.spies.getMergeRequest.mockResolvedValue(mergeRequest({ state: 'closed' }));
    await expect(
      mergeReleaseMergeRequest({
        vcs: { provider: fake.provider, project: 'g/p' },
        sourceBranch: SOURCE,
        targetBranch: TARGET,
        deployedSha: DEPLOYED,
        mergeRequestIid: 42,
      }),
    ).rejects.toThrow('was closed without merging');
  });

  it('checks everything on a dry run, but makes no write calls', async () => {
    const { result, spies } = run({}, { dryRun: true });

    await expect(result).resolves.toMatchObject({
      status: 'Would merge',
      headSha: ARCHIVE,
      warnings: [expect.stringContaining('is a draft, and would be marked ready first')],
    });
    expect(spies.compareRefs).toHaveBeenCalled();
    expect(spies.markMergeRequestReady).not.toHaveBeenCalled();
    expect(spies.mergeMergeRequest).not.toHaveBeenCalled();
  });

  it('fails clearly with a provider that cannot merge', async () => {
    const provider = {
      kind: 'bitbucket',
      terminology: { changeRequest: 'pull request', changeRequestShort: 'PR', projectVariable: 'variable' },
      compareRefs: vi.fn(),
    } as unknown as VcsProvider;

    await expect(
      mergeReleaseMergeRequest({
        vcs: { provider, project: 'g/p' },
        sourceBranch: SOURCE,
        targetBranch: TARGET,
        deployedSha: DEPLOYED,
      }),
    ).rejects.toThrow('The bitbucket provider does not support merging pull requests (missing getMergeRequest,');
  });
});
