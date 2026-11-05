# 0057 — `simply project release roll-forward`

**Status:** In progress
**Package:** `packages/simply-project-core` (new library); `packages/simply-project` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0059)
**Date:** 2026-10-31

## Problem

`simply-cicd` assumes a branching strategy without ever writing it down or helping anyone maintain
it. Each repo is one unlocked package, and each release branch (`release/v1.1.0`) is tied to one
package version. The primary branch is itself one of these release branches, not a literal `main`.
Several can be in flight at once, so a fix on `release/v1.1.0` has to reach `release/v1.2.0` too, or
it regresses when v1.2.0 ships.

Leads do this "roll forward" by hand, which has three traps:

- **The merge method decides whether the history survives.** The pipeline tags each package version
  (`v1.1.0.13`, annotated with its `04t`), and those tags show when a version entered a branch's
  history. A squash or rebase leaves `v1.1.0.13` unreachable from `release/v1.2.0`. In a scratch
  repo, after a squash, `git tag --merged` no longer listed the source's newest tag.
- **The first roll always conflicts on `sfdx-project.json`.** Two releases cut from the same commit
  have both changed `versionNumber`. Resolving it the wrong way is costly: the release branch's next
  build creates a v1.1.0 package version from v1.2.0 code, and tags it.
- **The roll-forward branch name matters.** `create-package-version` treats a ref as a release branch
  if it _contains_ the prefix (`ciCommitRefName.includes(prefix)`), so a working branch named
  `release/roll-1.1-to-1.2` would spend a package version.

## Decision

Add `sf simply project release roll-forward`. It merges each release branch into the next higher one
with a real merge commit, keeps the target's package identity in `sfdx-project.json`, and pushes
without ever rewriting history or force-pushing. It is run by a lead from a local clone, not by a
pipeline.

### Where it lives

The command belongs to the `project` topic, in `simply-project`, under a new `release` subtopic. The
logic goes in a new library, `@simplysf/simply-project-core` (`src/release/rollForward.ts`), with a
thin command on top, following the `-core` split in
[0019](0019-plugin-core-library-extraction.md).

The first draft put it in `simply-cicd` as `cicd release roll-forward`, with the logic in
`simply-cicd-core`. That was the wrong home:

- **It isn't a pipeline command.** Every `simply cicd` command is a pipeline stage or a pipeline's
  helper, run unattended with a pipeline's environment. This one is run by a lead from a local
  clone, and works on the project's repository and its `sfdx-project.json`, which is what the
  `project` topic is for.
- **It needs none of `simply-cicd-core`.** It only runs `git` and reads `sfdx-project.json`. Putting
  it in `simply-cicd-core` would make a consumer that only wants to roll branches install the
  Salesforce packaging, deploy, and VCS libraries that package depends on.
- **`simply-project` had no `-core` library.** Its one existing command, `project update
api-version`, is small enough to stay where it is, but new project-maintenance logic now has a
  home that other tools can use directly.

`simply-project-setup-core` was considered as the library and rejected. Its scope is standardizing a
project's files from template packs, documented as such in
[0035](0035-simply-project-setup-core.md), and it ships no opinions of its own. Release-branch rules
are an opinion.

The `release` subtopic is kept under `project`, so related commands, such as listing release
branches or cutting a new one, have a place to go. The flag `--package-release-branch-prefix` keeps
its name, since it must hold the same value as on `cicd build create-package-version`.

## Behavior

### Flags

| Flag                              | Default    | Meaning                                                               |
| --------------------------------- | ---------- | --------------------------------------------------------------------- |
| `--source`                        | see below  | Oldest release branch to roll from.                                   |
| `--target`                        | see below  | Newest release branch to roll into.                                   |
| `--package-release-branch-prefix` | `release/` | Same name and meaning as on `create-package-version`.                 |
| `--remote`                        | `origin`   | Remote holding the release branches.                                  |
| `--dry-run`                       | off        | Print the plan and the tags each hop would bring in, then stop.       |
| `--no-push`                       | off        | Stop after the merge, leaving the roll branch for a merge request.    |
| `--no-prompt`                     | off        | Skip the confirmation before pushing.                                 |
| `--message`                       | see below  | Commit message template, with `{SOURCE}` and `{TARGET}` placeholders. |

### Choosing the hops

1. Fetch the remote's branches and tags. Refuse a shallow clone, whose tag history is incomplete.
2. Keep remote branches named `<prefix>[v]MAJOR.MINOR[.PATCH]`, ignoring others such as
   `release/uat`, and sort them **numerically**, so `v1.10.0` follows `v1.9.0`.
