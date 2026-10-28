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
// in a patch release. See docs/design/0037-simply-cicd-core.md for the original `alm/`/`vcs/` split,
// and docs/design/0053-simply-cicd-core-common.md for the move of the rest of `@simplysf/simply-cicd`'s
// `common/` (everything except its oclif flag declarations).
//
// `alm/index.ts` and `vcs/index.ts` are themselves complete barrels (they register the built-in
// providers as an import side effect, same as they did inside `simply-cicd`) — re-exporting them
// here keeps that registration intact without duplicating either list.

export * from './alm/index.js';
export * from './vcs/index.js';

// shared kernel
export * from './env.js';
export * from './git.js';
export * from './logger.js';
export * from './sfApex.js';
export * from './sfAuth.js';
export * from './sfConfig.js';
export * from './sfPackages.js';
export * from './sfPlugins.js';

// build/
export * from './build/checkPermissionSets.js';
export * from './build/cleanupScratchOrgs.js';
export * from './build/createFallbackTag.js';
export * from './build/createPackageVersion.js';
export * from './build/createScratchOrg.js';
export * from './build/deleteScratchOrg.js';
export * from './build/deltaRunner.js';
export * from './build/determinePackageChanges.js';
export * from './build/devHubs.js';
export * from './build/flexipageDelta.js';
export * from './build/flowDelta.js';
export * from './build/installDependencies.js';
export * from './build/lwcJest.js';
export * from './build/publishUtamPageObjects.js';
export * from './build/pushScratch.js';
export * from './build/scratchOrgAuth.js';
export * from './build/scratchOrgInfo.js';
export * from './build/skipGuard.js';
export * from './build/testScratch.js';
export * from './build/utamPageObjects.js';
export * from './build/versionTagFormat.js';

// deploy/
export * from './deploy/deployCommon.js';
export * from './deploy/deployHappySoup.js';
export * from './deploy/deployProject.js';
export * from './deploy/runDeployStage.js';
export * from './deploy/stageOptions.js';
export * from './deploy/validate.js';

// exec/
export * from './exec/sfCli.js';

// flags/
export * from './flags/env.js';

// happySoup/
export * from './happySoup/resolveOriginProject.js';

// notify/
export * from './notify/buildNotification.js';
export * from './notify/getCommitStories.js';
export * from './notify/getRemoteCommitStories.js';
export * from './notify/happySoupNotification.js';
export * from './notify/projectNotification.js';
export * from './notify/renderTemplate.js';
export * from './notify/sendNotification.js';
export * from './notify/templates.js';

// schemas/
export * from './schemas/deployConfig.js';
export * from './schemas/deployProgress.js';
export * from './schemas/deployRules.js';

// sfdxDependabot/
export * from './sfdxDependabot/dependabotRun.js';
export * from './sfdxDependabot/updater.js';
