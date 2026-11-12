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

import { createVcsProvider, loadSfDevRc, resolveVcsSettings, type VcsProviderKind } from '@simplysf/simply-core';
import type { CreateReleaseVcs } from './createRelease.js';

export type ResolveReleaseVcsOptions = {
  /** Explicit values, usually flags, which win over `SIMPLY_VCS_*` and `.sfdevrc.json`. */
  provider?: VcsProviderKind;
  host?: string;
  projectId?: string;
  /** The API token. Never read from `.sfdevrc.json`, which is committed. */
  token?: string;
  /** The directory holding `.sfdevrc.json`, usually the repository root. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Where to read `SIMPLY_VCS_*` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
};

/**
 * Builds the provider for `createRelease`'s platform steps from flags, `SIMPLY_VCS_*`, and
 * `.sfdevrc.json`, failing up front on a missing project ID or token, before anything changes.
 */
export function resolveReleaseVcs(options: ResolveReleaseVcsOptions = {}): CreateReleaseVcs {
  const { config } = loadSfDevRc({ cwd: options.cwd, env: options.env, warn: options.warn });
  const { kind, host, projectId } = resolveVcsSettings(config, {
    provider: options.provider,
    host: options.host,
    projectId: options.projectId,
  });
  if (!projectId) {
    throw new Error(
      'A VCS project ID is required. Pass --vcs-project-id, set SIMPLY_VCS_PROJECT_ID, or set vcs.projectId in .sfdevrc.json.',
    );
  }
  if (!options.token) {
    throw new Error('A VCS API token is required. Pass --vcs-token or set SIMPLY_VCS_TOKEN.');
  }
  return { provider: createVcsProvider(kind, { host, token: options.token }), project: projectId };
}
