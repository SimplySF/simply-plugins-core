# 0059 — Shared, platform-agnostic `.sfdevrc.json` in `simply-core`

**Status:** Accepted — `simply-plugins-core` side implemented; `simply-plugins` follow-up pending  
**Package:** `packages/simply-core` (new `config/sfDevRc.ts`), `packages/simply-cicd-core` (consumer)  
**Date:** 2026-11-10

## Problem

`.sfdevrc.json` is the project-local config file that both `simply-cicd` and (soon) `simply-project`
read, but nothing in this repo defines it. Today:

- **There is no schema.** `simply-cicd-core`'s `sfConfig.ts` casts `JSON.parse` output to a private
  `SfDevRcConfig` type and swallows every error, so a typo'd or malformed file is silently treated
  as absent.
- **It is read in three places, two ways.** `getAlmProjectKeys` and `getPackageOriginOverride` read
  `.sfdevrc.json` from `process.cwd()`; `installDeploymentPlugins` (`sfPlugins.ts`) reads
  **`.sfdevrc`** (no extension) from a `cwd` argument. A project with only `.sfdevrc.json` never gets
  its `deploymentPlugins` installed. This is a live bug.
- **The fields encode one platform.** The source tool's file (below) bakes GitLab and Jira into the
  key names. `simply-cicd-core` already abstracts both behind `VcsProvider`/`AlmProvider`
  registries ([0037](0037-simply-cicd-core.md)), and has started renaming `jiraProjectKey(s)` to
  `almProjectKey(s)`, but has no config-file equivalent of `--vcs-provider` / `--alm-provider`.

  ```json
  {
    "branchRegex": "",
    "deploymentPlugins": [],
    "gitlabProjectId": "",
    "jiraProjectKey": "",
    "jiraProjectKeys": [],
    "setup": { "include": [], "exclude": [] }
  }
  ```

- **The provider flags can't defer to config.** `--vcs-provider` defaults to `gitlab` and
  `--alm-provider` to `jira`, so even if the file declared a provider, the flag default would always
  win.

[0035](0035-simply-project-setup-core.md) deliberately kept `.sfdevrc.json` out of
`simply-project-setup-core`, on two grounds: the setup _engine_ shouldn't own a consumer's file
format, and the field set was GitLab/Jira-specific. This doc respects both: the setup engine still
owns nothing (it keeps taking a plain `localOverrides`), and the file's base shape stops naming any
platform. What changed is that we now have two first-party consumers (`simply-cicd`,
`simply-project`) that need to agree on the file — exactly the "shared, named config-file convention
across its own commands" 0035 said a consumer was free to define.

## Decision

Define the file once in `@simplysf/simply-core` as a **base schema plus consumer-owned sections**,
with VCS and ALM expressed as `{ provider, ... }` objects that map onto the existing registries.

### File shape

```json
{
  "vcs": {
    "provider": "gitlab",
    "host": "gitlab.example.com",
    "projectId": "12345"
  },
  "alm": {
    "provider": "jira",
    "projectKeys": ["ABC", "DEF"],
    "baseUrl": "https://example.atlassian.net/browse"
  },
  "branchRegex": "^(feature|bugfix)/(ABC|DEF)-\\d+",

  "deploymentPlugins": ["@scope/plugin"],
  "packageOriginOverrides": {},
  "setup": { "include": [], "exclude": [] }
}
```

| Field                    | Owner                        | Notes                                                                             |
| ------------------------ | ---------------------------- | --------------------------------------------------------------------------------- |
| `vcs.provider`           | base (`simply-core`)         | A `VcsProviderKind`: `gitlab` \| `github`.                                        |
| `vcs.host`               | base                         | Optional; provider default (`gitlab.com` / `github.com`) when omitted.            |
| `vcs.projectId`          | base                         | Provider-native key: GitLab numeric ID, GitHub `owner/repo` (= `VcsProject.key`). |
| `alm.provider`           | base                         | An `AlmProviderKind`: `jira` \| `gitlab-issues`.                                  |
| `alm.projectKeys`        | base                         | Always an array; replaces the single/multi pair. Ignored by `gitlab-issues`.      |
| `alm.baseUrl`            | base                         | Optional; same meaning as today's `--alm-base-url`.                               |
| `branchRegex`            | base                         | Optional. Used by both setup (hooks/templates) and CI branch checks.              |
| `deploymentPlugins`      | `simply-cicd-core` extension | Unchanged semantics.                                                              |
| `packageOriginOverrides` | `simply-cicd-core` extension | Unchanged semantics.                                                              |
| `setup.include/exclude`  | `simply-project` extension   | Passed straight through as `resolveSetupConfig`'s `localOverrides`.               |

