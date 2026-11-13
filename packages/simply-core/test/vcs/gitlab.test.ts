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
import { GitLabProvider } from '../../src/vcs/gitlab.js';

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

describe('GitLabProvider', () => {
  const host = 'gitlab.example.com';
  const apiUrl = `https://${host}/api/v4`;
  const token = 'test-token';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws if the token is missing', () => {
    expect(() => new GitLabProvider({ host, token: '' })).toThrow('GitLab access token is required.');
  });

  it('falls back to gitlab.com when no host is supplied', () => {
    expect(new GitLabProvider({ token }).host).toBe('gitlab.com');
  });

  it('derives the API URL from the host, and the host from an explicit API URL', () => {
    expect(new GitLabProvider({ host, token }).host).toBe(host);
    expect(new GitLabProvider({ token, apiUrl }).host).toBe(host);
  });

  it('paginates listProjects using the X-Next-Page header', async () => {
    /* eslint-disable camelcase -- GitLab API field names */
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1, name: 'proj-1', path_with_namespace: 'group/proj-1' }], {
          headers: { 'X-Next-Page': '2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 2, name: 'proj-2', path_with_namespace: 'group/proj-2' }], { headers: {} }),
      );
    /* eslint-enable camelcase */

    const provider = new GitLabProvider({ host, token });
    const projects = await provider.listProjects('123');

    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({ id: 1, name: 'proj-1', pathWithNamespace: 'group/proj-1' });
    expect(projects[1]).toMatchObject({ id: 2, name: 'proj-2', pathWithNamespace: 'group/proj-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops pagination when a page returns no results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const provider = new GitLabProvider({ host, token });
    const projects = await provider.listProjects('123');

    expect(projects).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('branchExists returns false on a 404 and rethrows other errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse('Not Found', { ok: false, status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse('Server Error', { ok: false, status: 500, statusText: 'Server Error' }));

    const provider = new GitLabProvider({ host, token });

    await expect(provider.branchExists('123', 'missing-branch')).resolves.toBe(false);
    await expect(provider.branchExists('123', 'other-branch')).rejects.toThrow(/GitLab API error: 500/);
  });

  it('throws a formatted error on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse('Unauthorized', { ok: false, status: 401, statusText: 'Unauthorized' }),
    );

    const provider = new GitLabProvider({ host, token });

    await expect(provider.getFileContent('123', 'sfdx-project.json', 'main')).rejects.toThrow(
      'GitLab API error: 401 Unauthorized - Unauthorized',
    );
  });

  it('getProjectVariables swallows errors and returns an empty array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('Forbidden', { ok: false, status: 403, statusText: 'Forbidden' }));

    const provider = new GitLabProvider({ host, token });
    const variables = await provider.getProjectVariables('123');

    expect(variables).toEqual([]);
  });

  it('getProjectVariables normalizes key/value pairs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ key: 'FOO', value: 'bar' }]));

    const provider = new GitLabProvider({ host, token });
    const variables = await provider.getProjectVariables('123');

    expect(variables).toEqual([{ key: 'FOO', value: 'bar', raw: { key: 'FOO', value: 'bar' } }]);
  });

  it('builds merge request URLs under GitLab’s /-/merge_requests/ path', () => {
    const provider = new GitLabProvider({ host, token });

    expect(provider.buildChangeRequestUrl('https://gitlab.com/group/project', 45)).toBe(
      'https://gitlab.com/group/project/-/merge_requests/45',
    );
    // A trailing slash on the project URL shouldn't double up.
    expect(provider.buildChangeRequestUrl('https://gitlab.com/group/project/', '45')).toBe(
      'https://gitlab.com/group/project/-/merge_requests/45',
    );
  });

  it('builds authenticated remote URLs for push/tag and CI-job clone operations', () => {
    const provider = new GitLabProvider({ host, token });

    expect(provider.buildAuthenticatedRemoteUrl('access-token', 'group/project')).toBe(
      `https://oauth2:access-token@${host}/group/project.git`,
    );
    expect(provider.buildCiCloneUrl('ci-job-token', 'group/project')).toBe(
      `https://gitlab-ci-token:ci-job-token@${host}/group/project.git`,
    );
  });

  it('createMergeRequest includes labels only when provided', async () => {
    /* eslint-disable camelcase -- GitLab API field names */
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 1, iid: 1, title: 't', source_branch: 'a', target_branch: 'b' }),
    );
    /* eslint-enable camelcase */

    const provider = new GitLabProvider({ host, token });
    await provider.createMergeRequest('123', 'a', 'b', 't', 'd');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.labels).toBeUndefined();
  });

  it('createMergeRequest removes the source branch by default, and marks a draft with a title prefix', async () => {
    /* eslint-disable camelcase -- GitLab API field names */
    const created = { id: 1, iid: 1, title: 't', source_branch: 'a', target_branch: 'b' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(created))
      .mockResolvedValueOnce(jsonResponse(created))
      .mockResolvedValueOnce(jsonResponse(created));
    const provider = new GitLabProvider({ host, token });
    const bodyOf = (call: number): Record<string, unknown> =>
      JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<string, unknown>;

    await provider.createMergeRequest('123', 'a', 'b', 'Release 2026-10-19', 'd');
    await provider.createMergeRequest('123', 'a', 'b', 'Release 2026-10-19', 'd', undefined, {
      draft: true,
      removeSourceBranch: false,
    });
    await provider.createMergeRequest('123', 'a', 'b', 'Draft: already', 'd', undefined, { draft: true });

    expect(bodyOf(0)).toMatchObject({ title: 'Release 2026-10-19', remove_source_branch: true });
    expect(bodyOf(1)).toMatchObject({ title: 'Draft: Release 2026-10-19', remove_source_branch: false });
    expect(bodyOf(2).title).toBe('Draft: already');
    /* eslint-enable camelcase */
  });

  it('findOpenMergeRequest returns undefined when none are open', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const provider = new GitLabProvider({ host, token });
    const result = await provider.findOpenMergeRequest('123', 'a', 'b');

    expect(result).toBeUndefined();
  });

  it('compareRefs normalizes the commits between two refs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        commits: [
          { id: 'abc123', message: 'fix: ABC-1' },
          { id: 'def456', message: 'chore: bump' },
        ],
      }),
    );

    const provider = new GitLabProvider({ host, token });
    const commits = await provider.compareRefs('123', 'v1.0.0', 'v1.1.0');

    expect(commits).toEqual([
      { sha: 'abc123', message: 'fix: ABC-1', raw: { id: 'abc123', message: 'fix: ABC-1' } },
      { sha: 'def456', message: 'chore: bump', raw: { id: 'def456', message: 'chore: bump' } },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${apiUrl}/projects/123/repository/compare?from=v1.0.0&to=v1.1.0`);
  });

  it('compareRefs returns an empty array when there are no commits', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ commits: [] }));

    const provider = new GitLabProvider({ host, token });
    const commits = await provider.compareRefs('123', 'v1.0.0', 'v1.0.0');

    expect(commits).toEqual([]);
  });

  it('sends PRIVATE-TOKEN by default, and JOB-TOKEN when tokenKind is "job"', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await new GitLabProvider({ host, token }).getProjectVariables('123');
    let [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    let headers = options.headers as Record<string, string>;
    expect(headers['PRIVATE-TOKEN']).toBe(token);
    expect(headers['JOB-TOKEN']).toBeUndefined();

    fetchMock.mockClear();
    await new GitLabProvider({ host, token, tokenKind: 'job' }).getProjectVariables('123');
    [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    headers = options.headers as Record<string, string>;
    expect(headers['JOB-TOKEN']).toBe(token);
    expect(headers['PRIVATE-TOKEN']).toBeUndefined();
  });

  describe('releases and the default branch', () => {
    /* eslint-disable camelcase -- GitLab API field names */
    const selfUrl = 'https://gitlab.example.com/group/proj/-/releases/v1.2.0.13';
    const releaseFixture = { tag_name: 'v1.2.0.13', name: 'v1.2.0', _links: { self: selfUrl } };
    /* eslint-enable camelcase */

    it('findRelease normalizes a release, encoding the tag', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(releaseFixture));

      const release = await new GitLabProvider({ host, token }).findRelease('group/proj', 'v1.2.0.13');

      expect(release).toMatchObject({ tagName: 'v1.2.0.13', name: 'v1.2.0', webUrl: selfUrl });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${apiUrl}/projects/group%2Fproj/releases/v1.2.0.13`);
    });

    it('findRelease returns undefined on a 404, and rethrows anything else', async () => {
      const provider = new GitLabProvider({ host, token });
      fetchMock.mockResolvedValueOnce(
        jsonResponse('404 Not found', { ok: false, status: 404, statusText: 'Not Found' }),
      );
      await expect(provider.findRelease('123', 'v1.2.0.13')).resolves.toBeUndefined();

      fetchMock.mockResolvedValueOnce(jsonResponse('denied', { ok: false, status: 403, statusText: 'Forbidden' }));
      await expect(provider.findRelease('123', 'v1.2.0.13')).rejects.toThrow('403');
    });

    it('createRelease posts the tag and name, and a description only when given', async () => {
      fetchMock.mockResolvedValue(jsonResponse(releaseFixture));
      const provider = new GitLabProvider({ host, token });

      await provider.createRelease('123', { tagName: 'v1.2.0.13', name: 'v1.2.0' });
      const [url, firstOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
      let options = firstOptions;
      expect(url).toBe(`${apiUrl}/projects/123/releases`);
      expect(options.method).toBe('POST');
      // eslint-disable-next-line camelcase -- GitLab API field name
      expect(JSON.parse(options.body as string)).toEqual({ tag_name: 'v1.2.0.13', name: 'v1.2.0' });

      await provider.createRelease('123', { tagName: 'v1.2.0.13', name: 'v1.2.0', description: 'notes' });
      [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toMatchObject({ description: 'notes' });
    });

    it('setDefaultBranch puts default_branch on the project', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 123 }));

      await new GitLabProvider({ host, token }).setDefaultBranch('123', 'release/v1.3.0');

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiUrl}/projects/123`);
      expect(options.method).toBe('PUT');
      // eslint-disable-next-line camelcase -- GitLab API field name
      expect(JSON.parse(options.body as string)).toEqual({ default_branch: 'release/v1.3.0' });
    });

    it('never puts the token in an error message', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse('boom', { ok: false, status: 500, statusText: 'Server Error' }));

      const error = await new GitLabProvider({ host, token })
        .setDefaultBranch('123', 'release/v1.3.0')
        .catch((caught: unknown) => caught as Error);

      expect((error as Error).message).not.toContain(token);
    });
  });
});
