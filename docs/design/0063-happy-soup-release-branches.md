# 0063 — `simply cicd happy-soup release create` and `release stage`

**Status:** In progress
**Package:** `packages/simply-cicd-core` (logic) and `packages/simply-core` (draft merge requests);
`packages/simply-cicd` and `packages/simply-plugin-kit` (commands and a `text` prompt, in
`simply-plugins`, where this doc is duplicated as its 0065)
**Date:** 2026-11-13

## Problem

A happy-soup repository ships through dated release branches. `release/2026-10-19` deploys with
`deployment-configs/2026-10-19.json` (`determineDeployConfigFile`). Each release also has a
`deployment-steps/2026-10-19.md` of manual steps. Feature work for a release is staged on
`<team>/<application>/<name>` branches that merge into it. `simply cicd deploy happy-soup
deployment-close-out` already archives the config at the end of a release, but nothing in the CLI
opens one or stages work for it.

Teams do both today with a standalone script, `ReleaseBranch.consolidated.ts`: an `SfCommand` using
`@clack/prompts` and `ora`, configured by `config/release.json`. It is the starting point, but like
`release.ts` in [0061](0061-project-release-create.md), it can't be dropped in as is:

| The script does                                                                               | This repo's rule                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execSync` with shell strings built from team, app, name, and branch input                    | `execa` with argument arrays only.                                                                                                                                                       |
| `git checkout --force` to create branches                                                     | Never discard local changes. Refuse a dirty working tree instead.                                                                                                                        |
| Checks out and pulls the production branch before starting                                    | Base new work on the remote's tip, as `project release create` does, without touching other branches.                                                                                    |
| `fetch` to GitLab with a `PRIVATE-TOKEN` header                                               | Platform calls go through `VcsProvider`, so GitHub works too.                                                                                                                            |
| Its own `.projectrc.json` / `.sfdevrc.json` walk for `gitlabProjectId`, and `GITLAB_*` tokens | `loadCicdSfDevRc` and `resolveVcsSettings` for the project, and `--vcs-token` / `SIMPLY_VCS_TOKEN` for the token.                                                                        |
| Downgrades most failures to a warning and carries on, and exits 0 on a cancelled prompt       | Fail with a clear error. A cancelled prompt is `PromptCancelledError` ([0063 (simply-plugins)](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0063-clack-prompts.md)). |
| `ora` spinners                                                                                | `SfCommand`'s own spinner and log output, so `--json` stays clean.                                                                                                                       |

## Decision

Add two commands under a new `simply cicd happy-soup` topic. That topic is for developer-run
happy-soup tools, and it is kept apart from the pipeline stages under `simply cicd deploy happy-soup`:

- **`release create`** opens a dated release. It cuts `release/<date>` from the remote's production
  branch, commits the deployment steps and config files copied from templates, pushes, and opens a
  draft merge request back into production.
- **`release stage`** starts a staging branch, `<team>/<application>/<name>`, from the remote's copy of
  a base branch, and checks it out.

Both keep reading `config/release.json`, so repositories using the script switch over without
changing their configuration. The logic lives in `@simplysf/simply-cicd-core` (`src/happySoup/`),
next to `determineDeployConfigFile`, which is what guarantees that the config file `release create`
writes is the one the deploy stages read.

## Behavior

### Configuration: `config/release.json`

The same file and schema as the script. It is found by `--config`, else `config/release.json` or
`release.json`, searching upward from the current directory, **but stopping at the repository root**
(the script searched to the filesystem root). The file is optional, and every field has a default.

| Field                       | Default                                  | Meaning                                                                                      |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `teams`                     | `[]`                                     | Teams offered by `release stage`, each with its `applications`.                              |
| `applications`              | `[]`                                     | Applications offered when the chosen team declares none.                                     |
| `productionBranch`          | `environment/production`                 | Base branch for `release create`, and the default base for `release stage` without a prompt. |
| `deploymentStepsTemplate`   | `xdocs/deployment-steps-template.md`     | Copied to `deployment-steps/<date>.md`.                                                      |
| `deploymentConfigsTemplate` | `xdocs/deployment-configs-template.json` | Copied to `deployment-configs/<date>.json`.                                                  |

