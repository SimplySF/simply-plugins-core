# 0054 — Replacing `sf` CLI shell-outs in `simply-cicd-core` with library calls

**Status:** Draft
**Package:** `packages/simply-cicd-core`; small additions to `packages/simply-package-core` and
`packages/simply-apex-core`
**Date:** 2026-10-28

## Problem

[0053](0053-simply-cicd-core-common.md) moved `simply-cicd`'s pipeline logic into
`@simplysf/simply-cicd-core`, but that logic still talks to Salesforce by spawning the `sf` binary
(`exec/sfCli.ts`'s `runSf`/`runSfJson`, plus one raw `execa('sf', …)`) and parsing its `--json`
stdout. 21 call sites do this, across 16 distinct commands. That has real costs for a library:

- **Every consumer needs a matching `sf` CLI on `PATH`.** A bot or script importing the package
  silently depends on a globally installed CLI with the right plugins, at a version whose JSON
  output shape matches what we parse. Nothing in `package.json` expresses or checks that.
- **Results are untyped.** Each site `JSON.parse`s stdout and casts to a hand-written shape
  (`ScratchOrgCreateResult`, `PackageVersionReport`, `SfAuthResult`, …). A CLI release that renames a
  field breaks us at run time, not compile time.
- **Errors are strings.** Failure handling pattern-matches CLI message text (for example
  `isScratchOrgLimitError`) instead of `SfError.name`.
- **Tests mock the process boundary.** Most tests stub `execa` and assert on argument arrays, which
  pins the CLI's flag spelling rather than behavior.
- **Each call pays a CLI cold start** (oclif config load and plugin discovery), typically 1–3 s.
- **0053's own limitation.** 0037 rejected moving this code partly because "shell out to `sf` and
  parse its stdout" is not how a library consumer talks to Salesforce. 0053 moved it anyway; this doc
  finishes the job.

The sibling packages already do this the library way: `simply-core` (`@salesforce/core`, jsforce),
`simply-package-core` (`@salesforce/packaging`, including package installs) and `simply-apex-core`
(`@salesforce/apex-node`, `@salesforce/source-deploy-retrieve`).

## Decision

Replace every `sf` invocation in `simply-cicd-core` that has a library equivalent with direct calls to
the Salesforce libraries, reusing sibling `-core` packages wherever they already cover the operation.
Do it in **six phases, one PR each**, ordered from lowest to highest risk, keeping every exported
function's signature and observable result unchanged. When the last phase lands, `exec/sfCli.ts`
shrinks to the two `sf plugins` calls that have no library equivalent (see Out of scope).

### Inventory and mapping

| Phase | Call site(s)                                                                                                             | `sf` command                                               | Replacement                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `createPackageVersion.ts:228`, `publishUtamPageObjects.ts:231`, `notify/projectNotification.ts:107`, `sfPackages.ts:130` | `package version report --json` (4× duplicated)            | One shared `getPackageVersionReport()` built on `@salesforce/packaging` `PackageVersion#report()`                                                                    |
| 1     | `deploy/deployHappySoup.ts:155`                                                                                          | `org display --json` (reads `instanceUrl`)                 | `Org.create({ aliasOrUsername })` → `org.getConnection().instanceUrl`                                                                                                |
| 1     | `build/createScratchOrg.ts:85`, `build/cleanupScratchOrgs.ts:29`                                                         | `data query`                                               | `simply-core` `queryRecords()` on the org's `Connection`                                                                                                             |
| 2     | `build/createScratchOrg.ts:87`                                                                                           | `data update record`                                       | `connection.sobject('User').update()`                                                                                                                                |
| 2     | `build/createScratchOrg.ts:32`, `:50`                                                                                    | `org assign permset` / `org assign permset-license`        | Query `PermissionSet` / `PermissionSetLicense` by name, insert `PermissionSetAssignment` / `PermissionSetLicenseAssign` (what `plugin-user` does internally)         |
| 2     | `build/cleanupScratchOrgs.ts:47`                                                                                         | `data bulk delete --sobject ActiveScratchOrg`              | `connection.sobject('ActiveScratchOrg').destroy(ids, { allOrNone: false })` in chunks of 200 (no CSV temp file)                                                      |
| 3     | `sfAuth.ts:85`                                                                                                           | `org login jwt` / `org login sfdx-url`                     | `AuthInfo.create` (JWT `oauth2Options`) / `AuthInfo.parseSfdxAuthUrl`; then `handleAliasAndDefaultSettings({ alias, setDefault, setDefaultDevHub })`                 |
| 4     | `build/createScratchOrg.ts:118`                                                                                          | `org create scratch --set-default`                         | `@salesforce/core` `scratchOrgCreate({ hubOrg, durationDays, orgConfig, wait, setDefault })`                                                                         |
| 4     | `build/deleteScratchOrg.ts:68`                                                                                           | `org delete scratch`                                       | `(await Org.create({ aliasOrUsername })).delete()`                                                                                                                   |
| 5     | `build/createPackageVersion.ts:201`, `:111`                                                                              | `package version create` / `package version create report` | `@salesforce/packaging` `PackageVersion.create(…)` with its built-in polling and `PackageVersion.getCreateStatus()`                                                  |
| 5     | `deploy/deployProject.ts:38`                                                                                             | `package install --upgrade-type … --apex-compile package`  | New `installPackageVersion()` export in `simply-package-core`, factored out of the `SubscriberPackageVersion#install` path `installPackageDependencies` already uses |
| 6     | `build/pushScratch.ts:72`                                                                                                | `project deploy start` (source-tracked push)               | `@salesforce/source-tracking` `SourceTracking` + SDR `ComponentSet#deploy()`, with progress streamed through `logger`                                                |
| 6     | `sfApex.ts:78`                                                                                                           | `apex test run --result-format junit --code-coverage`      | `@salesforce/apex-node` `TestService#runTestAsynchronous()` + `writeResultFiles()` (JUnit and coverage), via a small helper in `simply-apex-core`                    |

### Out of scope

- **`sf plugins install` / `sf plugins` (`sfPlugins.ts:31`, `:69`).** These manage the CLI installation
  itself: deployment stages later run user scripts that call `sf` with those plugins. There is no
  library API for "install a plugin into the user's CLI". They stay shell-outs, and `exec/sfCli.ts`
  stays as their only user.
- **`git` (≈35 sites), `npm`/`npx` (≈8) and the `flow-delta` binaries.** Not Salesforce CLI commands
  and not what this doc is about. A `simple-git`-style migration would be a separate decision with a
  separate cost/benefit; noted under Open questions.
- **User-supplied stage scripts** (`deploy/deployCommon.ts`'s `executeStageScript`). Those are the
  pipeline owner's code; they may call `sf` themselves, and that's their business.

Consequently **pipeline images still need `sf` installed**: for `sf plugins` and for stage scripts.
What changes is that `simply-cicd-core`'s own Salesforce operations stop depending on it, and that
direct library consumers who don't use the deploy-plugin or stage-script features no longer need it.

## Behavior

The public API does not change: every exported function keeps its name, parameters and return type.
In detail:

- **Result shapes stay identical.** Where we currently return or persist a parsed CLI result (notably
  `SCRATCH_ORG_INFO.json` written by `createScratchOrg`, read back by `readScratchOrgInfo`, and
  `authenticateOrg`'s `result`), the library result is mapped onto the same shape. Hand-written
  CLI-JSON types are replaced by the libraries' own types where those already match, and by explicit
  mappers where they don't, so parity is checked by the compiler and a test, not by trust.
- **Org state stays shared with the CLI.** `AuthInfo#save()`, alias writes via `StateAggregator`, and
  `target-org` / `target-dev-hub` via `Config` write the same `~/.sf` files the CLI writes. A later
  `sf` process (a deployment plugin, a stage script) or a later pipeline job sees exactly what it sees
  today after `sf org login …` / `sf org create scratch --set-default`.
- **Pipeline log output changes in form.** Sites that currently run with `stdio: 'inherit'`
  (`project deploy start`, `apex test run`, `org delete scratch`, `package install`) stream the CLI's
  own progress UI into the job log. After migration, progress comes through `logger` instead (SDR
  `onUpdate`, packaging `PackageEvents`, apex-node progress reporter). The information is the same
  (component counts, status, errors) but the formatting differs. This is the only user-visible change
  and is called out in each phase's release notes.
- **Errors become `SfError`s.** Callers that matched on CLI message text match on `SfError.name`
  instead (for example scratch-org limit errors, `INVALID_SESSION_ID`). Messages surfaced to the user
  keep their current wording where we produce them.
- **Exit-code-only failures become exceptions with detail.** For example `apex test run` failures
  currently surface as a non-zero exit plus whatever `runApexTests` parses from the JUnit file;
  `TestService` returns the structured `TestResult`, which is reported the same way.

## Alternatives considered

**Keep shelling out but invoke oclif commands in-process (`await Command.run(argv)` from each
plugin's package).** Removes the cold start, but keeps the stringly-typed contract (argv in, JSON
out), adds every CLI plugin (`plugin-org`, `plugin-packaging`, `plugin-deploy-retrieve`,
`plugin-apex`, `plugin-auth`, `plugin-data`, `plugin-user`) as a runtime dependency with oclif's
config loading, and still couples us to command flag spelling. Rejected: it's the worst of both.

**One big-bang PR.** Rejected: the phases differ in risk by an order of magnitude (a read-only query
vs. source-tracked deploys). Phasing lets each change soak in real pipelines, and keeps any single
revert small.

**Add an injectable "Salesforce operations" interface first, with CLI and library implementations
selectable at run time.** Would allow switching back per site without a release. Rejected as
unnecessary indirection: each phase is a normal semver release that `simply-cicd` can pin back from,
and a permanent dual implementation would double the test surface for no long-term gain.

**Replace `project deploy start` with a plain SDR deploy of the whole project, skipping source
tracking.** Simpler, and arguably right for a freshly created CI scratch org where everything is
"changed" anyway. Not chosen as the default because `pushScratch` is also run against long-lived
scratch orgs in some pipelines, where the tracked delta is the point; offered as an open question
instead.

**Move these helpers into `simply-core`.** Some (auth, org display) are generic. But `simply-core` is
the dependency every plugin takes; it shouldn't grow `@salesforce/packaging` or
`@salesforce/source-tracking`. Package-install and apex-test helpers go to the packages that already
own those domains; the rest stays in `simply-cicd-core`.

## Implementation plan

Each phase is one PR to `simply-plugins-core`, released as a `simply-cicd-core` minor (and a
`simply-package-core` / `simply-apex-core` minor where noted). `simply-plugins` picks each up with a
dependency bump only, as no plugin code changes.

1. **Phase 1: read-only calls.** Add `getPackageVersionReport()` (4 duplicated call sites collapse
   into one) and replace `org display` and the two `data query` sites. Lowest risk; establishes the
   test pattern (`TestContext` + `MockTestOrgData`, as `simply-core`, `simply-aep-core` and others
   already use) that later phases follow.
2. **Phase 2: record writes.** `data update record`, permission set and permission set license
   assignment, `ActiveScratchOrg` deletion. Removes the CSV temp file from `cleanupScratchOrgs`.
3. **Phase 3: authentication.** `authenticateOrg` via `AuthInfo`. Must verify a subsequent `sf`
   process sees the alias and default org (see Testing, manual).
4. **Phase 4: scratch org lifecycle.** `scratchOrgCreate`, `Org#delete`. Keep the multi-Dev-Hub
   fallback loop in `createScratchOrg`, switching its limit-error detection to `SfError.name`.
5. **Phase 5: packaging.** `PackageVersion.create`/`getCreateStatus`; extract `installPackageVersion()`
   in `simply-package-core` and use it from `deployProject`. Adds `@salesforce/packaging` to
   `simply-cicd-core` (already in the workspace via `simply-package-core`).
6. **Phase 6: deploy and Apex tests.** `pushScratch` via `@salesforce/source-tracking` + SDR (new
   dependency); `runApexTests` via a `runApexTests`-style helper in `simply-apex-core` that writes
   JUnit and coverage files exactly where `./test-results/apex` consumers expect them. Highest risk;
   lands last.
7. **Cleanup.** Delete the now-unused CLI-JSON types and `runSfJson`, reduce `exec/sfCli.ts` to the
   plugin-management calls, update `simply-cicd-core`'s README ("The pipeline stages shell out to
   `sf`…" becomes "…only `sf plugins` and your stage scripts need `sf`"), and mark this doc Implemented.

Unrelated quick wins that may ride along with the phase touching the same file, since they're trivial
and remove platform assumptions (`find`/`grep`/`chmod` don't exist on stock Windows):
`pushScratch`'s `find … -delete` → `fs.rm` over a glob, `sfApex`'s `grep -r @isTest` → `fs` scan,
`deployCommon`'s `chmod -R` → `fs.chmod`.

## Testing

**Unit, per phase.** Tests for migrated sites stop mocking `execa`/`runSf` and instead use
`@salesforce/core/testSetup` (`TestContext`, `MockTestOrgData`, `$$.fakeConnectionRequest`) plus
stubs of the packaging, apex-node and SDR entry points. Each migrated function keeps its existing
behavioral assertions (what's returned, written and logged); only the "called `sf` with these args"
assertions are replaced by "called the library with these options".

**Result-shape parity.** For each site whose output is persisted or returned (`SCRATCH_ORG_INFO.json`,
`authenticateOrg`'s result, the package version report), a test pins the mapped shape against a
fixture captured from today's CLI `--json` output, so a mapping mistake fails CI.

**`simply-cicd` command tests** need no changes; they mock at the `simply-cicd-core` boundary
(per 0053).

**Manual, per phase before release.** Run the affected `sf simply cicd` commands in a sandbox
pipeline against a real Dev Hub: create, push, test and delete a scratch org; create and report a
package version; install it into a sandbox; then confirm a follow-on `sf org display` in the same job
resolves the alias and default org written in-process (phases 3–4).

## Open questions

- **Tracked push vs. full deploy for `pushScratch` (phase 6).** If every real pipeline only pushes to
  freshly created scratch orgs, a plain SDR deploy is simpler and avoids the
  `@salesforce/source-tracking` dependency. Pipeline owners decide; default is to preserve tracked
  behavior.
- **`git` shell-outs.** ~35 sites. A follow-up doc could evaluate `simple-git` or
  `isomorphic-git`; not in scope here.
- **Logger injection** (0053's open question) becomes more pressing once progress output comes
  from library event handlers rather than a child process. Worth deciding before phase 6 so
  deploy/test progress isn't hard-wired to `console`.
