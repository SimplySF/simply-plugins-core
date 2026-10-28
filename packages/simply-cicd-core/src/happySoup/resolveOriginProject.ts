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

import { GitHubProvider, GitLabProvider, type VcsProviderKind } from '../vcs/index.js';
import { getPackageOriginOverride } from '../sfConfig.js';

/** Where a packaged dependency's source lives, resolved for a happy-soup story lookup. */
export type ResolvedOriginProject = {
  vcsProvider: VcsProviderKind;
  host: string;
  projectPath: string;
};

/** Matches a GitLab CI pipeline URL, e.g. `https://gitlab.com/group/subgroup/project/-/pipelines/12345`. */
const GITLAB_PIPELINE_PATH = /^\/(?<projectPath>.+)\/-\/pipelines\/\d+/;

/** Matches a GitHub Actions run URL, e.g. `https://github.com/owner/repo/actions/runs/12345`. */
const GITHUB_RUN_PATH = /^\/(?<projectPath>[^/]+\/[^/]+)\/actions\/runs\/\d+/;

/**
 * Parses a CI pipeline URL — as stored in `sf package version report`'s `Description` field by
 * `createPackageVersion` at build time — into the VCS project that built it. Recognizes GitLab
 * pipeline URLs and GitHub Actions run URLs. Returns `undefined` if the URL doesn't match either
 * shape (or isn't a URL at all), e.g. for a package version created outside this pipeline.
 */
export function parseOriginPipelineUrl(pipelineUrl: string): ResolvedOriginProject | undefined {
  let url: URL;
  try {
    url = new URL(pipelineUrl);
  } catch {
    return undefined;
  }

  const gitlabMatch = GITLAB_PIPELINE_PATH.exec(url.pathname);
  if (gitlabMatch?.groups?.projectPath) {
    return { vcsProvider: 'gitlab', host: url.host, projectPath: gitlabMatch.groups.projectPath };
  }

  const githubMatch = GITHUB_RUN_PATH.exec(url.pathname);
  if (githubMatch?.groups?.projectPath) {
    return { vcsProvider: 'github', host: url.host, projectPath: githubMatch.groups.projectPath };
  }

  return undefined;
}

/**
 * Resolves which VCS project a packaged dependency's source lives in, for a happy-soup story
 * lookup. Checks `.sfdevrc.json`'s `packageOriginOverrides` first (for packages whose origin can't
 * be parsed, e.g. externally-vendored ones), then falls back to parsing the target version's
 * origin pipeline URL. Returns `undefined` (never throws) if neither resolves — callers must treat
 * that package's stories as unavailable and continue, not fail the notification.
 */
export function resolvePackageOrigin(
  packageName: string,
  targetDescription: string | undefined,
): ResolvedOriginProject | undefined {
  const override = getPackageOriginOverride(packageName);
  if (override) {
    const defaultHost = override.vcsProvider === 'gitlab' ? GitLabProvider.defaultHost : GitHubProvider.defaultHost;
    return { vcsProvider: override.vcsProvider, host: override.host ?? defaultHost, projectPath: override.projectPath };
  }

  return targetDescription ? parseOriginPipelineUrl(targetDescription) : undefined;
}
