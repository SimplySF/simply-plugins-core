# 0053 — Moving the rest of `simply-cicd`'s `common/` into `simply-cicd-core`

**Status:** In progress (implemented on `refactor/cicd-core-common` in both repos; awaiting publish of
`@simplysf/simply-cicd-core@0.3.0`)
**Package:** `packages/simply-cicd-core` (grows, in `simply-plugins-core`); `packages/simply-cicd` (CLI,
slimmed, in `simply-plugins`)
**Date:** 2026-10-28

## Problem

[0037](0037-simply-cicd-core.md) created `@simplysf/simply-cicd-core` with only `alm/` and `vcs/`, and
deliberately left the rest of `simply-cicd`'s `src/common/` (~5,900 lines across `build/`, `deploy/`,
`notify/`, `sfdxDependabot/`, `happySoup/`, `schemas/`, `exec/`, `flags/` and the top-level kernel
files) in the plugin. Its reasoning was 0019's criterion 3: no non-CLI consumer was asking for that
code.

That trade-off is now being revisited deliberately. Keeping the pipeline logic inside an oclif plugin
means the only way to run a build or deploy stage is to install the `sf` plugin and shell out to it,
and it leaves `simply-cicd` as the one plugin whose `common/` was never split — every other plugin is
already a thin command layer over its `-core` package. The goal of this doc is to make `simply-cicd`
match that shape: commands parse flags and call `@simplysf/simply-cicd-core`; everything else lives in
the library.

Re-verified for this doc:

- **Only one file in `common/` reaches outside `common/`:** `sfPlugins.ts` imports two one-line
  constant lists from `src/config/` (`DEFAULT_DEPLOYMENT_PLUGINS`, `TRUSTED_PLUGINS`), and nothing
  else in the plugin uses them. They move along with it (see Decision). No file does an
  `import.meta.url` asset lookup or a `messages/` load, apart from the three files below.
  (Implementation finding: the first draft of this doc missed `config/`, because the check only
  looked for `../../` imports.)
- **Exactly three files are framework-coupled:** `build/flags.ts`, `deploy/flags.ts` and
  `deploy/stageCommand.ts` import `Flags` from `@salesforce/sf-plugins-core` and load
  `@simplysf/simply-cicd`'s `messages/*.md` via `Messages.loadMessages`. They are oclif flag
  declarations and cannot live in a library package.
- **`logger.ts`** writes to the console via `chalk`/`log-symbols`. It has no framework dependency, and
  `simply-project-setup-core/src/log.ts` is precedent for a `-core` package writing progress output
  directly.

## Decision

Move **every file in `simply-cicd/src/common/`** into `packages/simply-cicd-core/src/`, preserving the
directory layout, **except** the oclif flag declarations:

| Stays in `simply-cicd/src/common/` | Why                                                                   |
| ---------------------------------- | --------------------------------------------------------------------- |
| `build/flags.ts`                   | `sf-plugins-core` `Flags` + `simply-cicd` messages                    |
| `deploy/flags.ts`                  | same                                                                  |
| `deploy/stageCommand.ts` (slimmed) | keeps only `projectStageFlags` / `happySoupStageFlags` (flag objects) |

`simply-cicd/src/config/` (`defaultDeploymentPlugins.ts`, `trustedPlugins.ts`) moves to
`simply-cicd-core/src/config/`, used internally by `sfPlugins.ts` and not exported from the barrel.
The plugin's `src/config/` directory is deleted.

`deploy/stageCommand.ts` is split: its framework-free half — the `ProjectStageFlagValues` /
`HappySoupStageFlagValues` types and the `toProjectStageOptions` / `toHappySoupStageOptions` mappers —
moves to `simply-cicd-core/src/deploy/stageOptions.ts`. The plugin file keeps only the flag objects.

Files are moved by **plain copy** (a normal commit), not `git subtree`. `simply-cicd-core` already
contains a subtree-added slice of the same `common/` history from 0037; a second subtree add would
duplicate that history. Pre-move history stays in `simply-plugins`.

