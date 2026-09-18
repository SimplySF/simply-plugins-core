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
// in a patch release. See docs/design/0030-simply-community-core.md for why this package is split
// out from `@simplysf/simply-community` (the CLI) rather than being one more relative import inside
// it.

export { checkPublishStatus } from './checkPublishStatus.js';
export {
  deployChangedFiles,
  type DeployChangedFilesOptions,
  type DeployComponentFailure,
  type DeployChangedFilesResult,
} from './deployChangedFiles.js';
export { publishCommunity, DEFAULT_PUBLISH_REQUEST_TIMEOUT, type PublishCommunityOptions } from './publishCommunity.js';
export {
  resolveSearchRoots,
  resolveRetrieveDestination,
  resolveSiteFile,
  resolveNetworkFile,
} from './resolveSiteFiles.js';
export { retrieveCustomSite } from './retrieveCustomSite.js';
export {
  patchCustomSiteXml,
  type PatchCustomSiteXmlOptions,
  type PatchCustomSiteXmlResult,
  patchNetworkXml,
  readNetworkSiteName,
} from './siteMetadataXml.js';
export { verifyDomain, type DomainCheckStatus, type DomainCheckResult } from './verifyDomain.js';
