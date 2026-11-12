# 0061 — `simply project release create`

**Status:** In progress (implemented in both repos; the `simply-plugins` side waits on the `simply-plugins-core` release)
**Package:** `packages/simply-project-core` (logic); `packages/simply-core` (VCS providers move here);
`packages/simply-cicd-core` (re-exports); `packages/simply-project` (CLI, in `simply-plugins`, where
this doc is duplicated as its 0062)
**Date:** 2026-11-12

## Problem

[0057](0057-project-release-roll-forward.md) wrote down the release-branch strategy and gave leads a
command to roll fixes forward. It reserved the `project release` subtopic for related commands,
"such as listing release branches or cutting a new one". Cutting is still done by hand, and it has
its own traps:

- **The version lives in two places.** The branch name (`release/v1.3.0`) and `sfdx-project.json`'s
  `versionNumber` (`1.3.0.NEXT`) must agree. `roll-forward` refuses a branch where they don't. A lead
  who forgets to bump the file builds a v1.2.0 package version from the new branch and tags it.
- **The new branch is pushed from whatever is local.** Cutting from a local `release/v1.2.0` with
  unpushed commits, or from a stale checkout, starts the next release from the wrong code.
- **The GitLab steps are manual and easy to skip.** Teams publish a GitLab release for the version
  being closed out, from its latest package-version tag, and point the project's default branch at
  the new release branch. Both are clicks in the GitLab UI today.

A sanitized internal tool, `release.ts` (an `SfCommand` using `@clack/prompts`), already does all of
this, and is the starting point. It can't be dropped in as is, because several of its choices go
against decisions this repo has already made:

| `release.ts` does                                               | This repo's rule                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `git commit --no-verify`                                        | Hooks always run ([0057](0057-project-release-roll-forward.md#commit-messages-and-hooks)).                           |
| `curl --header "PRIVATE-TOKEN: <token>"` through `execSync`     | Platform calls go through `VcsProvider` ([0037](0037-simply-cicd-core.md)); a token never appears on a command line. |
| Shell strings built from `--release-tag` and branch names       | `execa` with argument arrays only, and remotes checked against `git remote`.                                         |
| Its own `.sfdevrc.json` walk for `gitlabProjectId`/`gitlabHost` | `loadSfDevRc` and `resolveVcsSettings` ([0059](0059-sfdevrc-shared-config.md)).                                      |
| Hard-coded `release/vX.Y.Z`                                     | `--package-release-branch-prefix` and `parseReleaseBranch`.                                                          |
| `JSON.stringify(project, null, 2)`                              | `stringifyProject` keeps the file's own indentation.                                                                 |
| Branches from the local `HEAD`                                  | Roll-forward bases its work on the remote's tip.                                                                     |
| GitLab only                                                     | Every VCS feature works for each registered provider.                                                                |

## Decision

Add `sf simply project release create`. From a release branch, it creates the next release branch
on the remote with its version bumped in `sfdx-project.json`. It can also publish a VCS release for
the version being closed out, and make the new branch the project's default. The git half needs no
token. The VCS half goes through `VcsProvider`, which gains three methods.

### Where it lives

Like roll-forward, the logic goes in `@simplysf/simply-project-core`
(`src/release/createRelease.ts`), with a thin command in `simply-project`.

The VCS steps need `VcsProvider`, which lives in `simply-cicd-core`. 0057 kept
`simply-project-core` from depending on that package, because it pulls in `@salesforce/packaging`,
`source-deploy-retrieve`, `source-tracking`, and three other `-core` libraries. That reasoning still
holds, so instead **the `vcs/` module moves to `@simplysf/simply-core`**:

- It already fits there. Its only imports are `fetch` and `VcsProviderKind`, which
  [0059](0059-sfdevrc-shared-config.md) already moved to `simply-core`. Its 1,034 lines have no
  Salesforce dependency.
- `simply-core` already owns `resolveVcsSettings`, so the settings and the client that uses them end
  up in one package.
- `simply-cicd-core` re-exports every name from `simply-core` unchanged, including
  `registerVcsProvider` and the registry. There is still one registry, so a provider registered
  through either package is visible to both. Nothing that imports from `simply-cicd-core` breaks.

