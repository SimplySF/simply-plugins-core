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
import { GitHubProvider } from '../../src/vcs/github.js';

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers(init.headers ?? {});
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/* eslint-disable camelcase -- GitHub API field names */
const repoFixture = {
  id: 42,
  name: 'downstream',
  full_name: 'my-org/downstream',
  default_branch: 'main',
  archived: false,
  size: 120,
  fork: false,
};

const pullRequestFixture = {
  id: 900,
  number: 7,
  title: 'chore: bump',
  body: 'description',
  head: { ref: 'devops/dependabot' },
  base: { ref: 'main' },
  html_url: 'https://github.com/my-org/downstream/pull/7',
};
/* eslint-enable camelcase */

describe('GitHubProvider', () => {
  const host = 'github.com';
  const token = 'test-token';
  const project = { key: 'my-org/downstream' };
  let fetchMock: ReturnType<typeof vi.fn>;

  function lastCall(index = 0): { url: string; options: RequestInit } {
    const [url, options] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, options };
  }

  function bodyOf(index = 0): Record<string, unknown> {
    return JSON.parse(lastCall(index).options.body as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws if the token is missing', () => {
    expect(() => new GitHubProvider({ host, token: '' })).toThrow('GitHub access token is required.');
  });

  it('falls back to github.com when no host is supplied', () => {
    expect(new GitHubProvider({ token }).host).toBe('github.com');
  });

  it('uses api.github.com for github.com and /api/v3 for Enterprise Server', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await new GitHubProvider({ host, token }).listProjects('my-org');
    expect(lastCall().url).toBe('https://api.github.com/orgs/my-org/repos?per_page=100');

    fetchMock.mockClear();
    await new GitHubProvider({ host: 'github.example.com', token }).listProjects('my-org');
    expect(lastCall().url).toBe('https://github.example.com/api/v3/orgs/my-org/repos?per_page=100');
  });

  it('sends the documented auth and API-version headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await new GitHubProvider({ host, token }).listProjects('my-org');

    const headers = lastCall().options.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('paginates listProjects by following the Link header', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([repoFixture], {
          headers: { Link: '<https://api.github.com/orgs/my-org/repos?per_page=100&page=2>; rel="next"' },
        }),
      )
      // eslint-disable-next-line camelcase -- GitHub API field names
      .mockResolvedValueOnce(jsonResponse([{ ...repoFixture, id: 43, full_name: 'my-org/other' }]));

    const projects = await new GitHubProvider({ host, token }).listProjects('my-org');

    expect(projects).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastCall(1).url).toBe('https://api.github.com/orgs/my-org/repos?per_page=100&page=2');
  });

  it('normalizes a repo, deriving key/pathWithNamespace from full_name and empty from size', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...repoFixture, size: 0, fork: true, archived: true }]));

    const [normalized] = await new GitHubProvider({ host, token }).listProjects('my-org');

    expect(normalized).toMatchObject({
      id: 42,
      key: 'my-org/downstream',
      name: 'downstream',
      pathWithNamespace: 'my-org/downstream',
      defaultBranch: 'main',
      archived: true,
      empty: true,
      isFork: true,
    });
  });

  it('rejects a project reference that is not owner/repo', async () => {
    const provider = new GitHubProvider({ host, token });

    await expect(provider.getFileContent('downstream', 'sfdx-project.json', 'main')).rejects.toThrow(
      'Invalid GitHub repository "downstream". Expected "owner/repo".',
    );
  });

  it('getFileContent requests the raw media type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('{ "packageDirectories": [] }'));

    const content = await new GitHubProvider({ host, token }).getFileContent(project, 'sfdx-project.json', 'main');

    expect(content).toBe('{ "packageDirectories": [] }');
    expect(lastCall().url).toBe('https://api.github.com/repos/my-org/downstream/contents/sfdx-project.json?ref=main');
    expect((lastCall().options.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw');
  });

  it('branchExists returns false on a 404 and rethrows other errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse('Not Found', { ok: false, status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse('Server Error', { ok: false, status: 500, statusText: 'Server Error' }));

    const provider = new GitHubProvider({ host, token });

    await expect(provider.branchExists(project, 'missing')).resolves.toBe(false);
    await expect(provider.branchExists(project, 'other')).rejects.toThrow(/GitHub API error: 500/);
  });

  it('createBranch resolves the source SHA first, then posts a ref', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'abc123' } }))
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/new-branch' }));

    const branch = await new GitHubProvider({ host, token }).createBranch(project, 'new-branch', 'main');

    expect(branch.name).toBe('new-branch');
    expect(lastCall(0).url).toBe('https://api.github.com/repos/my-org/downstream/git/ref/heads/main');
    expect(lastCall(1).url).toBe('https://api.github.com/repos/my-org/downstream/git/refs');
    expect(bodyOf(1)).toEqual({ ref: 'refs/heads/new-branch', sha: 'abc123' });
  });

  it('commitFile looks up the blob SHA and base64-encodes the content', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-sha' }))
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'commit-sha' } }));

    const result = await new GitHubProvider({ host, token }).commitFile(
      project,
      'feature',
      'chore: bump',
      'sfdx-project.json',
      '{"a":1}',
    );

    expect(result.id).toBe('commit-sha');
    expect(bodyOf(1)).toEqual({
      message: 'chore: bump',
      content: Buffer.from('{"a":1}', 'utf8').toString('base64'),
      branch: 'feature',
      sha: 'blob-sha',
    });
  });

  it('findOpenMergeRequest scopes head to the owner and normalizes number to iid', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([pullRequestFixture]));

    const found = await new GitHubProvider({ host, token }).findOpenMergeRequest(project, 'devops/dependabot', 'main');

    expect(found).toMatchObject({
      id: 900,
      iid: 7,
      sourceBranch: 'devops/dependabot',
      targetBranch: 'main',
      webUrl: 'https://github.com/my-org/downstream/pull/7',
    });
    expect(lastCall().url).toContain(`head=${encodeURIComponent('my-org:devops/dependabot')}`);
    expect(lastCall().url).toContain('base=main');
  });

  it('findOpenMergeRequest returns undefined when none are open', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const result = await new GitHubProvider({ host, token }).findOpenMergeRequest(project, 'a', 'b');

    expect(result).toBeUndefined();
  });

  it('createMergeRequest omits the label call when no labels are given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pullRequestFixture));

    await new GitHubProvider({ host, token }).createMergeRequest(project, 'a', 'b', 'title', 'desc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toEqual({ title: 'title', body: 'desc', head: 'a', base: 'b' });
  });

  it('createMergeRequest opens a draft pull request when asked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pullRequestFixture));

    await new GitHubProvider({ host, token }).createMergeRequest(project, 'a', 'b', 'title', 'desc', undefined, {
      draft: true,
      removeSourceBranch: false,
    });

    expect(bodyOf(0)).toEqual({ title: 'title', body: 'desc', head: 'a', base: 'b', draft: true });
  });

  it('createMergeRequest posts labels to the backing issue when given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pullRequestFixture)).mockResolvedValueOnce(jsonResponse([]));

    await new GitHubProvider({ host, token }).createMergeRequest(project, 'a', 'b', 'title', 'desc', [
      'dependencies',
      'automated',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastCall(1).url).toBe('https://api.github.com/repos/my-org/downstream/issues/7/labels');
    expect(lastCall(1).options.method).toBe('POST');
    expect(bodyOf(1)).toEqual({ labels: ['dependencies', 'automated'] });
  });

  it('updateMergeRequest patches by iid and replaces labels with PUT', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pullRequestFixture)).mockResolvedValueOnce(jsonResponse([]));

    const mergeRequest = {
      id: 900,
      iid: 7,
      title: 'old',
      sourceBranch: 'a',
      targetBranch: 'b',
      raw: {},
    };

    await new GitHubProvider({ host, token }).updateMergeRequest(project, mergeRequest, 'new title', 'new desc', [
      'dependencies',
    ]);

    expect(lastCall(0).url).toBe('https://api.github.com/repos/my-org/downstream/pulls/7');
    expect(bodyOf(0)).toEqual({ title: 'new title', body: 'new desc' });
    expect(lastCall(1).options.method).toBe('PUT');
    expect(bodyOf(1)).toEqual({ labels: ['dependencies'] });
  });

  it('getProjectVariables normalizes name to key and swallows permission errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ variables: [{ name: 'SFDX_DEPENDABOT_ENABLED', value: 'TRUE' }] }));

    const provider = new GitHubProvider({ host, token });
    await expect(provider.getProjectVariables(project)).resolves.toEqual([
      {
        key: 'SFDX_DEPENDABOT_ENABLED',
        value: 'TRUE',
        raw: { name: 'SFDX_DEPENDABOT_ENABLED', value: 'TRUE' },
      },
    ]);

    fetchMock.mockResolvedValueOnce(jsonResponse('Forbidden', { ok: false, status: 403, statusText: 'Forbidden' }));
    await expect(provider.getProjectVariables(project)).resolves.toEqual([]);
  });

  it('builds pull request URLs under GitHub’s /pull/ path', () => {
    const provider = new GitHubProvider({ host, token });

    expect(provider.buildChangeRequestUrl('https://github.com/my-org/downstream', 45)).toBe(
      'https://github.com/my-org/downstream/pull/45',
    );
    expect(provider.buildChangeRequestUrl('https://github.com/my-org/downstream/', '45')).toBe(
      'https://github.com/my-org/downstream/pull/45',
    );
  });

  it('builds x-access-token remote URLs for push/tag and clone operations', () => {
    const provider = new GitHubProvider({ host, token });

    expect(provider.buildAuthenticatedRemoteUrl('access-token', 'my-org/downstream')).toBe(
      'https://x-access-token:access-token@github.com/my-org/downstream.git',
    );
    expect(provider.buildCiCloneUrl('ci-token', 'my-org/downstream')).toBe(
      'https://x-access-token:ci-token@github.com/my-org/downstream.git',
    );
  });

  it('reads CI context from the GitHub Actions environment', () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'my-org/upstream');
    vi.stubEnv('GITHUB_REPOSITORY_ID', '12345');

    expect(new GitHubProvider({ host, token }).getCiContext()).toEqual({
      projectPath: 'my-org/upstream',
      projectId: '12345',
    });

    vi.unstubAllEnvs();
  });

  it('exposes GitHub vocabulary for user-facing text', () => {
    const provider = new GitHubProvider({ host, token });

    expect(provider.kind).toBe('github');
    expect(provider.terminology.changeRequest).toBe('pull request');
    expect(provider.terminology.changeRequestShort).toBe('PR');
  });

  it('compareRefs normalizes the commits between two refs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        commits: [
          { sha: 'abc123', commit: { message: 'fix: ABC-1' } },
          { sha: 'def456', commit: { message: 'chore: bump' } },
        ],
      }),
    );

    const provider = new GitHubProvider({ host, token });
    const commits = await provider.compareRefs(project, 'v1.0.0', 'v1.1.0');

    expect(commits).toEqual([
      { sha: 'abc123', message: 'fix: ABC-1', raw: { sha: 'abc123', commit: { message: 'fix: ABC-1' } } },
      { sha: 'def456', message: 'chore: bump', raw: { sha: 'def456', commit: { message: 'chore: bump' } } },
    ]);
    expect(lastCall().url).toBe('https://api.github.com/repos/my-org/downstream/compare/v1.0.0...v1.1.0');
  });

  it('compareRefs returns an empty array when there are no commits', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ commits: [] }));

    const provider = new GitHubProvider({ host, token });
    const commits = await provider.compareRefs(project, 'v1.0.0', 'v1.0.0');

    expect(commits).toEqual([]);
  });

  describe('releases and the default branch', () => {
    /* eslint-disable camelcase -- GitHub API field names */
    const releaseFixture = {
      tag_name: 'v1.2.0.13',
      name: 'v1.2.0',
      html_url: 'https://github.com/my-org/downstream/releases/tag/v1.2.0.13',
    };
    /* eslint-enable camelcase */

    it('findRelease looks the release up by tag', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(releaseFixture));

      const release = await new GitHubProvider({ host, token }).findRelease(project, 'v1.2.0.13');

      expect(release).toMatchObject({ tagName: 'v1.2.0.13', name: 'v1.2.0', webUrl: releaseFixture.html_url });
      expect(lastCall().url).toBe('https://api.github.com/repos/my-org/downstream/releases/tags/v1.2.0.13');
    });

    it('findRelease returns undefined on a 404', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse('Not Found', { ok: false, status: 404, statusText: 'Not Found' }));

      await expect(new GitHubProvider({ host, token }).findRelease(project, 'v9.9.9.1')).resolves.toBeUndefined();
    });

    it('falls back to the tag when a release has no name', async () => {
      // eslint-disable-next-line camelcase -- GitHub API field name
      fetchMock.mockResolvedValueOnce(jsonResponse({ tag_name: 'v1.2.0.13', name: null }));

      const release = await new GitHubProvider({ host, token }).findRelease(project, 'v1.2.0.13');

      expect(release?.name).toBe('v1.2.0.13');
    });

    it('createRelease posts the tag and name, sending a description as body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(releaseFixture));

      await new GitHubProvider({ host, token }).createRelease(project, {
        tagName: 'v1.2.0.13',
        name: 'v1.2.0',
        description: 'notes',
      });

      expect(lastCall().url).toBe('https://api.github.com/repos/my-org/downstream/releases');
      expect(lastCall().options.method).toBe('POST');
      // eslint-disable-next-line camelcase -- GitHub API field name
      expect(bodyOf()).toEqual({ tag_name: 'v1.2.0.13', name: 'v1.2.0', body: 'notes' });
    });

    it('setDefaultBranch patches default_branch on the repo', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(repoFixture));

      await new GitHubProvider({ host, token }).setDefaultBranch(project, 'release/v1.3.0');

      expect(lastCall().url).toBe('https://api.github.com/repos/my-org/downstream');
      expect(lastCall().options.method).toBe('PATCH');
      // eslint-disable-next-line camelcase -- GitHub API field name
      expect(bodyOf()).toEqual({ default_branch: 'release/v1.3.0' });
    });
  });
});