### Export-name collisions

`simply-cicd-core` exposes a single root barrel like every other `-core` package. Six names collide
when `common/` is flattened into one barrel; they are renamed at the source (the plugin is the only
caller):

| File                              | Before                              | After                                          |
| --------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `deploy/deployCommon.ts`          | `installPackageDependencies`        | `installDeployPackageDependencies`             |
| `deploy/deployCommon.ts`          | `InstallPackageDependenciesConfig`  | `DeployInstallPackageDependenciesConfig`       |
| `deploy/deployCommon.ts`          | `runApexTests`                      | `runDeployApexTests`                           |
| `notify/happySoupNotification.ts` | `beforeScript` / `afterScript`      | `happySoupNotifyBeforeScript` / `…AfterScript` |
| `notify/projectNotification.ts`   | `beforeScript` / `afterScript`      | `projectNotifyBeforeScript` / `…AfterScript`   |
| `notify/buildNotification.ts`     | `resolveSubscriberPackageVersionId` | `resolveBuiltSubscriberPackageVersionId`       |

The `sfApex.ts` / `sfPackages.ts` / `build/utamPageObjects.ts` versions keep their names — they are
the general-purpose ones; the `deploy/` and `notify/` versions are stage-specific wrappers.

## Alternatives considered

**Keep 0037's boundary (do nothing).** Rejected — this doc exists to change it; see Problem.

**Move `build/flags.ts`, `deploy/flags.ts` and `stageCommand.ts` too.** Rejected: they would pull
`@salesforce/sf-plugins-core` and the plugin's `messages/` into a library package, breaking the
framework-independence every `-core` package (and the `libraryPackages` ESLint scope) assumes.

**Keep `stageCommand.ts` whole in the plugin.** Rejected in favour of the split: the mappers are pure
functions over plain types, and moving them leaves the plugin holding nothing but flag declarations.

**Subpath exports (`@simplysf/simply-cicd-core/deploy`, `/notify`, …) instead of renames.** Would avoid
renaming but doesn't fully work — `beforeScript`/`afterScript` collide _within_ `notify/` — and no
other `-core` package uses subpath exports.

**Preserve history via `git subtree split`.** Rejected; see Decision.

## Behavior

### `@simplysf/simply-cicd-core`

`src/index.ts` re-exports every moved module alongside the existing `alm`/`vcs` barrels. Function
signatures and behavior are unchanged apart from the six renames above. This is purely additive for
existing consumers of `0.2.x`, so the release is a **minor** bump (`0.3.0`).

Runtime dependencies added to `package.json` (versions matched to what `simply-cicd` uses today):
`@salesforce/core`, `@salesforce/kit`, `chalk`, `execa`, `handlebars`, `log-symbols`, `zod`, and
`workspace:^` ranges for `@simplysf/simply-core`, `@simplysf/simply-package-core` and
`@simplysf/simply-permissions-core`.

Console output (the `[SIMPLY-CICD]`-prefixed `logger`) is unchanged; it now originates in the library.

### `@simplysf/simply-cicd`

- `src/common/` shrinks to `build/flags.ts`, `deploy/flags.ts`, `deploy/stageCommand.ts`.
- Every command that imported `../../common/...` imports from `@simplysf/simply-cicd-core` instead.
- `src/config/` is deleted (moved to core).
- `@simplysf/simply-cicd-core` bumps to `^0.3.0`. Nine dependencies used only by moved code are dropped
  from `simply-cicd`'s `package.json`: `@salesforce/kit`, `@simplysf/simply-core`,
  `@simplysf/simply-package-core`, `@simplysf/simply-permissions-core`, `chalk`, `execa`,
  `handlebars`, `log-symbols`, `zod`. (`@salesforce/ts-types` was already unused before this change
  and is left alone as out of scope.)
- **No user-visible change**: same commands, flags, messages, output and exit behavior.
  `command-snapshot.json` and the README command reference should not change.

## Implementation plan

