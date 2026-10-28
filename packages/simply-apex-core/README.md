# @simplysf/simply-apex-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-apex-core?label=@simplysf/simply-apex-core)](https://npmjs.com/@simplysf/simply-apex-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-apex-core.svg)](https://npmjs.com/@simplysf/simply-apex-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Apex execute/log-purge/trace-flag logic. This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-apex`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-apex)'s `sf simply apex ...` commands, published separately so it can be imported directly by anything that wants the same behavior (an editor extension, a CI job, a script) without pulling in the CLI framework.

Unlike the other internal libraries in this monorepo (`@simplysf/simply-core`, `@simplysf/simply-plugin-kit`, `@simplysf/simply-report`), this package is meant to be depended on by projects outside this repo, not only by other `simply-*` packages.

## Install

```bash
npm install @simplysf/simply-apex-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                                                                                  | Description                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executeApex(connection, apexFilePath)`                                                                                 | Executes an anonymous Apex block from a local file and returns the compile/execution result. Throws `ApexExecuteError` (`compile-failed`/`execute-failed`) on failure.                                                                            |
| `ApexExecuteError`, `ApexExecuteErrorCode`, `ApexExecuteResult`                                                         | The error type (carrying the full result, even on failure) and result shape for `executeApex`.                                                                                                                                                    |
| `runApexTestsWithResults(options)`                                                                                      | Runs Apex tests asynchronously and writes the same result files `sf apex test run --result-format junit --output-dir <dir>` writes (`test-run-id.txt`, `test-result-<id>.json`, JUnit, coverage). Failing tests aren't an error: check `outcome`. |
| `formatTestResultJson(result)`, `ApexTestResultJson`, `RunApexTestsWithResultsOptions`, `RunApexTestsWithResultsResult` | The CLI's `test-result-<id>.json` format for an apex-node `TestResult`, and the runner's option/result types.                                                                                                                                     |
| `queryApexLogIdsViaRest(connection, query)`                                                                             | Collects `ApexLog` Ids matching a SOQL query via the Tooling API.                                                                                                                                                                                 |
| `queryApexLogIdsViaBulkApi(connection, query, pollTimeout)`                                                             | Same, via a Bulk API v2 query job.                                                                                                                                                                                                                |
| `deleteApexLogsViaCollections(connection, logIds, onChunkComplete?)`                                                    | Deletes `ApexLog` records via the SObject Collections resource, 200 per call. `onChunkComplete(purged, total)` fires after each chunk.                                                                                                            |
| `deleteApexLogsViaBulkApi(connection, logIds, pollTimeout)`                                                             | Same, as a single Bulk API v2 ingest job.                                                                                                                                                                                                         |
| `ApexLogsPurgeResult`                                                                                                   | Per-record delete outcome shared by all four log functions above.                                                                                                                                                                                 |
| `setupApexTrace(connection, options?, onPhase?)`                                                                        | Creates or updates a DEVELOPER_LOG trace flag for a user (defaults to `connection`'s own user). Throws `ApexTraceSetupError` — see its `ApexTraceSetupErrorCode`.                                                                                 |
| `parseOnBehalfOf(input)`, `DATE_TIME_PATTERN`, `ON_BEHALF_OF_PATTERN`                                                   | Parsing/validation helpers for `setupApexTrace`'s `Field:Value` user selector and ISO 8601 date-time inputs.                                                                                                                                      |
| `OnBehalfOf`, `ApexTraceSetupOptions`, `ApexTraceSetupResult`, `ApexTraceSetupError`, `ApexTraceSetupErrorCode`         | Supporting types/error for `setupApexTrace`.                                                                                                                                                                                                      |
| `resolveClasses(classNames, classesFilePath?, presets)`                                                                 | Combines explicit class names, a classes-file (validated against `ClassesToSilenceSchema`), and the `fflib`/`at4dx`/`forceDi` presets into a deduplicated class-name list.                                                                        |
| `silenceApexClasses(connection, classNames, onPhase?)`                                                                  | Creates or updates a CLASS_TRACING trace flag with a fully-suppressed debug level for each class. Throws `ApexTraceSilenceError` — see its `ApexTraceSilenceErrorCode`.                                                                           |
| `FFLIB_CLASSES`, `AT4DX_CLASSES`, `FORCE_DI_CLASSES`                                                                    | The class names each `resolveClasses` preset adds.                                                                                                                                                                                                |
| `ApexTraceSilenceResult`, `ApexTraceSilenceOutcome`, `ApexTraceSilenceError`, `ApexTraceSilenceErrorCode`               | Supporting types/error for `silenceApexClasses`.                                                                                                                                                                                                  |
| `ClassesToSilenceSchema`, `ClassesToSilence`                                                                            | The Zod schema (and inferred type) for a classes-file passed to `resolveClasses`: `{ "classes": ["ClassOne", "ClassTwo"] }`.                                                                                                                      |
| `generateApexTestSuite(sourceDirs, outputDir, name)`                                                                    | Scans `sourceDirs` for `@IsTest`-annotated classes and writes `<name>.testSuite-meta.xml` to `outputDir`, overwriting any existing file. Throws `ApexTestSuiteError` (`scan-failed`/`no-test-classes-found`).                                     |
| `scanTestClasses(sourceDirs)`                                                                                           | The scan on its own: the deduplicated, sorted names of every `@IsTest` class under `sourceDirs`.                                                                                                                                                  |
| `isTestClassSource(source)`, `buildApexTestSuiteXml(testClassNames)`                                                    | Pure helpers: whether an Apex class file's text is `@IsTest`-annotated (first meaningful line, comments skipped), and the `.testSuite-meta.xml` document for a class list.                                                                        |
| `ApexTestSuiteError`, `ApexTestSuiteErrorCode`, `ApexTestSuiteGenerateResult`                                           | Error and result (`{ filePath, testClassNames }`) types for `generateApexTestSuite`.                                                                                                                                                              |

```ts
import { executeApex } from '@simplysf/simply-apex-core';

const result = await executeApex(connection, 'scripts/apex/data-fix.apex');
console.log(result.logs);
```

```ts
import { deleteApexLogsViaCollections, queryApexLogIdsViaRest } from '@simplysf/simply-apex-core';

const logIds = await queryApexLogIdsViaRest(connection, 'SELECT Id FROM ApexLog');
const results = await deleteApexLogsViaCollections(connection, logIds);
```

```ts
import { setupApexTrace } from '@simplysf/simply-apex-core';

const result = await setupApexTrace(connection, {
  onBehalfOf: { field: 'Username', value: 'someuser@example.com' },
});
```

```ts
import { resolveClasses, silenceApexClasses } from '@simplysf/simply-apex-core';

const classes = resolveClasses(['NoisyClass'], undefined, { fflib: true, at4dx: false, forceDi: false });
const outcome = await silenceApexClasses(connection, classes);
```

```ts
import { generateApexTestSuite } from '@simplysf/simply-apex-core';

const { filePath, testClassNames } = await generateApexTestSuite(
  ['force-app'],
  'force-app/main/default/testSuites',
  'AllTests',
);
```

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
