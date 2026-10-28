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

import { promises as fsPromises } from 'node:fs';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import {
  findPackageVersionTag,
  findPreviousVersionTag,
  getPackageVersionHistory,
  resolveBuiltSubscriberPackageVersionId,
  sendBuildNotification,
  SUBSCRIBER_PACKAGE_VERSION_ID_FILE,
} from '../../src/notify/buildNotification.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn() } };
});
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

const VERSION_ID = '04t000000000001AAA';
const OTHER_VERSION_ID = '04t000000000002AAA';

type GitHandler = (args: string[]) => string | Error;

/** Routes each `git <subcommand>` call to a handler; anything unhandled fails the test. */
function mockGit(handlers: Record<string, GitHandler>): void {
  vi.mocked(execa).mockImplementation((async (command: string, args: string[] = []) => {
    const handler = command === 'git' ? handlers[args[0]] : undefined;
    if (!handler) {
      throw new Error(`Unexpected execa call: ${command} ${args.join(' ')}`);
    }
    const result = handler(args);
    if (result instanceof Error) {
      throw result;
    }
    return { stdout: result };
  }) as never);
}

function gitCalls(subcommand: string): string[][] {
  return vi
    .mocked(execa)
    .mock.calls.map(([, args]) => args as string[])
    .filter((args) => args[0] === subcommand);
}

/** A repository where the new version is tagged at HEAD and an earlier version exists. */
function mockTaggedRepo(overrides: Record<string, GitHandler> = {}): void {
  mockGit({
    'rev-parse': () => 'true',
    fetch: () => '',
    tag: () => `v1.4.0.2\t${VERSION_ID}\nsome-other-tag\t`,
    describe: () => 'v1.4.0.1',
    log: () => 'abc123 ABC-12 add thing\ndef456 ABC-15 fix thing',
    ...overrides,
  });
}

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

