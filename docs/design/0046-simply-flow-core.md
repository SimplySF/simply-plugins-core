# 0046 — Splitting `simply-flow-core` out of `simply-flow`

**Status:** In progress (simply-flow-core implemented; simply-plugins companion PR pending its publish)
**Package:** new `packages/simply-flow-core` (in `simply-plugins-core`); `packages/simply-flow` (CLI,
slimmed, in `simply-plugins`)
**Date:** 2026-10-16

## Problem

`simply-flow` is the only `simply` plugin with org-touching logic that has no `-core` package. It
wasn't in [0027](0027-core-extraction-round-1-post-split.md)'s round 1. Its two commands,
`flow delete` and `flow version prune`, keep all their logic in `run()`:

- **`src/commands/simply/flow/delete.ts`** (161 lines): resolves Flow names from `--manifest` (via
  `simply-core`'s `readPackageManifestMembers`) or `--flow-name`. It queries `Flow` through the
  Tooling API with `chunkedInQuery` (chunks of 200), deactivates each distinct `FlowDefinition`
  (`Metadata.activeVersionNumber = 0`), queries again, and destroys every `Flow` version. Failures
  are collected per Flow, per stage (`deactivate` | `delete`).
- **`src/commands/simply/flow/version/prune.ts`** (162 lines): resolves Flow names by globbing
  `**/*.flow-meta.xml` under `--source-dir`, or from `--flow-name`. It queries
  `Status = 'Obsolete'` versions and, unless `--dry-run`, destroys each one, collecting failures
  per version.

There is no `src/common/`. The org logic is mixed in with spinner, table and `process.exitCode`
handling. Nothing outside the CLI can reuse it, so a plain-Node consumer would have to copy it.
There is now such a consumer: simply-plugins'
[0047 — `simply-sf-mcp`](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0047-simply-sf-mcp-server.md)
wants `flow delete` and `flow version prune` as MCP tools, and 0047 lists this extraction as the
thing blocking them. CI scripts that delete Flows before a destructive deploy are a second likely
consumer.

## Decision

Add **`@simplysf/simply-flow-core`** to this repo. Unlike 0028–0033, this is **a refactor, not a
subtree move**: there is no `common/` directory to split out, so the org logic is pulled out of the
two `run()` bodies into plain functions, which are then moved. Results and per-item failure handling
stay exactly as they are today.

What stays in the CLI: flag parsing, the "exactly one of `--manifest`/`--flow-name`" and "exactly
one of `--source-dir`/`--flow-name`" checks (they're about flags), reading the manifest file,
spinners, failure tables, `info` summaries, and setting `process.exitCode = 1` when there are
failures.

What moves: everything that talks to the org, and the source-directory scan that turns
`*.flow-meta.xml` files into DeveloperNames.

## Behavior

### `@simplysf/simply-flow-core` — new package

```ts
import { deleteFlows } from '@simplysf/simply-flow-core';

const result = await deleteFlows(connection, ['Account_Before_Save', 'Lead_Router'], {
  onStage: (stage) => spinner.start(stage), // 'deactivate' | 'delete'
});
// { deactivated: string[]; deleted: string[]; failures: FlowDeleteFailure[] }
```

```ts
import { findFlowNamesInSource, pruneObsoleteFlowVersions } from '@simplysf/simply-flow-core';

const flowNames = await findFlowNamesInSource(['force-app']);
const result = await pruneObsoleteFlowVersions(connection, flowNames, { dryRun: true });
// { dryRun: boolean; candidates: FlowVersionPruneCandidate[]; deleted: string[]; failures: FlowVersionPruneFailure[] }
```

Full export list:

| File                  | Exports                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flowTypes.ts`        | `type FlowDeleteFailure`, `type FlowDeleteResult`, `type FlowDeleteStage`, `type FlowVersionPruneCandidate`, `type FlowVersionPruneFailure`, `type FlowVersionPruneResult` |
| `flowDelete.ts`       | `deleteFlows`, `type DeleteFlowsOptions`                                                                                                                                   |
| `flowVersionPrune.ts` | `findObsoleteFlowVersions`, `deleteFlowVersions`, `pruneObsoleteFlowVersions`, `type PruneObsoleteFlowVersionsOptions`                                                     |
| `flowSource.ts`       | `findFlowNamesInSource`, `developerNameFromFlowFile`                                                                                                                       |
| `flowQueries.ts`      | `FLOW_QUERY_CHUNK_SIZE` (200)                                                                                                                                              |

Signatures:

| Function                                                     | Returns                                | Notes                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deleteFlows(connection, flowNames, options?)`               | `Promise<FlowDeleteResult>`            | Today's algorithm, step for step: query, deactivate each distinct definition, query again, destroy each version. `options.onStage(stage)` is called before each stage. An empty `flowNames` returns an empty result without touching the org. |
| `findObsoleteFlowVersions(connection, flowNames)`            | `Promise<FlowVersionPruneCandidate[]>` | `Status = 'Obsolete'` query only. Empty input returns `[]` with no query.                                                                                                                                                                     |
| `deleteFlowVersions(connection, candidates)`                 | `Promise<{ deleted; failures }>`       | One Tooling `destroy` per candidate, in order.                                                                                                                                                                                                |
| `pruneObsoleteFlowVersions(connection, flowNames, options?)` | `Promise<FlowVersionPruneResult>`      | `find…` then, unless `options.dryRun`, `delete…`. `options.onStage('query' \| 'delete')` is called the same way as for `deleteFlows`.                                                                                                         |
| `findFlowNamesInSource(sourceDirs)`                          | `Promise<string[]>`                    | `glob('<dir>/**/*.flow-meta.xml')` per directory (backslashes normalized), basename → DeveloperName, deduplicated. Order: first occurrence.                                                                                                   |
| `developerNameFromFlowFile(filePath)`                        | `string`                               | `Account_Before_Save.flow-meta.xml` → `Account_Before_Save`.                                                                                                                                                                                  |

**Errors.** Per-item failures from Tooling `update`/`destroy`, whether `success: false` or a thrown
error, are collected into `failures` and never thrown, as today. Query failures (`chunkedInQuery`
rejecting) are thrown to the caller, as today. The functions never set `process.exitCode` or write
to stdout or stderr.

**`onStage` instead of a logger.** The CLI's spinner text is the only reason the commands need to
know when each stage starts. A callback keeps the library free of UI code, and an MCP server can use
it to send progress notifications. It is optional.

`package.json` shape: the same as `simply-data-core`'s (0031), with:

```json
{
  "name": "@simplysf/simply-flow-core",
  "version": "0.1.0",
  "dependencies": {
    "@salesforce/core": "^8.30.0",
    "@simplysf/simply-core": "workspace:^1.6.11",
    "glob": "^13.0.6"
  }
}
```

There is no `oclif` block, no `bin/`, no `messages/`, and no `@oclif/core`,
`@salesforce/sf-plugins-core` or `@simplysf/simply-plugin-kit`.

### `@simplysf/simply-flow` — CLI, slimmed (in `simply-plugins`)

- `delete.ts`: validates the flags, reads the manifest, calls `deleteFlows` with an `onStage` that
  drives the spinner, then prints the failure table and summary and sets `exitCode` exactly as it
  does today.
- `prune.ts`: validates the flags, calls `findFlowNamesInSource` or uses `--flow-name`, calls
  `pruneObsoleteFlowVersions` with `dryRun`, then prints the candidate or failure table and summary
  exactly as it does today.
- The result types (`FlowDeleteResult` etc.) are re-exported from the command files so the
  `--json` shape and any `import type` users keep working.
- `package.json` gains `@simplysf/simply-flow-core: "^0.1.0"`. It drops `glob`, which `prune.ts`
  was its only user of (confirm with a grep at implementation time).
- Flags, messages, `--json` output and exit codes are **unchanged**. `command-snapshot.json` must
  not change.

### Public-API test (in `simply-flow-core`)

`test/index.test.ts` checks `Object.keys(api).sort()` against:
`['FLOW_QUERY_CHUNK_SIZE', 'deleteFlowVersions', 'deleteFlows', 'developerNameFromFlowFile', 'findFlowNamesInSource', 'findObsoleteFlowVersions', 'pruneObsoleteFlowVersions']`.

## Alternatives considered

- **Leave the logic in the plugin and have 0047's MCP server import the command classes.** That
  pulls oclif and `sf-plugins-core` into the MCP server and runs a CLI parse for every call, which
  is exactly the coupling 0019/0027 removed everywhere else.
- **Add the functions to `simply-core` instead of a new package.** `simply-core` holds generic
  utilities (querying, CSV, manifests). Flow deactivation and deletion is domain logic, like Apex
  logs or Content Versions, and every other domain has its own `-core`. A separate package also
  keeps `glob` out of `simply-core`'s dependencies.
- **A subtree split to keep history, as in 0028–0033.** There is no directory to split. The code
  being moved is part of two command files that stay in `simply-plugins`, so a split would bring the
  whole command files across and then mostly delete them. The history stays readable in
  `simply-plugins`, and this doc links to it.
- **One `pruneObsoleteFlowVersions` with no `find…`/`delete…` split.** The split lets a caller show
  the candidates, ask for confirmation, then delete exactly that list without querying again. An
  MCP client's approval prompt needs that, and a single call can't do it. The combined function
  stays for the CLI's simple case.
- **Moving the "exactly one of" flag checks into core.** They describe flags, not operations. Core
  takes a resolved `string[]`, so there is nothing for it to check.
- **Making `deleteFlows` take a manifest path.** Core would then read files for a mode the MCP
  server and CI callers may not use. `readPackageManifestMembers(xml, 'Flow')` is already one call
  from `simply-core`.

## Implementation plan

**In `simply-plugins-core`:**

1. Scaffold `packages/simply-flow-core`: `package.json` as in Behavior, and `tsconfig.json`,
   `test/tsconfig.json` and `.gitignore` copied from `simply-data-core`.
2. `src/flowTypes.ts`: move the six result and failure types out of the two command files
   unchanged, and add `FlowDeleteStage = 'deactivate' | 'delete'`.
3. `src/flowQueries.ts`: `FLOW_QUERY_CHUNK_SIZE`.
4. `src/flowDelete.ts`: `deleteFlows`, taken from `delete.ts` lines 88–159 with the
   spinner/table/`info`/`exitCode` lines replaced by `onStage` and a return. Keep the two
   `no-await-in-loop` disables and their reasons.
5. `src/flowVersionPrune.ts`: `findObsoleteFlowVersions`, `deleteFlowVersions`, and
   `pruneObsoleteFlowVersions` composing them, taken from `prune.ts` lines 107–160.
6. `src/flowSource.ts`: `findFlowNamesInSource` and `developerNameFromFlowFile`, taken from
   `prune.ts` lines 52–55 and 96–101.
7. `src/index.ts`: the barrel.
8. Tests (see Testing).
9. `README.md` (`## API` section), `CONTRIBUTING.md` (copy `simply-data-core`'s and swap the
   package paragraph), and `site/src/content/docs/guides/simply-flow-core.md` with a sidebar entry.
10. `eslint.config.mjs`: add `packages/simply-flow-core` to `allPackages` and `libraryPackages`.
    Root `README.md` package table and install list, `CONTRIBUTING.md` repo structure table, and
    this doc's row in `docs/design/README.md`.
11. Merge and publish. Expect the trusted-publisher first-publish constraint from 0028–0033: a
    one-time manual `pnpm publish --access public --no-git-checks` from the package directory.

**In `simply-plugins`** (companion PR, after `0.1.0` is on npm):

12. Add a `minimumReleaseAgeExclude` entry for the fresh version in `pnpm-workspace.yaml` if the
    install needs one.
13. Slim `delete.ts` and `prune.ts` as described in Behavior, and update `package.json`.
14. Run `pnpm run build` and confirm `command-snapshot.json` has **no diff**. Run `pnpm run readme`
    in `simply-flow` and `packages/simply`.
15. Copy this doc into `simply-plugins`' `docs/design/` and update the "Open questions" entry in
    0047 to point at it.

## Testing

**Unit tests in `simply-flow-core`** (vitest, `Connection` from `@salesforce/core/testSetup` with
`autoFetchQuery` and `tooling.sobject(...)` stubbed). The logic assertions from the two existing
command test files move here:

- `deleteFlows`
  - Empty input: no query, empty result.
  - Two versions of one Flow deactivate their definition **once**.
  - A deactivation failure (`success: false`, and separately a throw) is recorded with
    `stage: 'deactivate'`, and every version of that Flow is still destroyed. This is the existing
    "records a deactivation failure but still deletes every version" case.
  - A destroy failure is recorded with `stage: 'delete'`, and the other versions continue.
  - `onStage` is called with `deactivate` then `delete`, once each.
  - More than 200 names produce more than one chunked query.
- `findObsoleteFlowVersions` / `deleteFlowVersions` / `pruneObsoleteFlowVersions`
  - Only `Status = 'Obsolete'` appears in the query.
  - `dryRun` returns the candidates and never calls `destroy`.
  - Not `dryRun`: every candidate is destroyed, and failures are collected per version.
- `findFlowNamesInSource`
  - Several directories, nested folders, the same Flow in two directories (deduplicated),
    Windows-style separators, and a directory with no Flows (`[]`).
- `index.test.ts`: the public-API key list.

**`simply-flow` command tests (in `simply-plugins`)**: keep the flag-validation cases (both
"rejects …" pairs) and one happy path per command against the real core package. The deeper cases
now live in core. `command-snapshot.json` must be unchanged.

**Manual check**: `sf simply flow version prune --dry-run -d force-app` and
`sf simply flow delete -n <throwaway flow>` against a scratch org, with `--json` output
diffed against the pre-change build.

## Open questions

None for this doc. Adding the MCP tools that use this package is tracked in simply-plugins' 0047.
