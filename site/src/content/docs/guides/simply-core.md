---
title: simply-core
description: Usage examples for @simplysf/simply-core.
---

Querying, bulk export, CSV, and `sfdx-project.json` utilities — the everyday helpers that show up in
almost any Salesforce automation script. Full signatures and types are in the [API reference](/api/simply-core/readme/).

```sh
npm install @simplysf/simply-core
```

Every example below assumes you already have an authenticated `@salesforce/core` `Connection` — see
[Get Started](/getting-started/) for how to get one.

## Querying records

`queryRecords` returns an async iterable, so you can stream through large result sets without
holding everything in memory at once. It picks REST or Bulk API v2 for you based on `bulkThreshold`.

```ts
import { queryRecords } from '@simplysf/simply-core';

const records = queryRecords(connection, 'SELECT Id, Name FROM Account');

for await (const record of records) {
  console.log(record.Id, record.Name);
}
```

## Querying a caller-supplied list of values

`chunkedInQuery` splits a list of values across as many `WHERE Id IN (...)` queries as SOQL's length
limit requires, and hands back every record from every chunk:

```ts
import { chunkedInQuery } from '@simplysf/simply-core';

const accountIds = ['001...', '001...', '001...' /* ... hundreds more ... */];

const accounts = await chunkedInQuery(
  connection,
  accountIds,
  (inClause) => `SELECT Id, Name FROM Account WHERE Id IN (${inClause})`,
  { chunkSize: 200 },
);
```

## Writing records to CSV

```ts
import { createCsvFileWriter } from '@simplysf/simply-core';

const writer = createCsvFileWriter('./Accounts_Modified.csv', ['Id', 'Name']);

for await (const record of queryRecords(connection, 'SELECT Id, Name FROM Account')) {
  await writer.write({ Id: record.Id, Name: record.Name });
}

await writer.end();
```

## Splitting work into batches

```ts
import { chunk } from '@simplysf/simply-core';

const ids = ['001...' /* ... */];
for (const batch of chunk(ids, 200)) {
  // e.g. one Tooling API delete call per batch of 200
}
```

## Bounding concurrency over a stream

```ts
import { mapConcurrent } from '@simplysf/simply-core';

// `records` can be any AsyncIterable — e.g. rows streamed from `csv-parse` — and is consumed
// lazily, so a large source never has to be fully loaded into memory first.
for await (const result of mapConcurrent(records, 10, (record) => connection.sobject('Account').create(record))) {
  // yielded in completion order as soon as each create resolves, not source order
}
```

## Checking the daily API budget before a bulk operation

```ts
import { checkApiBudget, apiBudgetError } from '@simplysf/simply-core';

const result = await checkApiBudget(connection, /* plannedRequests */ 500, { maxUsagePercent: 80 });

if (result.status === 'exceeded') {
  throw apiBudgetError(result, 80);
}
```

## Reading `sfdx-project.json`

```ts
import { readSfdxProject, getDefaultPackageDirectory } from '@simplysf/simply-core';

const project = await readSfdxProject(projectDir);
const defaultDir = getDefaultPackageDirectory(project);
```

## Reading `.sfdevrc.json`

`loadSfDevRc` validates the shared, platform-agnostic fields (`vcs`, `alm`, `branchRegex`). Extend
the base schema to validate your own section; other consumers' sections pass through untouched.

```ts
import { loadSfDevRc, resolveAlmProviderKind, resolveVcsProviderKind, sfDevRcSchema } from '@simplysf/simply-core';
import { z } from 'zod';

const schema = sfDevRcSchema.extend({
  setup: z.object({ include: z.array(z.string()).optional(), exclude: z.array(z.string()).optional() }).optional(),
});

const { config } = loadSfDevRc({ schema });
const vcsKind = resolveVcsProviderKind(config, flags['vcs-provider']); // flag > env > file > 'gitlab'
const almKind = resolveAlmProviderKind(config, flags['alm-provider']); // flag > env > file > 'jira'
```

`loadSfDevRc` also overlays plugin-neutral environment variables onto the file, so a pipeline can
change a setting per job without editing the committed file. Don't give the matching command flags an
oclif `env:` of their own; the resolvers already apply the variables, below the flag.

```sh
SIMPLY_ALM_PROVIDER=jira SIMPLY_ALM_PROJECT_KEYS=ABC,DEF sf simply cicd notify project
```

The full list is `SFDEVRC_ENV_VARS`: `SIMPLY_VCS_PROVIDER`, `SIMPLY_VCS_HOST`,
`SIMPLY_VCS_PROJECT_ID`, `SIMPLY_ALM_PROVIDER`, `SIMPLY_ALM_PROJECT_KEYS` (comma-separated),
`SIMPLY_ALM_BASE_URL`, and `SIMPLY_BRANCH_REGEX`. Blank values count as unset.

## Retrying a flaky call

```ts
import { retryWithBackoff } from '@simplysf/simply-core';

const result = await retryWithBackoff(() => connection.query('SELECT Id FROM Account LIMIT 1'), {
  retryAttempts: 3,
  backoffFactor: 2,
});
```