Unknown top-level keys are **preserved, not rejected** — so `simply-cicd` validating the file never
fails on `simply-project`'s `setup` section and vice versa. Each consumer validates only the base
plus its own section.

### Provider kinds move to `simply-core`

`VcsProviderKind` and `AlmProviderKind` are type-only string unions today, in `simply-cicd-core`.
They move to `simply-core` (as `VCS_PROVIDER_KINDS` / `ALM_PROVIDER_KINDS` const arrays plus derived
types) so the base schema can validate against them without `simply-core` depending on
`simply-cicd-core`. `simply-cicd-core` re-exports the types under the same names — **no breaking
change** for importers. The registries, factories, and implementations stay in `simply-cicd-core`.

### API (`@simplysf/simply-core`)

```ts
/** The base zod schema (`z.looseObject`): unknown top-level sections pass through untouched. */
export const sfDevRcSchema: z.ZodType<SfDevRc>;

/** The parsed base file. Both `provider` fields are optional — see "Optional providers" below. */
export type SfDevRc = {
  vcs?: { provider?: VcsProviderKind; host?: string; projectId?: string };
  alm?: { provider?: AlmProviderKind; projectKeys?: string[]; baseUrl?: string };
  branchRegex?: string; // validated as a compilable RegExp
  [section: string]: unknown;
};

export const SFDEVRC_FILENAME = '.sfdevrc.json';
export const LEGACY_SFDEVRC_FILENAME = '.sfdevrc';

/**
 * Reads `.sfdevrc.json` (else legacy `.sfdevrc`) from `cwd` (default `process.cwd()`), normalizes
 * legacy fields, overlays `SFDEVRC_ENV_VARS` from `env` (default `process.env`; `{}` reads the file
 * alone), and validates against `schema` (default `sfDevRcSchema`; pass an `.extend()` of it to
 * validate your own sections). No file and no variables → `{ config: {} }`. Unparseable JSON, a
 * non-object root, a schema failure, or a bad variable value → throws `SfDevRcError` naming the
 * file or variable and each offending field path.
 * `warn` defaults to `process.emitWarning(message, 'DeprecationWarning')`.
 */
export function loadSfDevRc<S extends z.ZodType<SfDevRc>>(options?: {
  cwd?: string;
  schema?: S;
  warn?: (message: string) => void;
  env?: Record<string, string | undefined>;
}): { config: z.infer<S>; path?: string };

/** The environment variable for each base field — see "Environment variables" below. */
export const SFDEVRC_ENV_VARS: {
  vcsProvider: 'SIMPLY_VCS_PROVIDER';
  vcsHost: 'SIMPLY_VCS_HOST';
  vcsProjectId: 'SIMPLY_VCS_PROJECT_ID';
  almProvider: 'SIMPLY_ALM_PROVIDER';
  almProjectKeys: 'SIMPLY_ALM_PROJECT_KEYS';
  almBaseUrl: 'SIMPLY_ALM_BASE_URL';
  branchRegex: 'SIMPLY_BRANCH_REGEX';
};

/** The file `loadSfDevRc` would read in `cwd`, if any. */
export function findSfDevRcPath(cwd?: string): string | undefined;

/** Precedence: explicit value (flag) > `config.vcs.provider` (env or file) > `fallback` (default `'gitlab'`). */
export function resolveVcsProviderKind(
  config: SfDevRc,
  explicit?: VcsProviderKind,
  fallback?: VcsProviderKind,
): VcsProviderKind;

/** Precedence: explicit value (flag) > `config.alm.provider` (env or file) > `fallback` (default `'jira'`). */
export function resolveAlmProviderKind(
  config: SfDevRc,
  explicit?: AlmProviderKind,
  fallback?: AlmProviderKind,
): AlmProviderKind;

/**
 * The non-secret half of `VcsProviderOptions` (`host`, plus `projectId`); the caller adds `token`.
 * Each field: explicit > config (env, then file). The file's `host`/`projectId` apply only when the resolved provider
 * is the one the file names (or the file names none).
 */
export function resolveVcsSettings(
  config: SfDevRc,
  explicit?: { provider?: VcsProviderKind; host?: string; projectId?: string },
  fallback?: VcsProviderKind,
): { kind: VcsProviderKind; host?: string; projectId?: string };

/** Precedence: explicit keys > `config.alm.projectKeys` > `[]`. Deduplicated, empties dropped. */
export function resolveAlmProjectKeys(config: SfDevRc, explicit?: string | string[]): string[];
```