Depending on `simply-cicd-core` directly was considered and rejected (see
[Alternatives](#alternatives-considered)).

### New `VcsProvider` methods

```ts
export type VcsRelease = { tagName: string; name: string; webUrl?: string; raw: unknown };

export interface VcsProvider {
  // ...existing members...

  /** Finds the release for a tag, if one exists. */
  findRelease?(project: VcsProjectRef, tagName: string): Promise<VcsRelease | undefined>;

  /** Publishes a release for an existing tag. */
  createRelease?(
    project: VcsProjectRef,
    release: { tagName: string; name: string; description?: string },
  ): Promise<VcsRelease>;

  /** Makes a branch the project's default branch. */
  setDefaultBranch?(project: VcsProjectRef, branchName: string): Promise<void>;
}
```

| Method             | GitLab (REST v4)                                           | GitHub (REST)                                                    |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `findRelease`      | `GET /projects/:id/releases/:tag_name` (404 → `undefined`) | `GET /repos/:owner/:repo/releases/tags/:tag` (404 → `undefined`) |
| `createRelease`    | `POST /projects/:id/releases`                              | `POST /repos/:owner/:repo/releases`                              |
| `setDefaultBranch` | `PUT /projects/:id` with `default_branch`                  | `PATCH /repos/:owner/:repo` with `default_branch`                |

The members are **optional**, because `registerVcsProvider` is public and a third-party provider
written against today's interface must still compile. Both built-in providers implement them. A
command that needs one checks for it first, then fails with "`<kind>` doesn't support creating
releases", before changing anything.

## Behavior

### Flags

| Flag                              | Default            | Meaning                                                                  |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| `--type`, `-t`                    | required           | `major`, `minor`, or `patch`.                                            |
| `--source`                        | current branch     | Release branch to cut from. Its version is the one being closed out.     |
| `--package-release-branch-prefix` | `release/`         | Same name and meaning as on `roll-forward` and `create-package-version`. |
| `--remote`                        | `origin`           | Remote holding the release branches.                                     |
| `--message`                       | see below          | Commit message template, with an optional `{VERSION}` placeholder.       |
| `--create-release`                | off                | Publish a VCS release for the source's version before cutting.           |
| `--release-tag`                   | latest, below      | Tag to publish the release from. Implies `--create-release`.             |
| `--set-default`                   | off                | Make the new branch the project's default after pushing.                 |
| `--vcs-provider`                  | config             | Same meaning as on the `cicd` commands.                                  |
| `--vcs-host`                      | config             | Instance hostname.                                                       |
| `--vcs-project-id`                | config             | GitLab numeric ID or GitHub `owner/repo`.                                |
| `--vcs-token`                     | `SIMPLY_VCS_TOKEN` | API token. Needed only with `--create-release` or `--set-default`.       |
| `--dry-run`                       | off                | Print the plan, without changing anything locally or remotely.           |
| `--no-prompt`                     | off                | Don't ask for confirmation.                                              |

Provider, host, and project ID go through `resolveVcsSettings` (flag, then `SIMPLY_VCS_*`, then
`.sfdevrc.json`'s `vcs` section), so a legacy `gitlabProjectId` keeps working through 0059's legacy
mapping. The provider is built only when a VCS step was asked for. A missing token or project ID is
reported **before** anything changes, rather than after the branch is pushed, as `release.ts` does.

### Steps

1. Check that `--remote` is a configured remote and that the working tree is clean, reusing
   roll-forward's checks. Fetch the remote's branches and tags.
2. Parse `--source` (or the current branch) with `parseReleaseBranch`. Fail if it isn't a release
   branch, or if `<remote>/<source>` doesn't exist.
3. Check that the source's `versionNumber` matches its name (`versionNumberMatchesBranch`).
4. Compute the next version, keeping the source label's shape: `v1.2.0` → `v1.3.0`, `1.2` → `1.3`. A
   `patch` on a minor-line branch such as `release/1.2` is an error, since it has no patch to bump.
5. Fail if a branch for the new version already exists on the remote, under either label shape
   (`release/1.3` or `release/v1.3.0`), so two branches can't claim the same version. A higher
   release branch is fine: a `patch` from `v1.2.0` while `v1.3.0` exists is a normal hotfix. The first
   draft refused any higher branch, which would have blocked exactly that.
6. Show the plan and ask for confirmation, unless `--no-prompt`, `--json`, or `--dry-run`.
7. **Optional release.** With `--create-release`, pick the tag (below), publish the release, and
   report `Created`, or `Already exists` when `findRelease` finds one, so a re-run doesn't fail.
8. Create the local branch from `<remote>/<source>`, never from the local checkout.
9. Bump `sfdx-project.json` (below) and commit with hooks running.
10. Push with `git push <remote> HEAD:refs/heads/<new branch>` and set the upstream. Never `--force`
    or `--tags`.
11. **Optional default.** With `--set-default`, call `setDefaultBranch`.
12. Switch back to the branch the lead started on.

### Choosing the release tag

`--release-tag` is used as given, but must exist on the remote. Otherwise the command picks the
highest `v<MAJOR>.<MINOR>.<PATCH>.<build>` tag that is both reachable from `<remote>/<source>` and on
the remote (`git ls-remote --tags`), sorting with `git tag --sort=v:refname`. Fallback and
feature-suffixed tags such as `v1.2.0.11-fallback` are skipped, so a release is never published from
a fallback build. Requiring the tag on the remote matters twice: the platform creates the release
from its own copy, and GitHub would otherwise create a missing tag from the default branch. It also
means an unpushed local tag on the source can't be picked. The first draft only checked reachability,
which would have picked such a tag and then failed. The release is named after the source label, for
example `v1.2.0`.

### `sfdx-project.json`

Every `packageDirectories` entry whose `versionNumber` matches the source version is bumped. Entries
for other packages are left alone.

| Field                           | New value                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versionNumber`                 | `<MAJOR>.<MINOR>.<PATCH>.NEXT`. The build-number part keeps the source's (`NEXT` in practice).                                                                          |
| `versionName`                   | The old version text, with or without a `v`, replaced in place: `Core v1.2.0` → `Core v1.3.0`. If it doesn't contain the old version, it is left as is, with a warning. |
| `ancestorVersion`, `ancestorId` | Unchanged. See [Open questions](#open-questions).                                                                                                                       |

The file is rewritten with `stringifyProject`, so its indentation stays the same. If no entry
matches, the command fails before creating the branch, because a release branch whose version
disagrees with its name is exactly what roll-forward refuses.

### Commit messages and hooks

The default message is `chore: bump version to {VERSION}`, which is what `release.ts` used. It
passes commitlint's conventional rules, and it doesn't use `chore(release):`, the publish-commit
type and scope 0057 warned against. `--message` covers stricter rules. As with roll-forward, a blank
message or an unknown placeholder is refused up front, and hooks always run.

If a hook rejects the commit, nothing has been pushed. The command reports `Commit rejected` with
the hook's output and exits non-zero, leaving the new local branch with the bump staged. The lead
commits with an accepted message and re-runs **from the new branch**. That branch isn't on the
remote yet, so it can't be the source. Instead, when the current branch is an unpushed release branch
whose parent is the tip of exactly one remote release branch, that remote branch is taken as the
source. The re-run must name the same new branch, so re-running with a different `--type` is an error.
A local branch exactly one commit ahead of `<remote>/<source>`, with the bumped version, resumes at the
push. Any other existing local branch with that name is an error telling the lead to delete it, and
it is checked before any platform release is published.

### Output

```ts
export type CreateReleaseResult = {
  source: string; // release/v1.2.0
  branch: string; // release/v1.3.0
  version: string; // 1.3.0
  status: 'Created' | 'Would create' | 'Commit rejected' | 'Declined';
  commit?: string;
  bumpedPackages: string[]; // ['Core']
  release?: { tagName: string; name: string; status: 'Created' | 'Already exists' | 'Would create'; webUrl?: string };
  defaultBranch?: { status: 'Set' | 'Would set' | 'Not set' };
  commitError?: string; // the hook's output, when `Commit rejected`
};
```

The command prints a short table of these, and `--json` returns the result itself. A rejected commit
exits non-zero.

### Pipeline effects

Pushing the new branch triggers a release-branch build, which creates the first package version for
the new release (`v1.3.0.1`). The confirmation prompt says so. Publishing the release adds no tag, so
it doesn't start a tag pipeline.

## Alternatives considered

- **Depend on `simply-cicd-core` from `simply-project-core`.** This needs the fewest changes to land,
  but it is the heavy dependency 0057 rejected, added to a command that only needs `git` and a few
  REST calls.
- **Call GitLab directly with `fetch` in `simply-project-core`.** This keeps `release.ts`'s scope with
  no move, but it creates a second, GitLab-only VCS client next to the abstraction 0037 built so
  commands never encode one platform's API.
- **Port `release.ts`'s `@clack/prompts` wizard.** None of the other `simply-*` commands use clack;
  they prompt through `SfCommand`'s `confirm`. A required `--type` plus one confirmation that shows
  the whole plan covers what the wizard asked, without a new dependency or a second code path. See
  [Open questions](#open-questions).
- **Required members on `VcsProvider`.** These are cleaner to call, but they break every third-party
  provider at compile time, which would make this a major release of `simply-core`.
- **Cut from local `HEAD`, as `release.ts` does.** This would carry unpushed commits into the new
  release, and differ from roll-forward, which always starts from the remote.
- **Bump `versionNumber` on every package directory.** In a multi-package repo, this would also bump
  packages that aren't on the release train.

## Implementation plan

In `simply-plugins-core`, then released:

1. Move `packages/simply-cicd-core/src/vcs/` to `packages/simply-core/src/vcs/`, with its tests,
   and export it from `simply-core`'s index. (`simply-core` has no exported-key test to pin it in.)
   Make `simply-cicd-core/src/vcs/index.ts` a re-export, so its twelve internal importers and the
   `vi.mock` paths in its tests are unchanged, and check that its exported-key test still passes.
2. Add `VcsRelease` and the three optional methods, implemented for GitLab and GitHub, with
   `fetch`-mocked tests of each endpoint and of 404 handling.
3. Add `src/release/createRelease.ts` to `simply-project-core`, reusing `releaseBranches.ts` (which
   gains `nextReleaseBranch`). Move roll-forward's git helpers, checks, and message validation into a
   shared `src/release/git.ts`. Add `bumpProjectVersion` in `src/release/projectVersion.ts`. Add
   `resolveReleaseVcs` (`src/release/releaseVcs.ts`), which builds the provider from explicit values,
   `SIMPLY_VCS_*`, and `.sfdevrc.json`, so the command stays thin. Add `@simplysf/simply-core` as a
   dependency.
4. Export `createRelease`, `resolveReleaseVcs`, `RELEASE_TYPES`, and their types from `src/index.ts`,
   pinned by `test/index.test.ts`.
5. READMEs and docs-site guides for `simply-core`, `simply-cicd-core` (where VCS now lives), and
   `simply-project-core`.

Then in `simply-plugins`:

6. Bump `@simplysf/simply-project-core`.
7. Add `src/commands/simply/project/release/create.ts` and
   `messages/simply.project.release.create.md`, with command tests matching `roll-forward.test.ts`.
8. Extend `site/.../cicd/concepts/release-branches.md` with cutting a release.
9. Run the `AGENTS.md` checklist: READMEs (including `packages/simply`'s), `command-snapshot.json`,
   `pnpm --filter site run sync`, and duplicate this doc as `simply-plugins`' 0062.

## Testing

- **Unit:** next-version math, including the label shape and `patch` on a minor-line branch; tag
  selection, including `v1.2.0.9` before `v1.2.0.10`, skipping fallback tags, and ignoring
  unreachable tags; the `versionName` rewrite with and without `v`, and with no match;
  multi-package projects; message validation.
- **Integration, against real temporary git repos with a bare remote** (as in roll-forward): branch
  pushed with the bump commit on top of the remote's source tip, ignoring unpushed local commits; an
  existing target branch refused; a higher release branch refused; a rejecting `commit-msg` hook
  leaves no push, and a re-run finishes; indentation preserved; the start branch restored.
- **Providers:** each new method against a mocked `fetch`, checking the URL, the method, the auth
  header, and that the token appears in no error message.
- **Command:** flag parsing, `--release-tag` implying `--create-release`, VCS settings resolution, and
  no prompt with `--no-prompt`, `--json`, or `--dry-run`.

## Resolved questions

Decided by the requester on 2026-11-12, as proposed below:

- **Topic and name.** `project release create`.
- **VCS scope.** Full parity through `VcsProvider`, with the providers moved to `simply-core` rather
  than adding a dependency on `simply-cicd-core`.

## Open questions

These were accepted with their proposed answers on 2026-11-12, and are left here for the record.

- **Interactive mode.** Should omitting `--type` in a terminal prompt for it, with each option
  showing its resulting version, as `release.ts`'s wizard did? This would use `@inquirer/select`,
  which `sf-plugins-core` already brings in. Proposed: yes, as the only interactive addition.
- **`ancestorVersion`.** For packages that set it, should the new branch's ancestor become the version
  being closed out, for example `1.2.0.LATEST`? Proposed: leave it unchanged for now, since none of
  this strategy's unlocked packages set it.
- **Legacy token variables.** `release.ts` read `GITLAB_WORKFLOW_TOKEN`, `GITLAB_PRIVATE_TOKEN`,
  `GITLAB_TOKEN`, and `GITLAB_PERSONAL_ACCESS_TOKEN`. Proposed: support only `--vcs-token` and
  `SIMPLY_VCS_TOKEN`, matching 0060's prefixing, and document the change.