`teams` and `applications` accept every shape the script accepted: an array of names, an array of
`{ name, label?, description? }` objects, or a record keyed by name. Unknown keys pass through. An
invalid file fails with every offending field named.

### `sf simply cicd happy-soup release create`

```bash
sf simply cicd happy-soup release create --date 2026-10-19 --dry-run
sf simply cicd happy-soup release create --date 2026-10-19
```

| Flag                                                              | Default                        | Meaning                                                                               |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `--date`, `-d`                                                    | asked for in a terminal        | Release date, `YYYY-MM-DD`. Must be a real calendar date.                             |
| `--base-branch`, `-b`                                             | `productionBranch`             | Branch to cut from, and the merge request's target.                                   |
| `--config`, `-c`                                                  | discovered                     | Path to the release configuration file.                                               |
| `--remote`                                                        | `origin`                       | Remote to fetch from and push to.                                                     |
| `--message`                                                       | `chore: set up release {DATE}` | Commit message template for the template files.                                       |
| `--no-push`                                                       | `false`                        | Create and commit locally only. Implies no merge request.                             |
| `--no-merge-request`                                              | `false`                        | Push without opening a draft merge request.                                           |
| `--vcs-provider`, `--vcs-host`, `--vcs-project-id`, `--vcs-token` | as `project release create`    | VCS settings for the merge request, from flags, `SIMPLY_VCS_*`, then `.sfdevrc.json`. |
| `--dry-run`                                                       | `false`                        | Print the plan without changing anything.                                             |
| `--no-prompt`                                                     | `false`                        | Don't ask for anything. Missing required values are an error.                         |

Steps, in order:

1. **Check before changing anything:** the date's format and validity, a configured remote, a clean
   working tree, the base branch on the remote, and, when a merge request is wanted, the VCS project
   and token. A missing project ID or token is an error that suggests `--no-merge-request`. The
   script skipped the merge request with a warning instead.
2. **Fetch** the remote. Don't check out or pull anything else.
3. **Create `release/<date>`** from `<remote>/<base>` and check it out.
4. **Copy the templates** that exist to `deployment-steps/<date>.md` and the path
   `determineDeployConfigFile('release/<date>')` returns, and commit them in one commit with hooks
   running. The script made two commits. Templates are read from `<remote>/<base>`, the same commit
   the branch starts from, not from the working tree, which also lets `--dry-run` report them. A
   template that doesn't exist there is skipped and reported. A destination that already exists there
   is left alone, with a warning.
5. **Push** with upstream tracking, unless `--no-push`.
6. **Open a draft merge request** into the base branch, titled `Release <date>`, unless
   `--no-merge-request`. GitLab shows it as `Draft: Release <date>`, and GitHub opens a draft pull
   request. The source branch is kept after the merge, as the script's merge request did. An open
   merge request for the same branches is reported instead of duplicated.

If a hook rejects the commit, nothing is pushed and the files stay staged on the new branch. The
error says to commit by hand, push, and re-run, which then finds the branch on the remote and opens
the merge request.

If `release/<date>` already exists on the remote, nothing is created. The command checks it out
(creating a local tracking branch if needed, and fast-forwarding a local copy that is only behind),
reports `Already exists`, and still opens the merge request if it's missing, so a re-run finishes a
run that failed at that step. A local copy that has diverged from the remote is left as is, with a
warning. A local `release/<date>` that isn't on the remote (left by `--no-push` or a rejected commit)
is refused, with the commands to push or delete it.

The result, also returned with `--json`:
`{ branch, base, status, commit?, files[], skippedTemplates[], pushed, mergeRequest?, warnings[] }`,
where `status` is `Created`, `Would create`, or `Already exists`, and `mergeRequest.status` is
`Created`, `Would create`, or `Already open`.