describe('buildNotification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [] });
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bodyOf(index = 0): Record<string, string> {
    const [, options] = fetchMock.mock.calls[index] as [string, RequestInit];
    return JSON.parse(options.body as string) as Record<string, string>;
  }

  describe('resolveBuiltSubscriberPackageVersionId', () => {
    it('prefers the explicit value over the env file', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(`SUBSCRIBER_PACKAGE_VERSION_ID=${OTHER_VERSION_ID}`);
      expect(await resolveBuiltSubscriberPackageVersionId(VERSION_ID)).toBe(VERSION_ID);
    });

    it('reads the env file written by create-package-version', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(`SUBSCRIBER_PACKAGE_VERSION_ID=${VERSION_ID}`);
      expect(await resolveBuiltSubscriberPackageVersionId()).toBe(VERSION_ID);
      expect(fsPromises.readFile).toHaveBeenCalledWith(SUBSCRIBER_PACKAGE_VERSION_ID_FILE, 'utf8');
    });

    it('returns undefined without the env file', async () => {
      expect(await resolveBuiltSubscriberPackageVersionId()).toBeUndefined();
    });

    it('ignores a value in the env file that is not a 04t ID', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue('SUBSCRIBER_PACKAGE_VERSION_ID=');
      expect(await resolveBuiltSubscriberPackageVersionId()).toBeUndefined();
    });
  });

  describe('findPackageVersionTag', () => {
    it('picks the tag at HEAD whose annotation is the 04t ID', async () => {
      mockGit({ tag: () => `v1.4.0.2-other\t${OTHER_VERSION_ID}\nv1.4.0.2-feature\t${VERSION_ID}` });
      expect(await findPackageVersionTag(VERSION_ID)).toBe('v1.4.0.2-feature');
    });

    it('returns undefined when no tag matches', async () => {
      mockGit({ tag: () => `v1.4.0.2\t${OTHER_VERSION_ID}` });
      expect(await findPackageVersionTag(VERSION_ID)).toBeUndefined();
    });
  });

  describe('findPreviousVersionTag', () => {
    it("describes the tag's parent using the project's version tag format", async () => {
      vi.mocked(readSfdxProject).mockResolvedValue({
        packageDirectories: [],
        plugins: { simply: { versionTagFormat: 'release/{MAJOR}.{MINOR}.{PATCH}+{BUILD}' } },
      });
      mockGit({ describe: () => 'release/1.4.0+1' });

      expect(await findPreviousVersionTag('release/1.4.0+2')).toBe('release/1.4.0+1');
      expect(gitCalls('describe')[0]).toEqual([
        'describe',
        '--tags',
        '--abbrev=0',
        '--match',
        'release/*',
        'release/1.4.0+2^',
      ]);
    });

    it('returns undefined for a first version', async () => {
      mockGit({ describe: () => new Error('fatal: No names found') });
      expect(await findPreviousVersionTag('v1.0.0.1')).toBeUndefined();
    });
  });

  describe('getPackageVersionHistory', () => {
    it('unshallows a shallow clone and renders the stories between the tags', async () => {
      mockTaggedRepo();

      const history = await getPackageVersionHistory(VERSION_ID, { debug: false, almProjectKey: 'ABC' });

      expect(gitCalls('fetch')[0]).toEqual(['fetch', '--unshallow', '--tags', '--quiet']);
      expect(gitCalls('log')[0]).toEqual(['log', '--pretty=oneline', 'v1.4.0.1..v1.4.0.2']);
      expect(history).toMatchObject({ versionTag: 'v1.4.0.2', previousVersionTag: 'v1.4.0.1' });
      expect(history.stories).toContain('ABC-12');
      expect(history.stories).toContain('ABC-15');
    });

    it('only fetches tags on a full clone', async () => {
      mockTaggedRepo({ 'rev-parse': () => 'false' });

      await getPackageVersionHistory(VERSION_ID, { debug: false, almProjectKey: 'ABC' });

      expect(gitCalls('fetch')[0]).toEqual(['fetch', '--tags', '--quiet']);
    });

    it('returns N/A for everything when no tag is annotated with the 04t ID', async () => {
      mockTaggedRepo({ tag: () => '' });

      const history = await getPackageVersionHistory(VERSION_ID, { debug: false });

      expect(history).toEqual({ stories: 'N/A', storiesWithUrl: 'N/A', versionTag: 'N/A', previousVersionTag: 'N/A' });
    });

    it('keeps the version tag but no stories for a first version', async () => {
      mockTaggedRepo({ describe: () => new Error('fatal: No names found') });

      const history = await getPackageVersionHistory(VERSION_ID, { debug: false });

      expect(history).toMatchObject({ versionTag: 'v1.4.0.2', previousVersionTag: 'N/A', stories: 'N/A' });
      expect(gitCalls('log')).toHaveLength(0);
    });

    it('returns N/A instead of throwing when the fetch fails', async () => {
      mockTaggedRepo({ fetch: () => new Error('could not read Username') });

      const history = await getPackageVersionHistory(VERSION_ID, { debug: true });

      expect(history.versionTag).toBe('N/A');
    });
  });

  describe('sendBuildNotification', () => {
    const base = {
      teamsWebhookUrl: ['http://mock'],
      ciProjectTitle: 'My Project',
      ciJobName: 'push-scratch',
      ciJobStage: 'build',
      ciCommitRefName: 'main',
      debug: false,
    };

    it('sends a failure card for a failed job without looking for a package version', async () => {
      const result = await sendBuildNotification({ ...base, ciJobStatus: 'failed' });

      expect(result.sent).toBe(true);
      expect(fsPromises.readFile).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
      expect(bodyOf().content).toContain('My Project: Failed Build');
      expect(bodyOf().content).toContain('push-scratch');
      expect(bodyOf()).toMatchObject({ jobName: 'push-scratch', jobStatus: 'failed' });
    });

    it('sends a package version card for a successful job that created one', async () => {
      mockTaggedRepo();

      const result = await sendBuildNotification({
        ...base,
        ciJobStatus: 'success',
        subscriberPackageVersionId: VERSION_ID,
        almProjectKey: 'ABC',
      });

      expect(result.sent).toBe(true);
      const body = bodyOf();
      expect(body.content).toContain('Package Version');
      expect(body.content).toContain('v1.4.0.2');
      expect(body.content).toContain(VERSION_ID);
      expect(body.content).toContain('ABC-12');
      expect(body).toMatchObject({
        packageVersion: 'v1.4.0.2',
        packageVersionPrevious: 'v1.4.0.1',
        subscriberPackageVersionId: VERSION_ID,
      });
    });

    it('sends nothing for a successful job that created no package version', async () => {
      const result = await sendBuildNotification({ ...base, ciJobStatus: 'success' });

      expect(result.sent).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing for a canceled job', async () => {
      const result = await sendBuildNotification({
        ...base,
        ciJobStatus: 'canceled',
        subscriberPackageVersionId: VERSION_ID,
      });

      expect(result.sent).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
