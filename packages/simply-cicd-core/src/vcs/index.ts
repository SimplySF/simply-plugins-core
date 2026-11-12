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

// The VCS providers now live in @simplysf/simply-core (docs/design/0061-project-release-create.md).
// This barrel re-exports them unchanged, so importers of simply-cicd-core see the same names and
// share simply-core's single provider registry.

export {
  createVcsProvider,
  GitHubProvider,
  GitLabProvider,
  listVcsProviderKinds,
  registerVcsProvider,
} from '@simplysf/simply-core';

export type {
  VcsBranch,
  VcsCiContext,
  VcsCommit,
  VcsCommitLogEntry,
  VcsMergeRequest,
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
} from '@simplysf/simply-core';
