# 0062 — Configurable version increments for `simply project release create`

**Status:** In progress
**Package:** `packages/simply-project-core` (logic); `packages/simply-project` (flags, in
`simply-plugins`, where this doc is duplicated as its 0064)
**Date:** 2026-11-12

## Problem

`release create` ([0061](0061-project-release-create.md)) always moves the chosen part of the version
up by one: `release/v1.2.0` → `release/v1.3.0` for `--type minor`. Some teams number their releases
in larger steps, such as minors in tens (`v1.20.0` → `v1.30.0`) so that intermediate numbers stay
free for out-of-band releases. Those teams can't use the command today without editing the branch
and `sfdx-project.json` by hand afterwards, which is exactly the manual work the command exists to
remove.

## Decision

Add one increment per release type. Each can be set by a flag, an environment variable, or
`plugins.simply.release.increments` in `sfdx-project.json`, and each defaults to 1. `createRelease`
in `@simplysf/simply-project-core` reads the project setting from the `sfdx-project.json` it already
loads for the source branch. It takes an explicit `increment` option that wins over that setting, and
passes the result to `nextReleaseBranch`.

## Behavior

| Type    | Flag                | Environment variable                     | `sfdx-project.json`                       |
| ------- | ------------------- | ---------------------------------------- | ----------------------------------------- |
| `major` | `--major-increment` | `SIMPLY_PROJECT_RELEASE_MAJOR_INCREMENT` | `plugins.simply.release.increments.major` |
| `minor` | `--minor-increment` | `SIMPLY_PROJECT_RELEASE_MINOR_INCREMENT` | `plugins.simply.release.increments.minor` |
| `patch` | `--patch-increment` | `SIMPLY_PROJECT_RELEASE_PATCH_INCREMENT` | `plugins.simply.release.increments.patch` |

```json
{
  "packageDirectories": [{ "path": "force-app", "default": true, "versionNumber": "1.20.0.NEXT" }],
  "plugins": {
    "simply": {
      "release": { "increments": { "minor": 10 } }
    }
  }
}
```

- **Precedence:** flag > environment variable > `sfdx-project.json` > 1. The environment variable is
  the flag's oclif `env:`, so the first two are resolved by oclif before `createRelease` sees them.
  This matches `--vcs-token` / `SIMPLY_VCS_TOKEN`.
- **Which `sfdx-project.json`:** the setting is read from the remote's copy of the source branch.
  That is the copy `createRelease` already reads for `versionNumber`, not the local working tree. The
  new branch is cut from that same copy, so it keeps the setting, and the next release uses the same
  step without anyone having to set it again.
- **Only the chosen type's increment is used.** If `--type minor` is set, `--major-increment` and
  `increments.major` are ignored. Each type has its own setting, so a project can declare all three
  and still pick the type at run time.
- **Lower parts still reset:** with a major increment of 2, `v1.4.2` → `v3.0.0`. With a minor
  increment of 10, `v1.20.3` → `v1.30.0`.
- **Validation:** each increment must be a whole number of at least 1. Flags and environment
  variables use `Flags.integer({ min: 1 })`. An invalid `sfdx-project.json` value fails before
  anything changes, with an error that names the field and the branch it was read from (for example,
  `plugins.simply.release.increments.minor in origin/release/v1.2.0's sfdx-project.json must be a
whole number of at least 1`). A missing `plugins`, `simply`, or `release` key just means "not set".
- **What it doesn't change:** branch label shape (`v` prefix, minor-line branches), the duplicate
  check, and the error for `patch` on a minor-line branch. The `sfdx-project.json` bump follows the
  target branch, so it picks up the increment without a separate change. The confirmation already
  shows the target branch, so a surprising jump is visible before anything changes.
- **Resuming:** a re-run that finishes an interrupted cut checks that the existing branch is the
  computed target. Changing the increment between the two runs therefore fails with the existing
  "re-run with the release type that names it" error. That error now also mentions the increment.
- **Roll-forward:** sorts release branches numerically and walks the ones that exist, so gaps such
  as `v1.20.0` → `v1.30.0` need no change there.

## Alternatives considered

- **`.sfdevrc.json`** (the first draft of this doc): it would also be committed and shared, but the
  increment describes how this project numbers its package versions. That belongs next to
  `versionNumber`, and `plugins.simply` already holds `simply-cicd`'s `versionTagFormat`, `aer`, and
  `utam` settings. Reading it from the source branch's copy also means each release line carries its
  own setting, which `.sfdevrc.json` (read from the working tree) wouldn't.
- **A single combined value** (`SIMPLY_PROJECT_RELEASE_INCREMENTS="minor=10"`): fewer names, but it
  needs its own parser and error messages, and it breaks the one-flag-one-env-var convention.
- **One `--increment` for whichever type was chosen:** simpler for a single run, but a project that
  steps minors by 10 and patches by 1 couldn't configure both at once.
- **Environment variable only:** settles the original request, but CI and every developer's shell
  would have to agree on it.
- **Resolving the project setting in the command:** the command would have to read the source
  branch's `sfdx-project.json` from git itself before `createRelease` does. `createRelease` already
  has that file in hand, so it reads the setting there.

## Implementation plan

`simply-plugins-core` (released first):

1. `release/releaseBranches.ts`: `nextReleaseBranch(branch, type, prefix, increment = 1)`, which
   rejects anything that isn't a positive integer.
2. `release/releaseConfig.ts` (new): `ReleasePluginConfig` and `readReleasePluginConfig(project)`,
   using `getPluginConfig(project, 'plugins.simply.release')` as `simply-cicd-core`'s
   `readAerPluginConfig` does, plus validation of `increments`. Exported from `index.ts`.
3. `release/createRelease.ts`: `CreateReleaseOptions.increment?: number`, validated in
   `assertOptions`. `buildPlan` resolves `options.increment ?? increments[type] ?? 1` from the source
   project and passes it to `nextReleaseBranch`.

`simply-plugins`:

4. `release/create.ts`: the three `Flags.integer` flags with `env:`, passing the one that matches
   `type` to `createRelease` as `increment`.
5. `messages/simply.project.release.create.md`: the flag summaries, the description of the
   `sfdx-project.json` setting, and an example.
6. Bump `@simplysf/simply-project-core`, regenerate `command-snapshot.json` and the READMEs, and
   update the `release-branches.md` site page.

## Testing

- `releaseBranches.test.ts`: each type with increments 1 and >1, the reset of lower parts, the `v`
  prefix kept, minor-line branches, and rejection of 0, negative, and fractional values.
- `releaseConfig.test.ts`: a missing `plugins` / `simply` / `release` key, a partial `increments`,
  and invalid values (0, negative, fractional, string), each named in the error.
- `createRelease.test.ts` (real git repos): the source branch's `increments` reaching the target
  branch name and `versionNumber`, `options.increment` beating it, the working tree's copy being
  ignored in favor of the remote source's, and the setting carried onto the new branch.
- `create.test.ts`: each flag and its environment variable passed as `increment` only for the
  matching type, and nothing passed when no flag is set.

## Open questions

- None yet.
