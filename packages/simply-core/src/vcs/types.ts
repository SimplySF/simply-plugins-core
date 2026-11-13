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

import type { VcsProviderKind } from '../config/providerKinds.js';

/** The set of source-control-hosting platforms the built-in providers cover. */
export type { VcsProviderKind };

/** A repository/project, normalized across VCS platforms. */
export type VcsProject = {
  id: number;
  /**
   * How this provider addresses the project in its own API: the numeric ID for GitLab,
   * `owner/repo` for GitHub. Prefer this over `id` when passing a project to provider methods.
   */
  key: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch?: string;
  archived: boolean;
  empty: boolean;
  isFork: boolean;
  /** The raw, platform-specific API response this was derived from. */
  raw: unknown;
};

/**
 * A project as accepted by `VcsProvider` methods: either a normalized `VcsProject` or a bare
 * provider-native key (a GitLab numeric ID, a GitHub `owner/repo`).
 */
export type VcsProjectRef = string | number | Pick<VcsProject, 'key'>;

/** A branch, normalized across VCS platforms. */
export type VcsBranch = {
  name: string;
  raw: unknown;
};

/** The result of a file-content commit, normalized across VCS platforms. */
export type VcsCommit = {
  id?: string;
  raw: unknown;
};

/** A single commit as returned by a ref-to-ref comparison, normalized across VCS platforms. */
export type VcsCommitLogEntry = {
  sha?: string;
  message: string;
  raw: unknown;
};

/**
 * A merge/pull request, normalized across VCS platforms. `iid` is the number the platform shows
 * users and accepts in its per-request endpoints — GitLab's `iid`, GitHub's PR `number`.
 */
export type VcsMergeRequest = {
  id: number;
  iid: number;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl?: string;
  raw: unknown;
};

/** Optional behavior for {@link VcsProvider.createMergeRequest}. */
export type VcsMergeRequestOptions = {
  /** Open it as a draft: a `Draft:` title prefix on GitLab, a draft pull request on GitHub. */
  draft?: boolean;
  /**
   * Delete the source branch when it merges. Defaults to `true`. Only GitLab sets this per merge
   * request; GitHub follows the repository's `delete_branch_on_merge` setting.
   */
  removeSourceBranch?: boolean;
};

/** A project/repo-level CI variable, normalized across VCS platforms. */
export type VcsProjectVariable = {
  key: string;
  value: string;
  raw: unknown;
};

/**
 * What a platform calls a proposed change, for user-facing log and message text. GitLab says
 * "merge request"/"MR"; GitHub says "pull request"/"PR".
 */
export type VcsTerminology = {
  changeRequest: string;
  changeRequestShort: string;
  /** What the platform calls the repo-scoped CI variables read by `getProjectVariables`. */
  projectVariable: string;
};

/** The upstream repository identity, as read from the platform's own CI environment variables. */
export type VcsCiContext = {
  projectPath?: string;
  projectId?: string;
};

/** A release published on the platform for an existing tag. */
export type VcsRelease = {
  tagName: string;
  name: string;
  /** The release's page, when the platform returns one. */
  webUrl?: string;
  raw: unknown;
};

/** What `createRelease` publishes. */
export type VcsReleaseInput = {
  /** An existing tag. The caller must check it exists, since GitHub would otherwise create it. */
  tagName: string;
  name: string;
  description?: string;
};

/** Everything a provider needs to talk to a specific instance of its platform. */
export type VcsProviderOptions = {
  /** The instance hostname, e.g. `gitlab.com` or `github.com`. */
  host?: string;
  token: string;
  /** Overrides the provider's derived API base URL. Rarely needed outside self-hosted instances. */
  apiUrl?: string;
  /**
   * What kind of token `token` is, so the provider can pick the right auth header. Only GitLab
   * distinguishes: a personal/project access token uses `PRIVATE-TOKEN`, a `CI_JOB_TOKEN` uses
   * `JOB-TOKEN`. Defaults to `'personal'`. GitHub ignores this — a `GITHUB_TOKEN` and a PAT both
   * authenticate the same way.
   */
  tokenKind?: 'personal' | 'job';
};

