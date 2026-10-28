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
// in a patch release. See docs/design/0023-simply-apex-core.md for why this package is split out
// from `@simplysf/simply-apex` (the CLI) rather than being one more relative import inside it.

export { executeApex, ApexExecuteError, type ApexExecuteErrorCode, type ApexExecuteResult } from './apexExecute.js';

export {
  queryApexLogIdsViaRest,
  queryApexLogIdsViaBulkApi,
  deleteApexLogsViaCollections,
  deleteApexLogsViaBulkApi,
  type ApexLogsPurgeResult,
} from './apexLogsPurge.js';

export {
  setupApexTrace,
  parseOnBehalfOf,
  ApexTraceSetupError,
  DATE_TIME_PATTERN,
  ON_BEHALF_OF_PATTERN,
  type OnBehalfOf,
  type ApexTraceSetupOptions,
  type ApexTraceSetupResult,
  type ApexTraceSetupErrorCode,
} from './apexTraceSetup.js';

export {
  resolveClasses,
  silenceApexClasses,
  ApexTraceSilenceError,
  FFLIB_CLASSES,
  AT4DX_CLASSES,
  FORCE_DI_CLASSES,
  type ApexTraceSilenceResult,
  type ApexTraceSilenceOutcome,
  type ApexTraceSilenceErrorCode,
} from './apexTraceSilence.js';

export { ClassesToSilenceSchema, type ClassesToSilence } from './schemas/classesToSilence.js';

export {
  generateApexTestSuite,
  isTestClassSource,
  scanTestClasses,
  buildApexTestSuiteXml,
  ApexTestSuiteError,
  type ApexTestSuiteErrorCode,
  type ApexTestSuiteGenerateResult,
} from './apexTestSuite.js';

export {
  formatTestResultJson,
  runApexTestsWithResults,
  type ApexTestResultJson,
  type ApexTestResultJsonTest,
  type RunApexTestsWithResultsOptions,
  type RunApexTestsWithResultsResult,
} from './apexTestRun.js';
