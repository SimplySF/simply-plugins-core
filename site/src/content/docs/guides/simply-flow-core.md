---
title: simply-flow-core
description: Usage examples for @simplysf/simply-flow-core.
---

Flow deactivation/deletion and obsolete Flow version pruning logic. Full signatures and types are in
the [API reference](/api/simply-flow-core/readme/).

```sh
npm install @simplysf/simply-flow-core
```

Every example below assumes you already have an authenticated `@salesforce/core` `Connection` — see
[Get Started](/getting-started/).

Per-item failures (a Flow that won't deactivate, a version that won't delete) are collected into the
result's `failures` and never thrown, so one bad Flow doesn't stop the rest. A failed query rejects.

## Deleting Flows before a destructive deploy

Salesforce won't remove a Flow that still has an active version. `deleteFlows` deactivates each
Flow's definition once, then destroys every version of it:

```ts
import fs from 'node:fs/promises';
import { readPackageManifestMembers } from '@simplysf/simply-core';
import { deleteFlows } from '@simplysf/simply-flow-core';

const manifest = await fs.readFile('manifest/destructiveChanges.xml', 'utf-8');
const flowNames = readPackageManifestMembers(manifest, 'Flow');

const result = await deleteFlows(connection, flowNames, {
  onStage: (stage) => console.log(`${stage}...`), // 'deactivate', then 'delete'
});

for (const failure of result.failures) {
  console.error(`${failure.developerName} (${failure.stage}): ${failure.message}`);
}
```

## Pruning obsolete Flow versions

`pruneObsoleteFlowVersions` only ever deletes versions the org has already marked
`Status = 'Obsolete'` — never an active Flow. Pass `dryRun` to see what it would delete:

```ts
import { findFlowNamesInSource, pruneObsoleteFlowVersions } from '@simplysf/simply-flow-core';

const flowNames = await findFlowNamesInSource(['force-app']);

const preview = await pruneObsoleteFlowVersions(connection, flowNames, { dryRun: true });
console.table(preview.candidates); // [{ id, developerName }, ...]

const result = await pruneObsoleteFlowVersions(connection, flowNames);
console.log(`Deleted ${result.deleted.length}, failed ${result.failures.length}`);
```

## Confirming before deleting

When a person (or an MCP client's approval prompt) needs to approve the exact list, use the two
halves separately. `deleteFlowVersions` deletes exactly the candidates it's given, without querying
again:

```ts
import { deleteFlowVersions, findObsoleteFlowVersions } from '@simplysf/simply-flow-core';

const candidates = await findObsoleteFlowVersions(connection, flowNames);
if (candidates.length > 0 && (await askForApproval(candidates))) {
  const { deleted, failures } = await deleteFlowVersions(connection, candidates);
}
```
