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

// Everything exported from this file is this package's public API and is semver-covered: adding an
// export is a minor/patch change, but removing or renaming one is breaking. `test/index.test.ts`
// pins the exported-key list down so an accidental removal fails a test instead of silently shipping
// in a patch release. See docs/design/0057-project-release-roll-forward.md for why this package
// exists separately from `@simplysf/simply-cicd-core`, and 0061-project-release-create.md for why
// its VCS steps use `@simplysf/simply-core`'s providers rather than that package's.

export * from './release/rollForward.js';
export {
  createRelease,
  type CreateReleaseOptions,
  type CreateReleaseResult,
  type CreateReleaseStatus,
  type CreateReleaseVcs,
  type ReleaseType,
} from './release/createRelease.js';
export { RELEASE_TYPES } from './release/releaseBranches.js';
export { RELEASE_CONFIG_PATH, readReleasePluginConfig, type ReleasePluginConfig } from './release/releaseConfig.js';
export { resolveReleaseVcs, type ResolveReleaseVcsOptions } from './release/releaseVcs.js';