3. Plan one hop per adjacent pair: `v1.1.0 → v1.2.0`, then `v1.2.0 → v1.3.0`. A hop is needed when the
   lower branch isn't an ancestor of the higher one.

| Flags given     | Hops considered                                              |
| --------------- | ------------------------------------------------------------ |
| Neither         | From the lowest branch with work to roll, up to the highest. |
| `--source` only | From `--source` up to the highest.                           |
| `--target` only | From the lowest branch with work to roll, up to `--target`.  |
| Both            | From `--source` to `--target`, through every branch between. |

A source that isn't lower than its target is an error, so a release can't be rolled backward. There
is no way to skip a branch between `--source` and `--target`, because each version must contain
everything before it.

### Each hop

1. Require a clean working tree, and record the current branch so it can be restored.
2. Create `roll-forward/v1.1.0-to-v1.2.0` from the remote's target. Fail if the name contains the
   release prefix, which would make it a release branch to the pipeline.
3. Run `git merge --no-ff --no-commit <remote>/<source>`, so the target is the first parent and
   `git log --first-parent` reads as the target's own timeline.
4. Resolve `sfdx-project.json` (below). If anything else conflicts, stop.
5. Commit with the message from `--message`, running the repository's hooks (below).
6. Verify the source tip is an ancestor of `HEAD` and that the target's identity fields are unchanged.
7. Push with `git push <remote> HEAD:refs/heads/release/v1.2.0`, then delete the roll branch.

The push never uses `--force` or `--tags`. The source's tags are already on the remote and become
reachable through ancestry, and pushing local tags could publish strays. If the target has moved, the
push is rejected and the lead re-runs the command.

### `sfdx-project.json`

For each `packageDirectories` entry, matched by `package`:

| Field                                                           | Resolution                                   |
| --------------------------------------------------------------- | -------------------------------------------- |
| `versionNumber`, `versionName`, `ancestorVersion`, `ancestorId` | Always the target's value.                   |
| `packageAliases` (top level)                                    | Union of both sides.                         |
| Anything else, such as `dependencies`                           | Normal merge; a conflict stops for the lead. |

The first three rows apply even when git merged cleanly, so a wrong identity can't slip through
without a conflict. Before merging, the command also checks that each branch's `versionNumber` agrees
with its name, and refuses if not, since a mismatch means the plan is built on a wrong assumption.

### Commit messages and hooks

