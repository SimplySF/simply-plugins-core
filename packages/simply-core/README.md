# @simplysf/simply-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-core?label=@simplysf/simply-core)](https://npmjs.com/@simplysf/simply-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-core.svg)](https://npmjs.com/@simplysf/simply-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Shared internal utilities for [`@simplysf`](https://github.com/SimplySF/simply-plugins-core) Salesforce CLI plugins. This is not a Salesforce CLI plugin itself — it's a plain library consumed by the other packages in this monorepo.

It deliberately does **not** depend on `@salesforce/sf-plugins-core`. Anything needing the oclif flag or command layer belongs in [`@simplysf/simply-plugin-kit`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-plugin-kit) instead.

## Install

```bash
npm install @simplysf/simply-core
```

## API

Everything below is exported from the package root.

### Authentication

| Export                                                        | Description                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticateClientCredentials(options)`                      | Authenticates via the OAuth 2.0 Client Credentials grant — a flow the Salesforce CLI has no built-in support for (only web, JWT, and SFDX auth-url). Proxies `@jsforce/jsforce-node`'s OAuth2 token exchange into `@salesforce/core`'s `AuthInfo`, the same way the JWT flow hands off its own token internally, so the resulting org is persisted and alias-able like any other `sf`-authenticated org. |
| `ClientCredentialsAuthOptions`, `ClientCredentialsAuthResult` | Option and result types.                                                                                                                                                                                                                                                                                                                                                                                 |

```ts
import { authenticateClientCredentials } from '@simplysf/simply-core';

const { username } = await authenticateClientCredentials({
  loginUrl: 'https://my-org.my.salesforce.com',
  consumerKey: 'consumer-key',
  consumerSecret: 'consumer-secret', // or consumerSecretFile: './consumer-secret.txt'
  alias: 'my-org',
  setDefault: true,
});
// -> persisted, usable as --target-org my-org anywhere in the sf/simply ecosystem
```

The Connected App's OAuth policy must include the `api` and `id`/`openid` scopes — `AuthInfo` resolves the username/org ID via `services/oauth2/userinfo`, which depends on them. Client Credentials tokens run as the single "run as" user configured on the Connected App in Setup, not a per-request user.

### Querying

| Export                                             | Description                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queryRecords(conn, soql, options?)`               | Async generator yielding flat, string-valued records. Picks its own transport: below `bulkThreshold` (default 2000) it uses `Connection#autoFetchQuery`; above it, `streamBulkQuery`, so memory stays flat at any result size. Not for Tooling API queries — Bulk API v2 doesn't support them. |
| `chunkedInQuery(conn, values, buildSoql, options)` | Runs a query once per chunk of `values`, splicing each chunk into a quoted `IN (...)` clause, and returns every record from every chunk. Use when an `IN` list would otherwise exceed SOQL's length limit.                                                                                     |
| `escapeSoqlLiteral(value)`                         | Escapes a value for use inside a single-quoted SOQL string literal.                                                                                                                                                                                                                            |
| `ChunkedInQueryOptions`, `QueryRecordsOptions`     | Option types for the two query helpers.                                                                                                                                                                                                                                                        |

### Bulk API v2 streaming export

| Export                                                                                                           | Description                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `streamBulkQuery(conn, soql, opts?)`                                                                             | Runs a SOQL query through Bulk API v2 and returns the merged CSV results as one `Readable`. |
| `streamBulkQueryToFile(conn, soql, path, opts?)`                                                                 | The same, written straight to a file — the common case.                                     |
| `SkipFirstLineTransform`                                                                                         | Strips the duplicate header row from each result page after the first.                      |
| `StreamBulkQueryOptions`, `StreamBulkQueryResult`, `StreamBulkQueryToFileOptions`, `StreamBulkQueryToFileResult` | Option and result types.                                                                    |

