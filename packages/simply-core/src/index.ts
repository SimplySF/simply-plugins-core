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

export {
  authenticateClientCredentials,
  type ClientCredentialsAuthOptions,
  type ClientCredentialsAuthResult,
} from './auth/clientCredentialsAuth.js';
export { retryWithBackoff, RetryAttemptTimeoutError, type RetryWithBackoffOptions } from './async/retryWithBackoff.js';
export { mapConcurrent } from './async/mapConcurrent.js';
export {
  apiBudgetError,
  checkApiBudget,
  type ApiBudgetResult,
  type ApiBudgetSource,
  type CheckApiBudgetOptions,
} from './org/apiBudget.js';
export {
  SkipFirstLineTransform,
  streamBulkQuery,
  streamBulkQueryToFile,
  type StreamBulkQueryOptions,
  type StreamBulkQueryResult,
  type StreamBulkQueryToFileOptions,
  type StreamBulkQueryToFileResult,
} from './bulk/streamBulkQuery.js';
export { queryRecords, type QueryRecordsOptions } from './query/queryRecords.js';
export { createCsvFileWriter, writeRecordsToCsvFile, type CsvFileWriter } from './csv/createCsvFileWriter.js';
export { chunk, mapChunked } from './collection/chunk.js';
export {
  loadJsonConfig,
  loadJsonConfigSync,
  parseJsonConfig,
  type ConfigSchema,
  type JsonConfigResult,
} from './config/loadJsonConfig.js';
export { ensureDirectory, timestampForFileName } from './fs/paths.js';
export { chunkedInQuery, type ChunkedInQueryOptions } from './query/chunkedInQuery.js';
export { escapeSoqlLiteral } from './query/escapeSoqlLiteral.js';
export {
  isPackage2Id,
  isPackage2VersionId,
  isSubscriberPackageId,
  isSubscriberPackageVersionId,
  PACKAGE_PREFIX_PACKAGE2,
  PACKAGE_PREFIX_PACKAGE2_VERSION,
  PACKAGE_PREFIX_SUBSCRIBER_PACKAGE,
  PACKAGE_PREFIX_SUBSCRIBER_PACKAGE_VERSION,
} from './package/packageIds.js';
export {
  getDefaultPackageDirectory,
  getPluginConfig,
  readSfdxProject,
  SFDX_PROJECT_FILE_NAME,
  type SfdxPackageDirectory,
  type SfdxPackageDirectoryDependency,
  type SfdxProject,
} from './project/sfdxProject.js';
export {
  LOCAL_PACKAGE_LABEL,
  LOCAL_PUBLISHER_NAME,
  normalizePublisherName,
  resolvePackageNamesByApiName,
  resolvePackageNamesBySubjectId,
  type ResolvePackageNamesByApiNameOptions,
  type ResolvePackageNamesOptions,
} from './metadata/packageAttribution.js';
export { readPackageManifestMembers } from './metadata/packageManifest.js';
