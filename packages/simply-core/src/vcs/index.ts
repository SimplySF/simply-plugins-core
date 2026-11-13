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

import { GitHubProvider } from './github.js';
import { GitLabProvider } from './gitlab.js';
import { registerVcsProvider } from './registry.js';

registerVcsProvider('gitlab', (options) => new GitLabProvider(options));
registerVcsProvider('github', (options) => new GitHubProvider(options));

export { createVcsProvider, listVcsProviderKinds, registerVcsProvider } from './registry.js';

export { GitHubProvider } from './github.js';
export { GitLabProvider } from './gitlab.js';

export type {
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
  VcsProviderFactory,
  VcsProviderKind,
  VcsProviderOptions,
  VcsRelease,
  VcsReleaseInput,
  VcsTerminology,
} from './types.js';
