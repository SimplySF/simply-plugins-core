# 0060 — `SIMPLY_CICD_` prefix for every variable `simply-cicd-core` defines

**Status:** Accepted — implemented on `feat/cicd-env-var-simply-prefix`; `simply-plugins` follow-up pending  
**Package:** `packages/simply-cicd-core` (new `cicdEnvVars.ts`)  
**Date:** 2026-11-11

## Problem

An audit of the environment variables this repo reads or writes found eleven that `simply-cicd-core`
itself defines but that don't start with `SIMPLY_`: `PACKAGE_CHANGED`, `LAST_TAG`,
`SUBSCRIBER_PACKAGE_VERSION_ID`, `AER_PACKAGE_URL`/`_FILE`/`_VERSION`,
`UTAM_PAGE_OBJECTS_PACKAGE`/`_VERSION`, `CREATED_BY_JOB_NAME`, `PREV_INSTALLED_PACKAGE_VERSION`,
`TARGET_PACKAGE_VERSION`, plus the repository-level CI variable `SFDX_DEPENDABOT_ENABLED`. Most
reach a pipeline as dotenv report artifacts and land in a downstream job's environment next to
everything else there, so generic names like `LAST_TAG` and `PACKAGE_CHANGED` can collide with
other tools' variables and don't say which tool owns them. The plugin's ~60 flag variables already
use `SIMPLY_CICD_`, and `simply-core` uses plain `SIMPLY_` for plugin-neutral settings (0059).

These names are part of the contract with consumers' pipeline YAML (`if: '$PACKAGE_CHANGED == "TRUE"'`,
`npm install "$UTAM_PAGE_OBJECTS_PACKAGE@…"`), so an abrupt rename would break pipelines.

## Decision

Rename each to `SIMPLY_CICD_` + the old name, with one exception (below). Keep the old names working,
deprecated, until a future release removes them. All names and their legacy aliases live in one map,
`CICD_ENV_VARS` / `LEGACY_CICD_ENV_VARS` in `src/cicdEnvVars.ts`. Removal later only touches that
module.

`SUBSCRIBER_PACKAGE_VERSION_ID` becomes `SIMPLY_CICD_BUILT_SUBSCRIBER_PACKAGE_VERSION_ID`, not
`SIMPLY_CICD_SUBSCRIBER_PACKAGE_VERSION_ID`. The latter is already `notify build
--subscriber-package-version-id`'s flag variable, meaning "this job built that package". A dotenv
artifact writing it would set the flag in every downstream job, so `notify build` would report a
package the job didn't build.

## Behavior

| Old name (deprecated)            | New name                                          | Kind                      |
| -------------------------------- | ------------------------------------------------- | ------------------------- |
| `PACKAGE_CHANGED`                | `SIMPLY_CICD_PACKAGE_CHANGED`                     | written (dotenv) and read |
| `LAST_TAG`                       | `SIMPLY_CICD_LAST_TAG`                            | written (dotenv)          |
| `SUBSCRIBER_PACKAGE_VERSION_ID`  | `SIMPLY_CICD_BUILT_SUBSCRIBER_PACKAGE_VERSION_ID` | written (dotenv) and read |
| `AER_PACKAGE_URL`                | `SIMPLY_CICD_AER_PACKAGE_URL`                     | written (dotenv)          |
| `AER_PACKAGE_FILE`               | `SIMPLY_CICD_AER_PACKAGE_FILE`                    | written (dotenv)          |
| `AER_PACKAGE_VERSION`            | `SIMPLY_CICD_AER_PACKAGE_VERSION`                 | written (dotenv)          |
| `UTAM_PAGE_OBJECTS_PACKAGE`      | `SIMPLY_CICD_UTAM_PAGE_OBJECTS_PACKAGE`           | written (dotenv)          |
| `UTAM_PAGE_OBJECTS_VERSION`      | `SIMPLY_CICD_UTAM_PAGE_OBJECTS_VERSION`           | written (dotenv)          |
| `CREATED_BY_JOB_NAME`            | `SIMPLY_CICD_CREATED_BY_JOB_NAME`                 | written (dotenv)          |
| `PREV_INSTALLED_PACKAGE_VERSION` | `SIMPLY_CICD_PREV_INSTALLED_PACKAGE_VERSION`      | written (dotenv)          |
| `TARGET_PACKAGE_VERSION`         | `SIMPLY_CICD_TARGET_PACKAGE_VERSION`              | written (dotenv)          |
| `SFDX_DEPENDABOT_ENABLED`        | `SIMPLY_CICD_SFDX_DEPENDABOT_ENABLED`             | repo CI variable, read    |

**Writers** write the new name, then the old name with the same value, and log one deprecation
notice per write at **info**. It isn't a warning because a pipeline can't do anything to stop it,
and a warning on every healthy run would teach people to ignore warnings.

