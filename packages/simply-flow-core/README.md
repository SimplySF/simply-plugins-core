# @simplysf/simply-flow-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-flow-core?label=@simplysf/simply-flow-core)](https://npmjs.com/@simplysf/simply-flow-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-flow-core.svg)](https://npmjs.com/@simplysf/simply-flow-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Flow deactivation/deletion and obsolete Flow version pruning logic. This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-flow`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-flow)'s `flow delete` and `flow version prune` commands, published separately so it can be imported directly by anything that wants the same logic (an MCP server, a CI job that clears Flows before a destructive deploy, a script) without pulling in the CLI framework.

## Install

```bash
npm install @simplysf/simply-flow-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                                                                               | Description                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deleteFlows(connection, flowNames, options?)`                                                                       | Deactivates each named Flow's definition once, then destroys every version of it. `options.onStage` is called with `'deactivate'` then `'delete'`.        |
| `findObsoleteFlowVersions(connection, flowNames)`                                                                    | Finds the named Flows' `Status = 'Obsolete'` versions. Never returns an active version.                                                                   |
| `deleteFlowVersions(connection, candidates)`                                                                         | Destroys each given Flow version, one Tooling API call per version, in order.                                                                             |
| `pruneObsoleteFlowVersions(connection, flowNames, options?)`                                                         | `findObsoleteFlowVersions`, then, unless `options.dryRun`, `deleteFlowVersions`. `options.onStage` is called with `'query'` and, if deleting, `'delete'`. |
| `findFlowNamesInSource(sourceDirs)`                                                                                  | Globs `**/*.flow-meta.xml` under each directory and returns the Flow DeveloperNames, deduplicated in first-occurrence order.                              |
| `developerNameFromFlowFile(filePath)`                                                                                | `Account_Before_Save.flow-meta.xml` → `Account_Before_Save`.                                                                                              |
| `FLOW_QUERY_CHUNK_SIZE`                                                                                              | DeveloperNames per Tooling API `IN (...)` clause (`200`); longer lists are queried in chunks.                                                             |
| `FlowDeleteResult`, `FlowDeleteFailure`, `FlowDeleteStage`, `DeleteFlowsOptions`                                     | Result, per-item failure, stage, and option types for `deleteFlows`.                                                                                      |
| `FlowVersionPruneResult`, `FlowVersionPruneCandidate`, `FlowVersionPruneFailure`, `PruneObsoleteFlowVersionsOptions` | Result, candidate, per-version failure, and option types for the prune functions.                                                                         |

**Errors.** Per-item failures from the Tooling API `update`/`destroy` calls — whether a `success: false` result or a thrown error — are collected into the result's `failures`, never thrown. A failed query rejects. None of these functions set `process.exitCode` or write to stdout or stderr.

```ts
import fs from 'node:fs/promises';
import { readPackageManifestMembers } from '@simplysf/simply-core';
import { deleteFlows } from '@simplysf/simply-flow-core';

const flowNames = readPackageManifestMembers(await fs.readFile('destructiveChanges.xml', 'utf-8'), 'Flow');
const result = await deleteFlows(connection, flowNames, {
  onStage: (stage) => console.log(`${stage}...`), // 'deactivate' | 'delete'
});
// { deactivated: string[]; deleted: string[]; failures: FlowDeleteFailure[] }
```

```ts
import { findFlowNamesInSource, pruneObsoleteFlowVersions } from '@simplysf/simply-flow-core';

const flowNames = await findFlowNamesInSource(['force-app']);
const result = await pruneObsoleteFlowVersions(connection, flowNames, { dryRun: true });
// { dryRun: true; candidates: FlowVersionPruneCandidate[]; deleted: []; failures: [] }
```

To confirm before deleting, split the prune into its two steps so exactly the confirmed list is deleted, with no second query:

```ts
import { deleteFlowVersions, findObsoleteFlowVersions } from '@simplysf/simply-flow-core';

const candidates = await findObsoleteFlowVersions(connection, flowNames);
if (await confirm(`Delete ${candidates.length} obsolete Flow versions?`)) {
  const { deleted, failures } = await deleteFlowVersions(connection, candidates);
}
```

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`simply-plugins-core`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