### `sf simply cicd happy-soup release stage`

```bash
sf simply cicd happy-soup release stage --team platform --app core --name PROJ-1058
sf simply cicd happy-soup release stage            # asks for each value in a terminal
```

| Flag                  | Default                                          | Meaning                                                       |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `--team`              | asked for in a terminal                          | Team segment of the branch name.                              |
| `--app`, `-a`         | asked for in a terminal                          | Application segment.                                          |
| `--name`, `-n`        | asked for in a terminal                          | Release name or ticket, such as `PROJ-1058`.                  |
| `--base-branch`, `-b` | asked for in a terminal, else `productionBranch` | Branch to stage from.                                         |
| `--config`, `-c`      | discovered                                       | Path to the release configuration file.                       |
| `--remote`            | `origin`                                         | Remote to fetch from.                                         |
| `--dry-run`           | `false`                                          | Print the plan without changing anything.                     |
| `--no-prompt`         | `false`                                          | Don't ask. `--team`, `--app`, and `--name` are then required. |

- **Prompts:** teams come from `config/release.json`, and applications from the chosen team, falling
  back to the top-level `applications`. Both lists end with "Other", which asks for a name. The base
  branch list is the remote's `environment/*` and `release/*` branches with `productionBranch` first,
  plus "Other". `--team` matches a configured team case-insensitively, and an unknown team is used as
  typed.
- **Validation:** each segment must be a valid single git ref component (no `/`, spaces, `..`, or the
  other characters `git check-ref-format` refuses). The full name is checked with `git check-ref-format`
  before anything changes.
- **Creating:** fetch, then create `<team>/<app>/<name>` from `<remote>/<base>` and check it out. Like
  the script, it doesn't push. If the branch already exists on the remote, it is checked out as in
  `release create` and reported as `Already exists`. Because staging branches aren't pushed, one that
  exists only locally is simply switched to, also as `Already exists`.
- The result: `{ branch, base, status, warnings[] }`.

### Shared rules

- A dirty working tree is refused before anything changes. Nothing ever force-checks-out, resets,
  force-pushes, or pushes tags.
- Commit hooks always run.
- Interactive only when a terminal is attached and neither `--no-prompt` nor `--json` is set.

## Alternatives considered

- **`simply project`** (where `release create` lives): developer commands live there too, but
  `project release` means packaged-version branches, and `simply-project-core` deliberately doesn't
  depend on `simply-cicd-core`, which owns the deployment-config naming.
- **Under `simply cicd deploy happy-soup`:** next to `deployment-close-out`, but every command there is
  a pipeline stage, and these don't deploy anything.
- **One command with `--type staging|release`,** as the script has: half of its flags would apply to
  only one type.
- **`.sfdevrc.json` or `sfdx-project.json` for the configuration:** both fit the repo's other
  settings, but existing repositories already have `config/release.json`, and keeping it means
  switching from the script needs no configuration change.
- **Keeping the script's checkout-and-pull of production first:** it updates a branch the user didn't
  ask about and can fail on local changes. Reading the remote's copy gives the same starting point
  without that.
- **Skipping the merge request with a warning when settings are missing:** a warning is easy to miss.
  Failing before anything changes, with `--no-merge-request` as the explicit opt-out, is consistent
  with `project release create`.
- **Accepting the script's `--project-id`, `--gitlab-token`, and `GITLAB_*` tokens:** these are
  replaced by the repo's `--vcs-*` flags and `SIMPLY_VCS_TOKEN`. The migration notes list the mapping.