Repositories can have their own commit rules, such as commitlint, so the command doesn't impose a
commit convention. The default message is git's own wording, `Merge branch 'release/v1.1.0' into
release/v1.2.0`, which commitlint's default rules ignore. `--message` covers stricter rules, such as a
required ticket number, and its placeholders let one template work across a whole chain. A blank
message or an unknown placeholder is refused before anything changes.

Hooks always run. There is no `--no-verify` and no flag to add it, because a repository's commit rules
belong to its team, and skipping a local hook can still fail in CI or server-side push rules. If a hook
rejects the commit, the hop reports `Commit rejected` with the hook's output, and the command exits
non-zero with the merge still in progress. The lead runs `git commit` with an accepted message and
re-runs the command. Pre-commit hooks that rewrite files can add changes to the merge commit, which is
left to the team's hook configuration.

### Conflicts and re-running

The command has no saved state. On a conflict it stops with the merge in progress on the roll branch,
lists the files, and says what to do: resolve and `git commit`, then re-run, or `git merge --abort`.
A re-run on a roll branch with a finished merge verifies it and carries on from step 6. A re-run with
the merge still unfinished is an error that repeats those instructions. Hops are sequential, so a
stop leaves later hops untouched.

If a roll branch exists but no longer includes the latest source and target, the command refuses and
tells the lead to delete it, rather than discarding a hand-made resolution. When a push is rejected,
a merge the command made by itself is discarded so a re-run can simply make it again; one the lead
resolved by hand is kept. `--no-push` stops after the first hop, because the next hop's source isn't
final until that merge lands.

### Output

For each hop, the result reports source, target, status (`Rolled`, `Up to date`, `Conflict`, `Commit rejected`, `Merged,
not pushed`, `Would roll`, `Not started`), merge commit, and the tags it brought in, from
`git tag --merged <source> --no-merged <target>`. Those tags are unfiltered, so fallback and
feature-suffixed tags appear too. `--json` returns the same data. A conflict or a rejected commit exits non-zero.

### Pipeline effects

Each pushed hop triggers a normal release-branch build, so it can spend a package version.
`determine-package-changes` keeps working: the `v1.2.0.*` glob ignores the merged-in `v1.1.0.*` tags,
and in the scratch repo `git describe` still returned `v1.2.0.5` after a roll. The confirmation prompt
says how many branches will be pushed for this reason.

## Alternatives considered

- **Always open a merge request.** It adds review, but the platform's merge method then decides the
  outcome: squash loses the tags' ancestry, and GitLab's fast-forward method rebases. It would also
  require token and VCS flags on a local command. `--no-push` covers teams that need a merge request
  and leaves the choice of merge method to them, with a warning to use a merge commit. If they get it
  wrong, the next run shows the hop as still needing a roll.
- **Merging the source straight into a local target branch.** A stop would leave the lead's own
  release branch mid-merge, and it could include unpushed local commits. Basing a roll branch on the
  remote's target avoids both.
- **Rolling only one hop per run.** Simpler, but a chain is the common need and is easy to leave half
  done. `--source` and `--target` can still limit a run to one hop.
- **Pushing source tags or re-tagging the merge commit.** Unnecessary, since ancestry is what makes
  the tags visible. A new tag on the merge commit would also falsely imply a package version.
- **A fixed conventional commit message.** The first version used `chore(release): roll ...`. A
  stricter repository would reject it, and release tooling could mistake it for a publish commit,
  which uses the same type and scope in this monorepo.
- **Bypassing hooks with `--no-verify`.** It would make the command succeed by overriding a team's
  rules, and a server-side rule could still reject the push.
- **A pipeline job that rolls automatically.** Conflicts need a person, and an unattended job would
  spend package versions. A pipeline can still run this command later with `--no-prompt`.

## Implementation plan

In `simply-plugins-core`, then released:

1. Create `packages/simply-project-core`, registered like the other `-core` libraries: root README
   and `CONTRIBUTING.md` tables, `eslint.config.mjs`, and the docs site's typedoc plugin, sidebar,
   getting-started page, homepage card, and a guide. Its only dependencies are `execa`, plus `chalk`
   and `log-symbols` for its `logger`.
2. `src/release/releaseBranches.ts`: parse and sort branch names, and select pairs.
3. `src/release/projectIdentity.ts`: apply and check the target's identity. A conflict is merged by
   giving each side the target's identity first, so a text merge sees only real differences.
4. `src/release/rollForward.ts`: orchestration, using `execa`.
5. Export `rollForward` and its types from `src/index.ts`, pinned by `test/index.test.ts`.

Then in `simply-plugins`:

6. Add `@simplysf/simply-project-core` to `simply-project`.
7. Add `src/commands/simply/project/release/roll-forward.ts`, its `messages/` file, and the `release`
   subtopic in `package.json`.
8. Add `site/.../cicd/concepts/release-branches.md`, which documents the strategy for the first
   time. It stays with the `cicd` docs, because the strategy is what `cicd build` assumes, and links
   to the command's reference on the `simply-project` plugin page.
9. Run the `AGENTS.md` checklist: README (including `packages/simply`'s, since `simply-project` is
   bundled), `command-snapshot.json`, and `pnpm --filter site run sync`.

## Testing

- **Unit:** name parsing, including `v1.10.0` after `v1.9.0` and ignoring `release/uat`; hop planning
  for each flag combination; each identity field, including a wrong value that merged cleanly; alias
  union; a `dependencies` conflict still stopping.
- **Integration, against real temporary git repos with a bare remote:** because the guarantees are
  about git's behavior, mocking `execa` would prove little. Cases: the first roll's identity conflict
  resolves itself; tags are reachable afterward and the target is the first parent; a two-hop chain;
  an unrelated conflict stops, and a re-run finishes; a moved target rejects the push without forcing;
  an unpushed local tag stays local; a shallow clone is refused.
- **Command:** flag parsing and delegation, matching the other `simply-project` command tests.

## Open questions

- **Custom branch formats.** Only `<prefix>[v]MAJOR.MINOR[.PATCH]` is recognized. This is separate from
  `versionTagFormat`, which governs tags rather than branches.

## Resolved questions

Decided by the requester on 2026-10-31:

- **Publishing.** Leads may push to release branches, so direct push is the default. Merge request
  creation is not built into the command; `--no-push` remains the opt-out.
- **Abandoned release branches.** Teams delete or rename them. There is no `--exclude` flag.
- **Default run.** With no flags, the command rolls the whole chain and stops at the first conflict.
- **Branch names.** The primary branch is itself a release branch. A literal `main` is not part of
  the chain.

Decided by the requester on 2026-11-05:

- **Topic and package.** The command moves from `cicd` to `project`, and its logic into a new
  `simply-project-core` package, as described under [Where it lives](#where-it-lives).