**Readers of the environment** (`getSkipReason`, `resolveSubscriberPackageVersionId`) prefer the new
name. If only the old one is set, they use it and **warn**: `<OLD> is deprecated and will be removed
in a future release. Set <NEW> instead.` An empty value counts as unset, as before.

**Readers of a dotenv file** (`resolveSubscriberPackageVersionId`'s `--env-file` fallback,
`resolveBuiltSubscriberPackageVersionId`) prefer the new key and fall back to the old one **without**
a warning. A file with only the old key was written by an older simply-cicd, which isn't something the
user set.

**`sfdx-dependabot`** opts a project in on `SIMPLY_CICD_SFDX_DEPENDABOT_ENABLED=TRUE`. It still
accepts `SFDX_DEPENDABOT_ENABLED=TRUE`, warning with the project path. When both are set, the new one
decides. The "not opted in" message names the new variable.

Out of scope, left as is because other tools own them: `AER_BIN`, `AER_NO_RC` and
`AER_AUTOUPDATE_DISABLED` (aer and `@octoberswimmer/aer-sf-plugin`); `SF_APPLY_REPLACEMENTS_ON_CONVERT`
(sf CLI); `GIT_*`; `GITHUB_*` and `CI_PROJECT_*` (platform-provided); `JEST_JUNIT_*`;
`HUSKY_SKIP_INSTALL`; `PATH`, `XDG_DATA_HOME` and `LOCALAPPDATA`.

## Alternatives considered

- **Plain `SIMPLY_` prefix.** Rejected: these are simply-cicd-specific. Plain `SIMPLY_` is what
  `simply-core` uses for plugin-neutral settings (0059), and the plugin's own flag variables already
  use `SIMPLY_CICD_`.
- **Hard rename with no aliases.** Rejected: it silently breaks every consumer pipeline that reads a
  dotenv value. A skip gate on `$PACKAGE_CHANGED` would then never match, and jobs would run or skip
  wrongly with no error.
- **Warn on every write.** Rejected for the reason under Behavior. The read-side warning still fires
  wherever a user, rather than simply-cicd, set the old name.
- **Alias inside `appendToEnvFile`.** Rejected: it's a generic exported dotenv appender, and magic
  key duplication there would surprise other callers. Several tests also mock `env.js` wholesale.

## Implementation plan

1. `src/cicdEnvVars.ts`: `CICD_ENV_VARS`, `LEGACY_CICD_ENV_VARS` (`@deprecated`), `findCicdVar`,
   `readCicdEnvVar`, `withLegacyCicdEnvVars`, `toEnvFileContent`, `legacyEnvVarReadWarning`.
   Exported from the package root.
2. Point the existing `*_KEY` constants (`SUBSCRIBER_PACKAGE_VERSION_ID_KEY`, `AER_PACKAGE_*_KEY`,
   `UTAM_*_KEY`) at the new names.
3. Writers: `determinePackageChanges`, `createPackageVersion`, `createFallbackTag`,
   `publishAerPackage`, `publishUtamPageObjects`, `projectNotifyBeforeScript`.
4. Readers: `getSkipReason`, `resolveSubscriberPackageVersionId` and the new shared
   `findSubscriberPackageVersionIdInEnvFile` (also used by `resolveBuiltSubscriberPackageVersionId`),
   and `processProject`.
5. README "Environment variables and dotenv keys" table.

## Testing

- `test/cicdEnvVars.test.ts`: every name is `SIMPLY_CICD_`-prefixed with a distinct unprefixed
  alias, and none reuses `notify build`'s flag variable. Also covers: new-name preference, legacy
  fallback with warning, empty-as-unset, the silent mode, alias ordering and the info-level notice,
  and dotenv rendering.
- Writer tests now pin the exact dual-written output: new keys first, then legacy.
- Reader tests: `skipGuard` with the new name, the new name winning over the legacy one, and the
  existing legacy-only cases kept as-is. `resolveSubscriberPackageVersionId`: env and file
  preference, a warning for legacy env, and no warning for a legacy-only file. `buildNotification`:
  file preference. `processProject`: opt-in via the new variable, the legacy one (with a warning),
  and both.

## Open questions

- **When to remove the legacy names.** At the next major of `@simplysf/simply-cicd-core` at the
  earliest. The maintainers decide, after `simply-plugins` and known consumer pipelines have moved.
- **`simply-plugins` follow-up.** `simply-cicd`'s `messages/*.md` and README still document the old
  names. `sfdx-dependabot.ts` reads `process.env.SUBSCRIBER_PACKAGE_VERSION_ID` directly; it keeps
  working because the old name is still written, but it should move to `readCicdEnvVar`. Its own
  `SFDX_DEPENDABOT_*` flag fallbacks (`_VCS_TOKEN`, `_DRY_RUN`, …) are the same problem in that repo,
  for a separate change.