- **Sharing git helpers through `simply-core`** (the first draft's plan): `simply-core` runs no
  subprocesses and has no `execa` dependency, and the shared surface would have been about four short
  functions, since `simply-project-core`'s `assertWorkingTreeReady` also checks for a shallow clone
  that only matters to its tag lookups. The happy-soup helpers live in `simply-cicd-core`, which
  already depends on `execa`, and `simply-project-core` is unchanged.
- **Logging from the library:** `simply-cicd-core`'s `logger` writes straight to the console for
  pipeline jobs. These functions print nothing and return warnings in their result instead, so the
  commands keep `--json` output clean.

## Implementation plan

`simply-plugins-core` (released first):

1. `simply-core`: `createMergeRequest` gains an optional last argument,
   `{ draft?: boolean; removeSourceBranch?: boolean }` (`VcsMergeRequestOptions`). GitLab prefixes the
   title with `Draft:` and sets `remove_source_branch` from the option (default `true`, as today).
   GitHub sends `draft: true`.
2. `simply-cicd-core` `src/happySoup/`:
   - `releaseConfig.ts`: the schema, `loadReleaseConfig`, and the team and application lookups for
     prompts.
   - `branches.ts` (internal): git through `execa`, branch-name validation, remote branch listing, and
     checking out an existing branch.
   - `createReleaseBranch.ts` (with `resolveHappySoupVcs`) and `stageReleaseBranch.ts` (with
     `listStagingBaseBranches`): the two operations, each with `dryRun` and a structured result.
   - Exports from `index.ts`.

`simply-plugins`:

4. `simply-plugin-kit`: a `text` prompt with validation, alongside `select` and `confirm`.
5. `simply-cicd`: both commands, `messages/*.md`, the `happy-soup` topic in `oclif.topics`, tests, the
   snapshot, and the README.
6. Site: a "Happy-soup release branches" guide, a new reference group in
   `sync-command-reference.mjs` with its sidebar entry, and a pointer from
   `happy-soup-vs-project.md`.

## Testing

- `simply-core`: a draft merge request, and `removeSourceBranch`, send the right request to GitLab
  and GitHub, and the default request is unchanged.
- `releaseConfig.test.ts`: every accepted shape for teams and applications, defaults, discovery
  stopping at the repository root, `--config` not found, and invalid files naming their fields.
- `createReleaseBranch.test.ts` and `stageReleaseBranch.test.ts` (real git against a bare remote):
  - the branch is cut from the remote's tip and not from local commits;
  - the template files land at the deploy stages' path in one commit;
  - missing templates are skipped;
  - the push sets upstream tracking;
  - a fake provider receives the draft merge request, and an existing one is not duplicated;
  - an existing branch is checked out, fast-forwarded, or left alone when diverged;
  - a dirty tree, an invalid date or segment, a missing base, an unknown remote, a bad message, a
    local-only release branch, or missing VCS settings fail before anything changes;
  - a rejected commit pushes nothing and leaves the files staged;
  - a staging branch that exists only locally is switched to;
  - dry run changes nothing.
- Command tests: flag delegation, prompts (stubbed) only when interactive, `--no-prompt` errors, and
  `--json` output.

## Migration from the script

| Script                                     | Here                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `--type release --date D`                  | `happy-soup release create --date D`                            |
| `--type staging --team T --app A --name N` | `happy-soup release stage --team T --app A --name N`            |
| `--no-mr`                                  | `--no-merge-request`                                            |
| `--project-id`                             | `--vcs-project-id`, `SIMPLY_VCS_PROJECT_ID`, or `vcs.projectId` |
| `--gitlab-token`, `GITLAB_*_TOKEN`         | `--vcs-token` or `SIMPLY_VCS_TOKEN`                             |
| `gitlabProjectId` in `.sfdevrc.json`       | Still read, with `loadSfDevRc`'s existing deprecation warning   |
| `.projectrc.json`                          | Not read. Move its settings to `.sfdevrc.json`.                 |
| `config/release.json`                      | Unchanged                                                       |

## Open questions

- Should `release stage` offer `--push`? The script never pushed staging branches, so it doesn't for
  now.
- Should there be a published JSON schema for `config/release.json`? The script's schema references
  `$schema` but doesn't ship one.
