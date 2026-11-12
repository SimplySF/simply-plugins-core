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
  VcsProject,
  VcsProjectRef,
  VcsProjectVariable,
  VcsProvider,
  VcsRelease,
  VcsReleaseInput,
  VcsProviderOptions,
  VcsTerminology,
} from './types.js';

type GitLabProjectResponse = {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch?: string;
  archived?: boolean;
  empty_repo?: boolean;
  forked_from_project?: unknown;
  fork?: boolean;
};

type GitLabMergeRequestResponse = {
  id: number;
  iid: number;
  title: string;
  description?: string;
  source_branch: string;
  target_branch: string;
  web_url?: string;
};

type GitLabProjectVariableResponse = {
  key: string;
  value: string;
};

type GitLabReleaseResponse = {
  tag_name: string;
  name: string;
  _links?: { self?: string };
};

type GitLabCommitResponse = {
  id: string;
  message: string;
};

type GitLabCompareResponse = {
  commits: GitLabCommitResponse[];
};

function normalizeProject(project: GitLabProjectResponse): VcsProject {
  return {
    id: project.id,
    key: String(project.id),
    name: project.name,
    pathWithNamespace: project.path_with_namespace,
    defaultBranch: project.default_branch,
    archived: Boolean(project.archived),
    empty: Boolean(project.empty_repo),
    isFork: Boolean(project.forked_from_project) || project.fork === true,
    raw: project,
  };
}

function normalizeMergeRequest(mergeRequest: GitLabMergeRequestResponse): VcsMergeRequest {
  return {
    id: mergeRequest.id,
    iid: mergeRequest.iid,
    title: mergeRequest.title,
    description: mergeRequest.description,
    sourceBranch: mergeRequest.source_branch,
    targetBranch: mergeRequest.target_branch,
    webUrl: mergeRequest.web_url,
    raw: mergeRequest,
  };
}

function normalizeRelease(release: GitLabReleaseResponse): VcsRelease {
  // eslint-disable-next-line no-underscore-dangle -- GitLab API field name
  return { tagName: release.tag_name, name: release.name, webUrl: release._links?.self, raw: release };
}

/** GitLab addresses projects by numeric ID or URL-encoded path; both arrive here already usable. */
function projectSegment(project: VcsProjectRef): string {
  const key = typeof project === 'object' ? project.key : String(project);
  return encodeURIComponent(key);
}

/** A `VcsProvider` implementation for GitLab, backed by the GitLab REST API v4. */
export class GitLabProvider implements VcsProvider {
  /** Used when no `--vcs-host` is supplied, so selecting a provider is enough to reach its SaaS instance. */
  public static readonly defaultHost = 'gitlab.com';

  public readonly kind = 'gitlab' as const;

  public readonly terminology: VcsTerminology = {
    changeRequest: 'merge request',
    changeRequestShort: 'MR',
    projectVariable: 'GitLab CI/CD variable',
  };

  public readonly host: string;

  public readonly apiUrl: string;
  private readonly token: string;
  private readonly tokenKind: 'personal' | 'job';

  public constructor(options: VcsProviderOptions) {
    const { host, token, apiUrl, tokenKind } = options;
    if (!token) {
      throw new Error('GitLab access token is required.');
    }
    this.apiUrl = (apiUrl ?? `https://${host ?? GitLabProvider.defaultHost}/api/v4`).replace(/\/+$/, '');
    // When only an API URL is supplied (the dependabot path), recover the host from it so the
    // remote-URL builders stay usable.
    this.host = host ?? new URL(this.apiUrl).host;
    this.token = token;
    this.tokenKind = tokenKind ?? 'personal';
  }

  // eslint-disable-next-line class-methods-use-this -- part of the VcsProvider instance contract; GitLab's CI variables are process-global
  public getCiContext(): VcsCiContext {
    return {
      projectPath: process.env.CI_PROJECT_PATH,
      projectId: process.env.CI_PROJECT_ID,
    };
  }