1. **`simply-plugins-core`**: copy `simply-cicd/src/common/**` (minus the three flag files) into
   `packages/simply-cicd-core/src/`; add `deploy/stageOptions.ts`; rewrite the moved files'
   `@simplysf/simply-cicd-core` imports to relative `../alm`/`../vcs` imports; apply the renames; extend
   `src/index.ts`; add dependencies.
2. Copy `simply-cicd/test/common/**` to `packages/simply-cicd-core/test/`, adjusting import paths and
   renamed symbols; extend `test/index.test.ts`'s export list.
3. Update `simply-cicd-core`'s README (public API) and its docs-site guide; add this doc's row to
   `docs/design/README.md`.
4. `pnpm install && pnpm run build && pnpm test` at the `simply-plugins-core` root.
5. **`simply-plugins`**: delete the moved files and tests; slim `stageCommand.ts`; repoint command
   imports; bump the dependency; add this doc's duplicate and index row.
6. Verify `simply-plugins` locally against the unpublished core; `pnpm run build && pnpm test` for `simply-cicd`; confirm `command-snapshot.json`
   and README are unchanged.
7. Release order: merge and publish `simply-plugins-core` first (`simply-cicd-core@0.3.0`), add the
   `minimumReleaseAgeExclude` entry in `simply-plugins`' `pnpm-workspace.yaml`, then merge
   `simply-plugins`.

## Testing

**Unit** — every `test/common/**` file moves with its subject and must pass unchanged apart from import
paths and renamed symbols. Tests for the three flag files (none exist today) and all command tests stay
in `simply-cicd` and must pass after the import repoint.

**Command tests that reached through the boundary** (implementation finding). Most `simply-cicd`
command tests already mocked the one `common/` function their command calls; those became partial
mocks of `@simplysf/simply-cicd-core`. Five didn't: they mocked `node:fs`, `execa`, `logger` or
`@simplysf/simply-core` and asserted on what the moved code did with them. Once that code is in a
published package, Vitest loads it as an external dependency and those mocks no longer reach it. Their
behavior assertions moved to new core tests, and the command tests now check flag-to-options mapping:

| `simply-cicd` command test                                                                 | Behavior coverage moved to (core)                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `deploy/validate`, `deploy/project/validate`, `deploy/happy-soup/validate`                 | `test/deploy/validate.test.ts` (9 cases)               |
| `notify/project`                                                                           | `test/notify/projectNotification.test.ts` (7 cases)    |
| `sfdx-dependabot` (`resolvePackageDetails`/`filterProject`/`generateMrDescription` blocks) | `test/sfdxDependabot/dependabotRun.test.ts` (17 cases) |

`sfdx-dependabot`'s `run` cases stay end-to-end in the plugin: only `resolvePackageDetails` (the one
call that shells out to `sf`) is mocked, and the VCS traffic still runs against a stubbed global
`fetch`, which does reach into the external package.

Totals: 609 tests before (551 `simply-cicd` + 58 `simply-cicd-core`), 618 after (121 + 497). Nothing
was dropped; 24 plugin cases were rewritten as 33 core cases.

**Local verification against unpublished core** — the published `0.2.2` in `simply-plugins`'
`node_modules/.pnpm` store was temporarily replaced by the local `lib/` build (kept under
`node_modules`, so Vitest still treats it as external, as it will after publish), then restored.
`simply-cicd`'s `build` and `test` wireit pipelines (compile, lint, command snapshot, command
reference, JSON schema, unit tests) all pass, and `command-snapshot.json` has no content change.

**Public API** — `simply-cicd-core`'s `test/index.test.ts` asserts the expanded runtime export list.

**Manual** — none beyond the build/test runs; this is a file-location and dependency-graph change.

## Open questions

- Should `logger` become injectable (the library accepting a caller-supplied logger) so non-CLI
  consumers can silence or redirect output? Out of scope here — behavior is preserved as-is — but it's
  the first thing a non-CLI consumer is likely to ask for.
- `chalk.level = 1` in `logger.ts` mutates a global on import. Harmless inside the CLI; worth revisiting
  together with the logger question.