`Connection.bulk2.query()` (jsforce's own convenience method) routes each result page through jsforce's legacy HTTP transport, which fully buffers each page into memory before your code can consume it — defeating streaming for large exports. These helpers avoid that by fetching result pages directly with `undici`, converting the response body straight to a Node stream, and piping it onward. jsforce is still used for job creation and polling; only the result-page fetch bypasses it.

Use `streamBulkQuery` directly when you want to consume or transform the results without ever touching the filesystem — e.g. piping the CSV stream through `csv-parse` to process records one at a time, the same way `queryRecords` uses it internally above its `bulkThreshold`:

```ts
import { parse } from 'csv-parse';
import { streamBulkQuery } from '@simplysf/simply-core';

const { jobId, numberRecordsProcessed, stream } = await streamBulkQuery(connection, 'SELECT Id, Name FROM Account');

for await (const record of stream.pipe(parse({ columns: true })) as AsyncIterable<Record<string, string>>) {
  console.log(record.Id, record.Name);
}
```

Memory stays flat regardless of result set size — pages are fetched lazily as the stream is consumed, not buffered up front. Use `streamBulkQueryToFile` instead for the common "just write it to disk" case:

```ts
import { streamBulkQueryToFile } from '@simplysf/simply-core';

const result = await streamBulkQueryToFile(connection, 'SELECT Id, Name FROM Account', './accounts.csv');
// { jobId: '750...', numberRecordsProcessed: 42 }
```

### CSV output

| Export                                                | Description                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createCsvFileWriter(outputPath, columns)`            | Opens a streaming CSV writer, for writing rows incrementally without holding them all in memory.                     |
| `writeRecordsToCsvFile(records, outputPath, columns)` | Pipes an `AsyncIterable` of records — e.g. `queryRecords()` — straight to a CSV file. Resolves to `{ recordCount }`. |
| `CsvFileWriter`                                       | The writer handle returned by `createCsvFileWriter`.                                                                 |

### `sfdx-project.json`

| Export                                                                  | Description                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `readSfdxProject(dir?)`                                                 | Reads and parses the project file.                                                                                                          |
| `getDefaultPackageDirectory(project)`                                   | Returns the entry flagged `default: true`.                                                                                                  |
| `getPluginConfig(source, keyPath)`                                      | Walks a dot-delimited path (e.g. `plugins.simply.dependencies.ignore`) through any object, returning `undefined` if any segment is missing. |
| `SFDX_PROJECT_FILE_NAME`                                                | `'sfdx-project.json'`.                                                                                                                      |
| `SfdxProject`, `SfdxPackageDirectory`, `SfdxPackageDirectoryDependency` | Types for the parsed file.                                                                                                                  |

### Package IDs

| Export                                                                                                                                         | Description                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `isPackage2Id`, `isPackage2VersionId`, `isSubscriberPackageId`, `isSubscriberPackageVersionId`                                                 | Prefix predicates for the four package ID kinds.                  |
| `PACKAGE_PREFIX_PACKAGE2`, `PACKAGE_PREFIX_PACKAGE2_VERSION`, `PACKAGE_PREFIX_SUBSCRIBER_PACKAGE`, `PACKAGE_PREFIX_SUBSCRIBER_PACKAGE_VERSION` | The prefixes those predicates check (`0Ho`, `05i`, `033`, `04t`). |

### Metadata package attribution

| Export                                                              | Description                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `resolvePackageNamesByApiName(conn, apiNames, options?)`            | Maps metadata API names to the installed package that owns them.                          |
| `resolvePackageNamesBySubjectId(conn, subjectIds, options?)`        | The same, keyed by subject ID.                                                            |
| `normalizePublisherName(publisherName, fallbackLabel)`              | Normalizes a publisher name for display, falling back to `fallbackLabel` when absent.     |
| `LOCAL_PACKAGE_LABEL`, `LOCAL_PUBLISHER_NAME`                       | Labels used for metadata that belongs to the org itself rather than an installed package. |
| `ResolvePackageNamesByApiNameOptions`, `ResolvePackageNamesOptions` | Option types.                                                                             |

### Config files

| Export                                                | Description                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `loadJsonConfig(path, schema)` / `loadJsonConfigSync` | Reads a JSON config file and validates it against a schema. |
| `parseJsonConfig(contents, schema)`                   | The same, from an already-read string.                      |
| `ConfigSchema`, `JsonConfigResult`                    | Schema and result types.                                    |

### `.sfdevrc.json`

The project-local config file shared by the SimplySF plugins. This package owns the platform-agnostic
base fields; each consumer adds and validates its own sections. See
[design doc 0059](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0059-sfdevrc-shared-config.md).

```json
{
  "vcs": { "provider": "gitlab", "host": "gitlab.example.com", "projectId": "12345" },
  "alm": { "provider": "jira", "projectKeys": ["ABC"], "baseUrl": "https://example.atlassian.net/browse" },
  "branchRegex": "^(feature|bugfix)/ABC-\\d+"
}
```

| Export                                                                      | Description                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadSfDevRc({ cwd, schema, warn, env })`                                   | Reads `.sfdevrc.json` (or legacy `.sfdevrc`), rewrites legacy fields, overlays `SIMPLY_*` env vars, validates. Throws `SfDevRcError` if malformed. |
| `sfDevRcSchema`                                                             | The base zod schema. Unknown sections pass through; extend it with `sfDevRcSchema.extend({ ... })` for your own sections.                          |
| `resolveVcsProviderKind(config, explicit?, fallback?)`                      | Flag > `vcs.provider` (env or file) > fallback (`'gitlab'`).                                                                                       |
| `resolveAlmProviderKind(config, explicit?, fallback?)`                      | Flag > `alm.provider` (env or file) > fallback (`'jira'`).                                                                                         |
| `resolveVcsSettings(config, explicit?, fallback?)`                          | Provider plus `host`/`projectId`; config values apply only when the config describes the resolved provider.                                        |
| `resolveAlmProjectKeys(config, explicit?)`                                  | Flag keys > `alm.projectKeys` (env or file) > `[]`, deduplicated.                                                                                  |
| `SFDEVRC_ENV_VARS`                                                          | The environment variable name for each base field (below).                                                                                         |
| `findSfDevRcPath(cwd?)`                                                     | The file that `loadSfDevRc` would read, if any.                                                                                                    |
| `VCS_PROVIDER_KINDS`, `ALM_PROVIDER_KINDS`                                  | The known provider names. `VcsProviderKind`/`AlmProviderKind` are derived from them.                                                               |
| `SFDEVRC_FILENAME`, `LEGACY_SFDEVRC_FILENAME`, `SfDevRcError`               | File names and the error thrown for a malformed file.                                                                                              |
| `SfDevRc`, `LoadSfDevRcOptions`, `LoadSfDevRcResult`, `ResolvedVcsSettings` | Types.                                                                                                                                             |

Legacy fields are still read, with a deprecation warning: `gitlabProjectId` → `vcs`,
`jiraProjectKey(s)` → `alm` (provider `jira`), `almProjectKey(s)` → `alm.projectKeys`. A new-style
section always wins over its legacy fields.

Each base field can also be set from the environment. Precedence is flag > environment > file >
fallback. Blank values count as unset.

| Variable                  | Field             |
| ------------------------- | ----------------- |
| `SIMPLY_VCS_PROVIDER`     | `vcs.provider`    |
| `SIMPLY_VCS_HOST`         | `vcs.host`        |
| `SIMPLY_VCS_PROJECT_ID`   | `vcs.projectId`   |
| `SIMPLY_ALM_PROVIDER`     | `alm.provider`    |
| `SIMPLY_ALM_PROJECT_KEYS` | `alm.projectKeys` |
| `SIMPLY_ALM_BASE_URL`     | `alm.baseUrl`     |
| `SIMPLY_BRANCH_REGEX`     | `branchRegex`     |

`SIMPLY_ALM_PROJECT_KEYS` is comma-separated. If `SIMPLY_VCS_PROVIDER` or `SIMPLY_ALM_PROVIDER`
names a different provider than the file, the file's whole section is ignored. A bad value throws
`SfDevRcError` naming the variable. Pass `env: {}` to read the file alone.

### VCS providers

A client for each source-control platform, so callers never encode one platform's API. These moved
here from `@simplysf/simply-cicd-core`, which still re-exports every name unchanged and shares the
same registry. See
[design doc 0061](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0061-project-release-create.md).

| Export                             | Description                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `createVcsProvider(kind, options)` | Builds a `VcsProvider` for a registered platform (`'github'`, `'gitlab'`), given host/token options. |
| `listVcsProviderKinds()`           | The VCS platforms currently registered.                                                              |
| `registerVcsProvider(...)`         | Registers a custom `VcsProvider` implementation without modifying this package.                      |
| `GitHubProvider`                   | A `VcsProvider` backed by the GitHub REST API: branches, pull requests, CI variables, and releases.  |
| `GitLabProvider`                   | A `VcsProvider` backed by the GitLab REST API v4, with the same surface as `GitHubProvider`.         |

`findRelease`, `createRelease`, and `setDefaultBranch` are optional `VcsProvider` members, so a provider
written before they existed still compiles. Both built-in providers implement them, so check for one
before calling it. `createRelease` needs an existing tag, since GitHub would otherwise create one from
the default branch.

```ts
import { createVcsProvider, loadSfDevRc, resolveVcsSettings } from '@simplysf/simply-core';

const { config } = loadSfDevRc();
const { kind, host, projectId } = resolveVcsSettings(config);
const vcs = createVcsProvider(kind, { host, token: process.env.SIMPLY_VCS_TOKEN! });
await vcs.createRelease?.(projectId!, { tagName: 'v1.2.0.13', name: 'v1.2.0' });
```

Types: `VcsProvider`, `VcsProviderFactory`, `VcsProviderOptions`, `VcsProject`, `VcsProjectRef`,
`VcsBranch`, `VcsCommit`, `VcsCommitLogEntry`, `VcsMergeRequest`, `VcsProjectVariable`, `VcsRelease`,
`VcsReleaseInput`, `VcsTerminology`, `VcsCiContext`.

### Collections and paths

| Export                                       | Description                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chunk(items, size)`                         | Splits an array into fixed-size chunks.                                                                                                                                                                                  |
| `mapChunked(items, size, mapper)`            | Maps an async `mapper` over an array one chunk at a time, awaiting each chunk before the next.                                                                                                                           |
| `mapConcurrent(source, concurrency, mapper)` | Maps an async `mapper` over an `AsyncIterable`/`Iterable` source with a fixed-size worker pool — the next item starts as soon as a slot frees, instead of waiting for a whole chunk. Yields results in completion order. |
| `ensureDirectory(path)`                      | Creates a directory (and parents) if it doesn't already exist.                                                                                                                                                           |
| `timestampForFileName(date?)`                | A filesystem-safe timestamp, for generated output file names.                                                                                                                                                            |

### Resilience

| Export                          | Description                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retryWithBackoff(fn, options)` | Calls `fn`, retrying on failure up to `options.retryAttempts` more times with an exponentially growing delay (`backoffFactor` × `initialDelay`, default 1s), before rethrowing the last error. `shouldRetry` can veto a retry per error; `onRetry` fires before each delay. |
| `RetryWithBackoffOptions`       | Option type.                                                                                                                                                                                                                                                                |

```ts
import { retryWithBackoff } from '@simplysf/simply-core';

const result = await retryWithBackoff(() => connection.query('SELECT Id FROM Account LIMIT 1'), {
  retryAttempts: 3,
  backoffFactor: 2,
});
```

### API budget

| Export                                                        | Description                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkApiBudget(conn, plannedRequests, options)`              | Works out whether a run of `plannedRequests` API calls fits inside `options.maxUsagePercent` of the org's _remaining_ daily allocation — read from the `Sforce-Limit-Info` header when jsforce has seen one, else from `/limits`. Never throws for an unreadable allocation: `status` is `ok`, `exceeded`, or `unavailable`. |
| `apiBudgetError(result, maxUsagePercent)`                     | Builds the `SfError` to throw when a run doesn't fit, with the planned/remaining/limit/budget figures in the message.                                                                                                                                                                                                        |
| `ApiBudgetResult`, `ApiBudgetSource`, `CheckApiBudgetOptions` | Result, allocation-source (`header`/`limits-api`), and option types.                                                                                                                                                                                                                                                         |

```ts
import { apiBudgetError, checkApiBudget } from '@simplysf/simply-core';

const result = await checkApiBudget(connection, /* plannedRequests */ 500, { maxUsagePercent: 80 });
if (result.status === 'exceeded') {
  throw apiBudgetError(result, 80);
}
```

### Metadata manifests

| Export                                             | Description                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readPackageManifestMembers(xmlContent, typeName)` | Reads the `<members>` of the `<types>` block named `typeName` out of a `package.xml`/`destructiveChanges.xml` document. `[]` if the type isn't present. |

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
