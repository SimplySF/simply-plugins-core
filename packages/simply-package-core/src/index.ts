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
// in a patch release. See docs/design/0032-simply-package-core.md for why this package is split out
// from `@simplysf/simply-package` (the CLI) rather than being one more relative import inside it.

export {
  isPackage2Id,
  isPackage2VersionId,
  isSubscriberPackageId,
  isSubscriberPackageVersionId,
  PACKAGE_PREFIX_PACKAGE2,
  PACKAGE_PREFIX_PACKAGE2_VERSION,
  PACKAGE_PREFIX_SUBSCRIBER_PACKAGE,
  PACKAGE_PREFIX_SUBSCRIBER_PACKAGE_VERSION,
  reducePackageInstallRequestErrors,
  isDependenciesPackagingDirectory,
} from './packageUtils.js';
export {
  splitPackageAlias,
  findPackageVersions,
  type PackageVersionSource,
  type PackageVersionMatch,
  type FindPackageVersionsOptions,
} from './packageVersionLookup.js';
export {
  buildVersionService,
  type VersionChoice,
  type PackageVersionService,
  type VersionServiceFilterIds,
} from './packageVersionService.js';
export { buildProjectService, type SfdxProjectService } from './sfdxProjectService.js';
export {
  installPackageDependencies,
  type InstallPackageDependenciesOptions,
  type InstallPackageDependenciesProgress,
  type InstallPackageDependenciesPrompts,
  type PackageInstallApexCompileType,
  type PackageInstallSecurityType,
  type PackageInstallStatus,
  type PackageInstallType,
  type PackageInstallUpgradeType,
  type PackageToInstall,
} from './packageDependenciesInstall.js';
export { type DependencyChange, type PackageDependenciesManageResult } from './schemas/manage/dependencyChange.js';
export { type ParsedDependency, parseDependency } from './schemas/manage/parsedDependency.js';
export {
  BasePackageDirWithDependenciesSchema,
  type PackageDirDependency,
  type BasePackageDirWithDependencies,
} from './schemas/sfdx-project/packageDirs.js';
export {
  clonePackageDependencies,
  defaultGitRunner,
  normalizeRepositoryUrl,
  type ClonePackageDependenciesOptions,
  type ClonePackageDependenciesProgress,
  type DependencyCloneResult,
  type DependencyCloneStatus,
  type GitRunner,
} from './packageDependenciesClone.js';
export {
  isIgnoredDependency,
  resolveDependencyRepository,
  type ResolvedDependencyRepository,
} from './dependencyRepositoryResolver.js';
export {
  DEPENDENCY_REPOSITORIES_CONFIG_PATH,
  DependencyRepositoriesSchema,
  DependencyRepositorySchema,
  hasCredentialsInUrl,
  readDependencyRepositories,
  type DependencyRepositories,
  type DependencyRepository,
} from './schemas/sfdx-project/dependencyRepositories.js';
