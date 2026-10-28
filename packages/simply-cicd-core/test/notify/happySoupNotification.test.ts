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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVcsProvider } from '../../src/vcs/index.js';
import { loadProgress } from '../../src/deploy/deployCommon.js';
import { resolvePackageOrigin } from '../../src/happySoup/resolveOriginProject.js';
import { getRemoteCommitStories } from '../../src/notify/getRemoteCommitStories.js';
import { happySoupNotifyAfterScript, happySoupNotifyBeforeScript } from '../../src/notify/happySoupNotification.js';

vi.mock('../../src/deploy/deployCommon.js', () => ({ loadProgress: vi.fn() }));
vi.mock('../../src/happySoup/resolveOriginProject.js', () => ({ resolvePackageOrigin: vi.fn() }));
vi.mock('../../src/notify/getRemoteCommitStories.js', () => ({ getRemoteCommitStories: vi.fn() }));
vi.mock('../../src/vcs/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/vcs/index.js')>()),
  createVcsProvider: vi.fn(),
}));
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));

const NOT_AVAILABLE = { stories: 'N/A', storiesWithUrl: 'N/A' };

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

const upgradedPackage = {
  packageName: 'MyDependency',
  prevVersionId: '04t1',
  targetVersionId: '04t2',
  prevTag: 'sha-prev',
  targetTag: 'sha-target',
  targetDescription: 'https://gitlab.com/g/p/-/pipelines/1',
};

describe('happySoupNotification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(loadProgress).mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bodyOf(index = 0): { content: string } {
    const [, options] = fetchMock.mock.calls[index] as [string, RequestInit];
    return JSON.parse(options.body as string) as { content: string };
  }

  it('happySoupNotifyBeforeScript posts a starting card without touching progress', async () => {
    await happySoupNotifyBeforeScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStage: 'install-packaged',
    });

    expect(loadProgress).not.toHaveBeenCalled();
    expect(bodyOf().content).toContain('Starting Stage');
  });

  it('happySoupNotifyAfterScript on failure skips story resolution entirely', async () => {
    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStage: 'install-packaged',
      ciJobStatus: 'failed',
    });

    expect(loadProgress).not.toHaveBeenCalled();
  });

  it('happySoupNotifyAfterScript on success with no upgraded packages sends a card with no upgraded-packages section', async () => {
    vi.mocked(loadProgress).mockResolvedValue({ upgradedPackages: [] });

    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStatus: 'success',
    });

    expect(bodyOf().content).not.toContain('Upgraded Packages');
  });

  it('happySoupNotifyAfterScript renders a package whose origin could not be resolved as N/A, without any VCS call', async () => {
    vi.mocked(loadProgress).mockResolvedValue({ upgradedPackages: [upgradedPackage] });
    vi.mocked(resolvePackageOrigin).mockReturnValue(undefined);

    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStatus: 'success',
    });

    expect(createVcsProvider).not.toHaveBeenCalled();
    expect(bodyOf().content).toContain('MyDependency');
    expect(bodyOf().content).toContain('N/A');
  });

  it('happySoupNotifyAfterScript resolves and renders stories for an upgraded package', async () => {
    vi.mocked(loadProgress).mockResolvedValue({ upgradedPackages: [upgradedPackage] });
    vi.mocked(resolvePackageOrigin).mockReturnValue({ vcsProvider: 'gitlab', host: 'gitlab.com', projectPath: 'g/p' });
    vi.mocked(createVcsProvider).mockReturnValue({} as never);
    vi.mocked(getRemoteCommitStories).mockResolvedValue({
      stories: 'ABC-1',
      storiesWithUrl: "<a href='https://jira.example.com/browse/ABC-1'>ABC-1</a>",
    });

    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStatus: 'success',
      ciJobToken: 'job-token',
    });

    expect(createVcsProvider).toHaveBeenCalledWith('gitlab', {
      host: 'gitlab.com',
      token: 'job-token',
      tokenKind: 'job',
    });
    expect(bodyOf().content).toContain('MyDependency');
    expect(bodyOf().content).toContain("<a href='https://jira.example.com/browse/ABC-1'>ABC-1</a>");
  });

  it('happySoupNotifyAfterScript falls back to the project access token when the job token comes back empty', async () => {
    vi.mocked(loadProgress).mockResolvedValue({ upgradedPackages: [upgradedPackage] });
    vi.mocked(resolvePackageOrigin).mockReturnValue({ vcsProvider: 'gitlab', host: 'gitlab.com', projectPath: 'g/p' });
    vi.mocked(createVcsProvider).mockReturnValue({} as never);
    vi.mocked(getRemoteCommitStories)
      .mockResolvedValueOnce(NOT_AVAILABLE)
      .mockResolvedValueOnce({ stories: 'ABC-2', storiesWithUrl: 'ABC-2' });

    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStatus: 'success',
      ciJobToken: 'job-token',
      projectAccessToken: 'pat',
    });

    expect(createVcsProvider).toHaveBeenNthCalledWith(1, 'gitlab', {
      host: 'gitlab.com',
      token: 'job-token',
      tokenKind: 'job',
    });
    expect(createVcsProvider).toHaveBeenNthCalledWith(2, 'gitlab', {
      host: 'gitlab.com',
      token: 'pat',
      tokenKind: 'personal',
    });
    expect(getRemoteCommitStories).toHaveBeenCalledTimes(2);
    expect(bodyOf().content).toContain('ABC-2');
  });

  it('happySoupNotifyAfterScript does not retry with the PAT once a result is found', async () => {
    vi.mocked(loadProgress).mockResolvedValue({ upgradedPackages: [upgradedPackage] });
    vi.mocked(resolvePackageOrigin).mockReturnValue({ vcsProvider: 'gitlab', host: 'gitlab.com', projectPath: 'g/p' });
    vi.mocked(createVcsProvider).mockReturnValue({} as never);
    vi.mocked(getRemoteCommitStories).mockResolvedValue({ stories: 'ABC-3', storiesWithUrl: 'ABC-3' });

    await happySoupNotifyAfterScript({
      teamsWebhookUrl: ['http://mock'],
      notifyOnCompletion: false,
      ciJobStatus: 'success',
      ciJobToken: 'job-token',
      projectAccessToken: 'pat',
    });

    expect(getRemoteCommitStories).toHaveBeenCalledTimes(1);
  });
});
