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
// in a patch release. See docs/design/0046-simply-flow-core.md for why this package is split out
// from `@simplysf/simply-flow` (the CLI) rather than staying inside its two command files.

export {
  type FlowDeleteFailure,
  type FlowDeleteResult,
  type FlowDeleteStage,
  type FlowVersionPruneCandidate,
  type FlowVersionPruneFailure,
  type FlowVersionPruneResult,
} from './flowTypes.js';
export { deleteFlows, type DeleteFlowsOptions } from './flowDelete.js';
export {
  findObsoleteFlowVersions,
  deleteFlowVersions,
  pruneObsoleteFlowVersions,
  type PruneObsoleteFlowVersionsOptions,
} from './flowVersionPrune.js';
export { findFlowNamesInSource, developerNameFromFlowFile } from './flowSource.js';
export { FLOW_QUERY_CHUNK_SIZE } from './flowQueries.js';