/**
 * A source-control-hosting platform client, abstracted so that commands never encode one
 * platform's API shape, URL scheme, or vocabulary.
 */
export interface VcsProvider {
  readonly kind: VcsProviderKind;

  /** The platform's vocabulary, for composing user-facing text. */
  readonly terminology: VcsTerminology;

  /** The instance hostname this provider was built for. */
  readonly host: string;

  /** The API base URL this provider talks to, derived from the host unless overridden. */
  readonly apiUrl: string;

  /** Reads the upstream repository's identity from this platform's CI environment variables. */
  getCiContext(): VcsCiContext;

  /** Lists all projects/repos under a group/org, including subgroups where the platform has them. */
  listProjects(groupId: string | number): Promise<VcsProject[]>;

  /** Fetches the raw content of a file from a project at a given ref. */
  getFileContent(project: VcsProjectRef, filePath: string, ref: string): Promise<string>;

  /** Lists the commits reachable from `to` but not from `from` (e.g. between two tags/SHAs). */
  compareRefs(project: VcsProjectRef, from: string, to: string): Promise<VcsCommitLogEntry[]>;

  /** Returns whether a branch exists in a project. */
  branchExists(project: VcsProjectRef, branchName: string): Promise<boolean>;

  /** Creates a branch from a reference point (usually the project's default branch). */
  createBranch(project: VcsProjectRef, branchName: string, ref: string): Promise<VcsBranch>;

  /** Commits new content for a single file to a branch. */
  commitFile(
    project: VcsProjectRef,
    branchName: string,
    commitMessage: string,
    filePath: string,
    content: string,
  ): Promise<VcsCommit>;

  /** Finds an existing open merge/pull request with the given source and target branch, if any. */
  findOpenMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<VcsMergeRequest | undefined>;

  /** Creates a new merge/pull request. */
  createMergeRequest(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
    labels?: string[],
    options?: VcsMergeRequestOptions,
  ): Promise<VcsMergeRequest>;

  /** Updates an existing merge/pull request's title, description, and labels. */
  updateMergeRequest(
    project: VcsProjectRef,
    mergeRequest: VcsMergeRequest,
    title: string,
    description: string,
    labels?: string[],
  ): Promise<VcsMergeRequest>;

  /** Fetches project/repo-level CI variables. Returns an empty array if unreadable. */
  getProjectVariables(project: VcsProjectRef): Promise<VcsProjectVariable[]>;

  /**
   * Builds the browser URL for a merge/pull request, given the project's own web URL. The path
   * differs per platform — GitLab nests it under `/-/merge_requests/`, GitHub under `/pull/`.
   */
  buildChangeRequestUrl(projectUrl: string, changeRequestIid: string | number): string;

  /** Builds a token-authenticated remote URL suitable for push/tag operations (e.g. `git remote add`). */
  buildAuthenticatedRemoteUrl(token: string, projectPath: string): string;

  /** Builds a CI-job-token-authenticated remote URL suitable for a read-only `git clone`. */
  buildCiCloneUrl(ciJobToken: string, projectPath: string): string;

  // The members below are optional so a provider written before they existed still compiles. A
  // caller checks for each one before changing anything. See docs/design/0061-project-release-create.md.

  /** Finds the release for a tag, returning undefined when there is none. */
  findRelease?(project: VcsProjectRef, tagName: string): Promise<VcsRelease | undefined>;

  /** Publishes a release for an existing tag. */
  createRelease?(project: VcsProjectRef, release: VcsReleaseInput): Promise<VcsRelease>;

  /** Makes a branch the project's default branch. */
  setDefaultBranch?(project: VcsProjectRef, branchName: string): Promise<void>;
}

/** Constructs a provider for one instance of a platform. */
export type VcsProviderFactory = (options: VcsProviderOptions) => VcsProvider;