The resolvers take the already-loaded `config` rather than reading the file themselves, so a
command loads once and every helper sees the same snapshot (today each `sfConfig.ts` getter
re-reads the file).

**Optional providers.** The first draft made `vcs.provider` / `alm.provider` required. Implementing
the legacy mapping showed why they can't be: `almProjectKey(s)` names keys but not a tracker, and a
repo may reasonably set `alm.projectKeys` while choosing the tracker per pipeline via flag/env. A
missing provider resolves through flag > fallback like any other unset value.

**Cross-provider settings.** If the file says `vcs.provider: "gitlab"` with a self-hosted `host`, and
a job passes `--vcs-provider github`, `resolveVcsSettings` drops the file's `host`/`projectId`
rather than send GitHub API calls to a GitLab hostname.

**Why a zod schema rather than `loadJsonConfig`'s `ConfigSchema<T>`.** `ConfigSchema` only surfaces a
single `error.message`; reporting each bad field path (`- vcs.provider: ...`) needs zod's issue list,
and consumers need `.extend()` to add their sections. `loadJsonConfig` is unchanged.

### Legacy field normalization

`loadSfDevRc` rewrites legacy fields into the new shape before validation, warning once per field
group via `warn` (`simply-cicd-core` passes its `logger.warn`). Legacy keys are removed from the
result either way. Empty legacy values (`"gitlabProjectId": ""`, `"jiraProjectKeys": []` — as in
the source tool's template) are dropped silently, without a warning:

| Legacy field                        | Becomes                                           |
| ----------------------------------- | ------------------------------------------------- |
| `gitlabProjectId`                   | `vcs: { provider: 'gitlab', projectId }`          |
| `jiraProjectKey`, `jiraProjectKeys` | `alm: { provider: 'jira', projectKeys: [...] }`   |
| `almProjectKey`, `almProjectKeys`   | `alm.projectKeys` (provider left to flag/default) |
| `.sfdevrc` (no extension)           | read only if `.sfdevrc.json` is absent; warns     |

If both a legacy field and its replacement are present, the new field wins outright — the same
no-blend rule `getAlmProjectKeys` already applies to `almProjectKey(s)` vs `jiraProjectKey(s)`.

### Environment variables

Every base field can also be set from the environment, so a pipeline can vary a setting per job
without editing the committed file:

| Variable                  | Field             | Notes                             |
| ------------------------- | ----------------- | --------------------------------- |
| `SIMPLY_VCS_PROVIDER`     | `vcs.provider`    | A `VcsProviderKind`.              |
| `SIMPLY_VCS_HOST`         | `vcs.host`        |                                   |
| `SIMPLY_VCS_PROJECT_ID`   | `vcs.projectId`   |                                   |
| `SIMPLY_ALM_PROVIDER`     | `alm.provider`    | An `AlmProviderKind`.             |
| `SIMPLY_ALM_PROJECT_KEYS` | `alm.projectKeys` | Comma-separated; blanks dropped.  |
| `SIMPLY_ALM_BASE_URL`     | `alm.baseUrl`     |                                   |
| `SIMPLY_BRANCH_REGEX`     | `branchRegex`     | Validated as a compilable RegExp. |

Precedence for every field is **flag > environment > file > fallback**. `loadSfDevRc` merges the
environment into `config`, so the resolvers' "config" step already includes it; they don't read
`process.env` themselves.

- **Blank means unset.** An empty or whitespace-only value is ignored, so a CI template can declare
  every variable and leave some empty.
- **Same provider-switch rule as flags.** If `SIMPLY_VCS_PROVIDER` names a different provider than
  the file's `vcs.provider`, the file's whole `vcs` section is dropped before the overlay, so its
  `host`/`projectId` can't leak onto the other platform. Likewise for `alm`.
- **Bad values fail, naming the variable.** The variables are validated on their own before the
  merge, so `SIMPLY_VCS_PROVIDER=bitbucket` reports `SIMPLY_VCS_PROVIDER: ...`, not `vcs.provider`,
  and the `SfDevRcError` has no `filePath`.
- **Plugin-neutral names.** No `CICD` in the name, because `simply-project` reads the same fields.
  `simply-cicd`'s `--vcs-*`/`--alm-*` flags currently read `SIMPLY_CICD_*` names; those are **not**
  read as a fallback. The follow-up removes them (behavior change 5).
- Consumer sections (`deploymentPlugins`, `packageOriginOverrides`, `setup`) have no variables.
  They are lists or maps that belong in the committed file.

### `simply-cicd-core` changes

- `vcs/types.ts`, `alm/types.ts`: `VcsProviderKind` / `AlmProviderKind` re-exported from
  `@simplysf/simply-core`; same names, same members.
- `sfConfig.ts`: new `cicdSfDevRcSchema` (base + `deploymentPlugins` + `packageOriginOverrides`) and
  `loadCicdSfDevRc(cwd?, env?)`, which routes warnings through `logger.warn` and passes `env`
  straight to `loadSfDevRc`. It does **not** read the old `SIMPLY_CICD_*` names (see "Environment
  variables").
  - `getAlmProjectKeys` is a wrapper over `resolveAlmProjectKeys`, marked `@deprecated` and kept for
    one minor version.
  - `getPackageOriginOverride` stays (it has no better replacement), and takes an optional
    already-loaded `config` so a happy-soup loop doesn't re-read the file per package.
- `sfPlugins.ts`: `installDeploymentPlugins` reads via `loadCicdSfDevRc(cwd)`, fixing the
  `.sfdevrc` / `.sfdevrc.json` mismatch. A non-array `deploymentPlugins` now fails instead of being
  skipped.

### `simply-plugins` follow-up (coordinated, not in this PR)

- `simply-cicd`: drop `default:` from `--vcs-provider` and `--alm-provider`, and resolve via
  `resolveVcsProviderKind` / `resolveAlmProviderKind`. Help text documents the new precedence.
- `simply-cicd`: remove `env:` from every flag that a base field covers — `--vcs-provider`
  (`SIMPLY_CICD_VCS_PROVIDER`), `--vcs-host` (`SIMPLY_CICD_VCS_HOST`), `--alm-provider`
  (`SIMPLY_CICD_ALM_PROVIDER`), `--alm-project-key` (`SIMPLY_CICD_ALM_PROJECT_KEY`), and
  `--alm-base-url` (`SIMPLY_CICD_ALM_BASE_URL`). The loader reads the `SIMPLY_*` replacements into
  the config, and the resolvers apply them below the flag. Renaming each `env:` to the new name
  instead would be wrong for project keys: oclif would pass `ABC,DEF` as one key. Flags with no base
  field (e.g. `--vcs-api-url`, tokens) keep their `SIMPLY_CICD_*` names. Delete the plugin's duplicated `common/sfConfig.ts`, `common/sfPlugins.ts`, and
  `common/happySoup/resolveOriginProject.ts` in favor of the `-core` exports.
- `simply-project`: load with its own `setup` section schema and pass `config.setup` to
  `resolveSetupConfig`'s `localOverrides`.

## Behavior changes users will notice

1. **Malformed `.sfdevrc.json` now fails the command** with a message naming the file and field,
   instead of being silently ignored. Silently ignoring a misconfigured `vcs.provider` would send
   API calls to the wrong platform.
2. **Flag beats file for ALM project keys.** Today `.sfdevrc.json` keys override `--alm-project-key`
   — the reverse of every other flag/config pair. New precedence is flag > file > none.
3. **`deploymentPlugins` in `.sfdevrc.json` is now honored** (bug fix).
4. **Provider can come from the file** once the `simply-cicd` flag defaults are removed.
5. **`SIMPLY_CICD_{VCS,ALM}_*` variables stop working** once the `simply-plugins` follow-up ships,
   with no deprecation period. Pipelines must switch to the `SIMPLY_*` names. `SIMPLY_CICD_ALM_PROJECT_KEY`
   becomes `SIMPLY_ALM_PROJECT_KEYS`, which takes a comma-separated list.

## Alternatives considered

**Keep the flat, prefixed keys (`vcsProvider`, `vcsProjectId`, `almProvider`, `almProjectKeys`).**
Less churn — `almProjectKey(s)` shipped recently as the _new_ names, and nesting asks users who
already migrated to move them again. Rejected: each provider
grows settings (`host`, `apiUrl`, `baseUrl`, future auth hints), and nesting keeps them grouped and
lets a provider-specific sub-schema validate them. The migration cost is a warning, not a break.

**Put the schema in `simply-cicd-core` and have `simply-project` depend on it.** Rejected:
`simply-cicd-core` pulls `@salesforce/packaging`, SDR, source-tracking, and handlebars — a heavy
footprint for a project-scaffolding plugin that needs to read three fields.

**A new `simply-sfdevrc-core` package.** Viable, and the cleanest boundary. Rejected for now as one
more package to version and release for ~200 lines; `simply-core` already hosts `config/
loadJsonConfig.ts` and both consumers already depend on it. Easy to extract later if it grows.

**Hand-rolled validation instead of `zod`.** `simply-core` doesn't depend on `zod` today, but six
sibling packages do. Using `zod` gives consumers `.extend()` for their sections for free and
per-field error paths. Adds one dependency (`zod@^4.6.7`, already in the lockfile).

**Derive `branchRegex` from the ALM provider** (e.g. Jira keys → `(ABC|DEF)-\d+`). Deferred: it
needs an `AlmProvider` method (`branchPattern(projectKeys)`) in `simply-cicd-core`, which
`simply-project` doesn't depend on. Explicit `branchRegex` covers today's need.

## Resolved questions (agreed 2026-11-10)

1. **Nested (`vcs.provider`) vs flat (`vcsProvider`) keys?** Nested.
2. **Home package — `simply-core` vs new `simply-sfdevrc-core`?** `simply-core`.
3. **Fail on malformed file (behavior change 1)?** Yes.
4. **Should `loadSfDevRc` walk up from `cwd` to find the file?** No — CI always runs at the repo
   root, and today's readers don't walk.
5. **Publish a JSON Schema** (`sfdevrc.schema.json`, generated via `z.toJSONSchema`) for editor
   autocompletion via `"$schema"`? Yes, as a follow-up — not in this change.
6. **Keep reading the old `SIMPLY_CICD_{VCS,ALM}_*` names as a deprecated fallback?** No — the
   plugin-neutral `SIMPLY_*` names only (behavior change 5).

## Test plan

- `simply-core` `test/config/sfDevRc.test.ts`: missing file; `.sfdevrc` fallback + warning;
  `.sfdevrc.json` preferred over `.sfdevrc`; invalid JSON; non-object root; unknown provider;
  invalid `branchRegex`; extension-schema failure; unknown sections preserved with and without an
  extension; source-tool template with empty legacy values; each legacy mapping; new-wins-over-legacy.
- Environment variables: config from the environment alone; overlay onto the file; a different
  provider drops the file's section, the same provider keeps it; comma-separated project keys;
  blank values ignored; a bad value reported against the variable name with no file path; the
  `process.env` default.
- Resolvers: explicit > config > fallback for each; cross-provider `host`/`projectId` suppression;
  dedupe/empty filtering for project keys.
- `simply-cicd-core`: `sfConfig.test.ts` moved from mocking `node:fs` to real temp directories (the
  read now happens inside `simply-core`). Two tests changed deliberately to match behavior changes 1
  and 2 (malformed file now throws; passed key now beats the file). `sfPlugins.test.ts`: the
  non-array `deploymentPlugins` case now expects a failure; new tests for `.sfdevrc.json` being
  installed and preferred over `.sfdevrc`. `index.test.ts` export list gains `cicdSfDevRcSchema` and
  `loadCicdSfDevRc`. `sfConfig.test.ts` also checks that the `SIMPLY_*` variables overlay the file
  and that each old `SIMPLY_CICD_*` name is ignored.
