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

import type {
  VcsBranch,
  VcsCiContext,
  VcsCommit,
  VcsCommitLogEntry,
  VcsMergeRequest,
  VcsMergeRequestOptions,
  VcsProject,
  VcsProjectRef,
  VcsProjectVariable,
  VcsProvider,
  VcsRelease,
  VcsReleaseInput,
  VcsProviderOptions,
  VcsTerminology,
} from './types.js';

type GitHubRepoResponse = {
  id: number;
  name: string;
  full_name: string;
  default_branch?: string;
  archived?: boolean;
  size?: number;
  fork?: boolean;
};

type GitHubPullRequestResponse = {
  id: number;
  number: number;
  title: string;
  body?: string;
  head: { ref: string };
  base: { ref: string };
  html_url?: string;
};

type GitHubVariableResponse = { name: string; value: string };

type GitHubContentResponse = { sha: string };

type GitHubReleaseResponse = { tag_name: string; name: string | null; html_url?: string };

type GitHubRefResponse = { object: { sha: string } };

type GitHubCommitResponse = { sha: string; commit: { message: string } };

type GitHubCompareResponse = { commits: GitHubCommitResponse[] };

function normalizeProject(repo: GitHubRepoResponse): VcsProject {
  return {
    id: repo.id,
    key: repo.full_name,
    name: repo.name,
    pathWithNamespace: repo.full_name,
    defaultBranch: repo.default_branch,
    archived: Boolean(repo.archived),
    // GitHub has no `empty_repo` flag; a repo with no commits reports a zero size.
    empty: repo.size === 0,
    isFork: repo.fork === true,
    raw: repo,
  };
}

function normalizePullRequest(pullRequest: GitHubPullRequestResponse): VcsMergeRequest {
  return {
    id: pullRequest.id,
    // GitHub's per-pull-request endpoints take the repo-scoped `number`.
    iid: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.body,
    sourceBranch: pullRequest.head.ref,
    targetBranch: pullRequest.base.ref,
    webUrl: pullRequest.html_url,
    raw: pullRequest,
  };
}