  public async listProjects(groupId: string | number): Promise<VcsProject[]> {
    let projects: GitLabProjectResponse[] = [];
    let page = 1;
    let hasMore = true;
    const encodedGroupId = encodeURIComponent(groupId);

    while (hasMore) {
      const endpoint = `/groups/${encodedGroupId}/projects?include_subgroups=true&per_page=100&page=${page}`;
      // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential (next page depends on this one's headers)
      const response = await this.request(endpoint);
      // eslint-disable-next-line no-await-in-loop
      const data = (await response.json()) as GitLabProjectResponse[];

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      projects = projects.concat(data);

      const nextPageHeader = response.headers.get('X-Next-Page');
      if (nextPageHeader) {
        const nextPageNum = Number(nextPageHeader);
        if (nextPageNum && nextPageNum > page) {
          page = nextPageNum;
        } else {
          hasMore = false;
        }
      } else if (data.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return projects.map(normalizeProject);
  }

  public async getFileContent(project: VcsProjectRef, filePath: string, ref: string): Promise<string> {
    const encodedFilePath = encodeURIComponent(filePath);
    const endpoint = `/projects/${projectSegment(project)}/repository/files/${encodedFilePath}/raw?ref=${encodeURIComponent(
      ref,
    )}`;
    return this.getRawText(endpoint);
  }

  public async compareRefs(project: VcsProjectRef, from: string, to: string): Promise<VcsCommitLogEntry[]> {
    const endpoint = `/projects/${projectSegment(project)}/repository/compare?from=${encodeURIComponent(
      from,
    )}&to=${encodeURIComponent(to)}`;
    const response = (await this.getJson(endpoint)) as GitLabCompareResponse;
    return (response.commits ?? []).map((commit) => ({ sha: commit.id, message: commit.message, raw: commit }));
  }

  public async branchExists(project: VcsProjectRef, branchName: string): Promise<boolean> {
    const encodedBranch = encodeURIComponent(branchName);
    const endpoint = `/projects/${projectSegment(project)}/repository/branches/${encodedBranch}`;
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
    const endpoint = `/projects/${projectSegment(project)}/repository/branches`;
    const response = await this.request(endpoint, {
      method: 'POST',
      body: { branch: branchName, ref },
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
    const endpoint = `/projects/${projectSegment(project)}/repository/commits`;
    /* eslint-disable camelcase -- GitLab API field names */
    const response = await this.request(endpoint, {
      method: 'POST',
      body: {
        branch: branchName,
        commit_message: commitMessage,
        actions: [{ action: 'update', file_path: filePath, content }],
      },
    });
    /* eslint-enable camelcase */
    const raw = (await response.json()) as { id?: string };
    return { id: raw.id, raw };
  }

  public async findOpenMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<VcsMergeRequest | undefined> {
    const endpoint = `/projects/${projectSegment(
      project,
    )}/merge_requests?state=opened&source_branch=${encodeURIComponent(
      sourceBranch,
    )}&target_branch=${encodeURIComponent(targetBranch)}`;
    const mergeRequests = (await this.getJson(endpoint)) as GitLabMergeRequestResponse[];
    return mergeRequests.length > 0 ? normalizeMergeRequest(mergeRequests[0]) : undefined;
  }

  public async createMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
    labels?: string[],
  ): Promise<VcsMergeRequest> {
    const endpoint = `/projects/${projectSegment(project)}/merge_requests`;
    /* eslint-disable camelcase -- GitLab API field names */
    const body: Record<string, unknown> = {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description,
      remove_source_branch: true,
    };
    /* eslint-enable camelcase */
    if (labels?.length) {
      body.labels = labels.join(',');
    }
    const response = await this.request(endpoint, { method: 'POST', body });
    return normalizeMergeRequest((await response.json()) as GitLabMergeRequestResponse);
  }

  public async updateMergeRequest(
    project: VcsProjectRef,
    mergeRequest: VcsMergeRequest,
    title: string,
    description: string,
    labels?: string[],
  ): Promise<VcsMergeRequest> {
    // GitLab's per-merge-request endpoints take the project-scoped `iid`, not the global `id`.
    const endpoint = `/projects/${projectSegment(project)}/merge_requests/${mergeRequest.iid}`;
    const body: Record<string, unknown> = { title, description };
    if (labels?.length) {
      body.labels = labels.join(',');
    }
    const response = await this.request(endpoint, { method: 'PUT', body });
    return normalizeMergeRequest((await response.json()) as GitLabMergeRequestResponse);
  }

  public async getProjectVariables(project: VcsProjectRef): Promise<VcsProjectVariable[]> {
    try {
      const variables = (await this.getJson(
        `/projects/${projectSegment(project)}/variables`,
      )) as GitLabProjectVariableResponse[];
      return variables.map((variable) => ({ key: variable.key, value: variable.value, raw: variable }));
    } catch {
      // If we don't have permission to read variables, treat it as "no variables".
      return [];
    }
  }

  public async findRelease(project: VcsProjectRef, tagName: string): Promise<VcsRelease | undefined> {
    const endpoint = `/projects/${projectSegment(project)}/releases/${encodeURIComponent(tagName)}`;
    try {
      return normalizeRelease((await this.getJson(endpoint)) as GitLabReleaseResponse);
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('404')) {
        return undefined;
      }
      throw err;
    }
  }

  public async createRelease(project: VcsProjectRef, release: VcsReleaseInput): Promise<VcsRelease> {
    const endpoint = `/projects/${projectSegment(project)}/releases`;
    /* eslint-disable camelcase -- GitLab API field names */
    const body: Record<string, unknown> = { tag_name: release.tagName, name: release.name };
    /* eslint-enable camelcase */
    if (release.description !== undefined) {
      body.description = release.description;
    }
    const response = await this.request(endpoint, { method: 'POST', body });
    return normalizeRelease((await response.json()) as GitLabReleaseResponse);
  }

  public async setDefaultBranch(project: VcsProjectRef, branchName: string): Promise<void> {
    // eslint-disable-next-line camelcase -- GitLab API field name
    await this.request(`/projects/${projectSegment(project)}`, { method: 'PUT', body: { default_branch: branchName } });
  }

  // eslint-disable-next-line class-methods-use-this -- part of the VcsProvider instance contract; the path scheme needs no instance state
  public buildChangeRequestUrl(projectUrl: string, changeRequestIid: string | number): string {
    return `${projectUrl.replace(/\/+$/, '')}/-/merge_requests/${changeRequestIid}`;
  }

  public buildAuthenticatedRemoteUrl(token: string, projectPath: string): string {
    return `https://oauth2:${token}@${this.host}/${projectPath}.git`;
  }

  public buildCiCloneUrl(ciJobToken: string, projectPath: string): string {
    return `https://gitlab-ci-token:${ciJobToken}@${this.host}/${projectPath}.git`;
  }

  private async request(
    endpoint: string,
    options: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
  ): Promise<Response> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`;
    const tokenHeader = this.tokenKind === 'job' ? 'JOB-TOKEN' : 'PRIVATE-TOKEN';
    const headers: Record<string, string> = {
      [tokenHeader]: this.token,
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
      throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private async getJson(endpoint: string): Promise<unknown> {
    const response = await this.request(endpoint);
    return response.json();
  }

  private async getRawText(endpoint: string): Promise<string> {
    const response = await this.request(endpoint);
    return response.text();
  }
}