/** GitHub addresses repos as `owner/repo`, so each segment is encoded separately. */
function splitProject(project: VcsProjectRef): { owner: string; repo: string } {
  const key = typeof project === 'object' ? project.key : String(project);
  const [owner, repo] = key.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository "${key}". Expected "owner/repo".`);
  }
  return { owner: encodeURIComponent(owner), repo: encodeURIComponent(repo) };
}

function normalizeRelease(release: GitHubReleaseResponse): VcsRelease {
  return { tagName: release.tag_name, name: release.name ?? release.tag_name, webUrl: release.html_url, raw: release };
}

function repoPath(project: VcsProjectRef): string {
  const { owner, repo } = splitProject(project);
  return `/repos/${owner}/${repo}`;
}

/** Encodes a file path for the contents API, preserving its directory separators. */
function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

/** Extracts the `rel="next"` URL from a Link header, if present. */
function nextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }
  for (const part of linkHeader.split(',')) {
    const match = /<(?<url>[^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.groups?.url) {
      return match.groups.url;
    }
  }
  return undefined;
}

/** A `VcsProvider` implementation for GitHub, backed by the GitHub REST API. */
export class GitHubProvider implements VcsProvider {
  /** Used when no `--vcs-host` is supplied, so selecting a provider is enough to reach its SaaS instance. */
  public static readonly defaultHost = 'github.com';

  public readonly kind = 'github' as const;

  public readonly terminology: VcsTerminology = {
    changeRequest: 'pull request',
    changeRequestShort: 'PR',
    projectVariable: 'GitHub Actions variable',
  };

  public readonly host: string;

  public readonly apiUrl: string;
  private readonly token: string;

  public constructor(options: VcsProviderOptions) {
    const { host, token, apiUrl } = options;
    if (!token) {
      throw new Error('GitHub access token is required.');
    }
    const resolvedHost = host ?? GitHubProvider.defaultHost;
    // github.com serves its API from a dedicated hostname; GitHub Enterprise Server serves it
    // from /api/v3 on the instance itself.
    const derived =
      resolvedHost === GitHubProvider.defaultHost ? 'https://api.github.com' : `https://${resolvedHost}/api/v3`;
    this.apiUrl = (apiUrl ?? derived).replace(/\/+$/, '');
    this.host = resolvedHost;
    this.token = token;
  }

  // eslint-disable-next-line class-methods-use-this -- part of the VcsProvider instance contract; GitHub Actions variables are process-global
  public getCiContext(): VcsCiContext {
    return {
      projectPath: process.env.GITHUB_REPOSITORY,
      projectId: process.env.GITHUB_REPOSITORY_ID,
    };
  }

  public async listProjects(orgId: string | number): Promise<VcsProject[]> {
    const repos: GitHubRepoResponse[] = [];
    // GitHub orgs are flat, so there is no subgroup recursion to do here.
    let endpoint: string | undefined = `/orgs/${encodeURIComponent(orgId)}/repos?per_page=100`;

    while (endpoint) {
      // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential (the next URL comes from this page's Link header)
      const response = await this.request(endpoint);
      // eslint-disable-next-line no-await-in-loop
      const data = (await response.json()) as GitHubRepoResponse[];

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      repos.push(...data);
      endpoint = nextLink(response.headers.get('Link'));
    }

    return repos.map(normalizeProject);
  }

  public async getFileContent(project: VcsProjectRef, filePath: string, ref: string): Promise<string> {
    const endpoint = `${repoPath(project)}/contents/${encodeFilePath(filePath)}?ref=${encodeURIComponent(ref)}`;
    const response = await this.request(endpoint, { headers: { Accept: 'application/vnd.github.raw' } });
    return response.text();
  }

  public async compareRefs(project: VcsProjectRef, from: string, to: string): Promise<VcsCommitLogEntry[]> {
    const endpoint = `${repoPath(project)}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;
    const response = (await this.getJson(endpoint)) as GitHubCompareResponse;
    return (response.commits ?? []).map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      raw: commit,
    }));
  }

  public async branchExists(project: VcsProjectRef, branchName: string): Promise<boolean> {
    const endpoint = `${repoPath(project)}/branches/${encodeURIComponent(branchName)}`;
    try {
      await this.request(endpoint, { method: 'GET' });
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('404')) {
        return false;
      }
      throw err;
    }
  }

  public async createBranch(project: VcsProjectRef, branchName: string, ref: string): Promise<VcsBranch> {
    // GitHub creates refs by SHA, so the source branch has to be resolved first.
    const sourceRef = (await this.getJson(
      `${repoPath(project)}/git/ref/heads/${encodeURIComponent(ref)}`,
    )) as GitHubRefResponse;

    const response = await this.request(`${repoPath(project)}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branchName}`, sha: sourceRef.object.sha },
    });
    const raw: unknown = await response.json();
    return { name: branchName, raw };
  }

  public async commitFile(
    project: VcsProjectRef,
    branchName: string,
    commitMessage: string,
    filePath: string,
    content: string,
  ): Promise<VcsCommit> {
    const encodedPath = encodeFilePath(filePath);
    // Updating an existing file through the contents API requires its current blob SHA.
    const existing = (await this.getJson(
      `${repoPath(project)}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
    )) as GitHubContentResponse;

    const response = await this.request(`${repoPath(project)}/contents/${encodedPath}`, {
      method: 'PUT',
      body: {
        message: commitMessage,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: branchName,
        sha: existing.sha,
      },
    });
    const raw = (await response.json()) as { commit?: { sha?: string } };
    return { id: raw.commit?.sha, raw };
  }

  public async findOpenMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<VcsMergeRequest | undefined> {
    const { owner } = splitProject(project);
    const head = `${owner}:${sourceBranch}`;
    const endpoint = `${repoPath(project)}/pulls?state=open&head=${encodeURIComponent(
      head,
    )}&base=${encodeURIComponent(targetBranch)}`;
    const pullRequests = (await this.getJson(endpoint)) as GitHubPullRequestResponse[];
    return pullRequests.length > 0 ? normalizePullRequest(pullRequests[0]) : undefined;
  }

  public async createMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
    labels?: string[],
    options: VcsMergeRequestOptions = {},
  ): Promise<VcsMergeRequest> {
    // GitLab's `remove_source_branch` has no per-pull-request equivalent here; branch cleanup is
    // the repo-level `delete_branch_on_merge` setting, so `options.removeSourceBranch` is ignored.
    const response = await this.request(`${repoPath(project)}/pulls`, {
      method: 'POST',
      body: {
        title,
        body: description,
        head: sourceBranch,
        base: targetBranch,
        ...(options.draft ? { draft: true } : {}),
      },
    });
    const pullRequest = normalizePullRequest((await response.json()) as GitHubPullRequestResponse);

    if (labels?.length) {
      // Labels live on the issue that backs the pull request, not on the pull request itself.
      await this.request(`${repoPath(project)}/issues/${pullRequest.iid}/labels`, {
        method: 'POST',
        body: { labels },
      });
    }

    return pullRequest;
  }

  public async updateMergeRequest(
    project: VcsProjectRef,
    mergeRequest: VcsMergeRequest,
    title: string,
    description: string,
    labels?: string[],
  ): Promise<VcsMergeRequest> {
    const response = await this.request(`${repoPath(project)}/pulls/${mergeRequest.iid}`, {
      method: 'PUT',
      body: { title, body: description },
    });
    const updated = normalizePullRequest((await response.json()) as GitHubPullRequestResponse);

    if (labels?.length) {
      // PUT replaces the label set, matching GitLab's update-with-labels semantics.
      await this.request(`${repoPath(project)}/issues/${updated.iid}/labels`, {
        method: 'PUT',
        body: { labels },
      });
    }

    return updated;
  }

  public async getProjectVariables(project: VcsProjectRef): Promise<VcsProjectVariable[]> {
    try {
      const result = (await this.getJson(`${repoPath(project)}/actions/variables`)) as {
        variables?: GitHubVariableResponse[];
      };
      return (result.variables ?? []).map((variable) => ({
        key: variable.name,
        value: variable.value,
        raw: variable,
      }));
    } catch {
      // If we don't have permission to read variables, treat it as "no variables".
      return [];
    }
  }

  public async findRelease(project: VcsProjectRef, tagName: string): Promise<VcsRelease | undefined> {
    const endpoint = `${repoPath(project)}/releases/tags/${encodeURIComponent(tagName)}`;
    try {
      return normalizeRelease((await this.getJson(endpoint)) as GitHubReleaseResponse);
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('404')) {
        return undefined;
      }
      throw err;
    }
  }

  public async createRelease(project: VcsProjectRef, release: VcsReleaseInput): Promise<VcsRelease> {
    // GitHub would create a missing tag from the default branch, so callers must check the tag exists first.
    /* eslint-disable camelcase -- GitHub API field names */
    const body: Record<string, unknown> = { tag_name: release.tagName, name: release.name };
    /* eslint-enable camelcase */
    if (release.description !== undefined) {
      body.body = release.description;
    }
    const response = await this.request(`${repoPath(project)}/releases`, { method: 'POST', body });
    return normalizeRelease((await response.json()) as GitHubReleaseResponse);
  }

  public async setDefaultBranch(project: VcsProjectRef, branchName: string): Promise<void> {
    // eslint-disable-next-line camelcase -- GitHub API field name
    await this.request(repoPath(project), { method: 'PATCH', body: { default_branch: branchName } });
  }

  // eslint-disable-next-line class-methods-use-this -- part of the VcsProvider instance contract; the path scheme needs no instance state
  public buildChangeRequestUrl(projectUrl: string, changeRequestIid: string | number): string {
    return `${projectUrl.replace(/\/+$/, '')}/pull/${changeRequestIid}`;
  }

  public buildAuthenticatedRemoteUrl(token: string, projectPath: string): string {
    return `https://x-access-token:${token}@${this.host}/${projectPath}.git`;
  }

  public buildCiCloneUrl(ciJobToken: string, projectPath: string): string {
    // GitHub has no separate job token; Actions hands the workflow a GITHUB_TOKEN that
    // authenticates the same way.
    return `https://x-access-token:${ciJobToken}@${this.host}/${projectPath}.git`;
  }

  private async request(
    endpoint: string,
    options: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
  ): Promise<Response> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private async getJson(endpoint: string): Promise<unknown> {
    const response = await this.request(endpoint);
    return response.json();
  }
}
