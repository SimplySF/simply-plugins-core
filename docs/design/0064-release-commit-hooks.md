# 0064 — Release commits that survive reformatting pre-commit hooks

**Status:** Implemented
**Package:** `packages/simply-project-core` (`createRelease`, `rollForward`, `release/git.ts`)
**Date:** 2026-11-13

## Problem

`createRelease` writes the version bump to `sfdx-project.json`, stages it, and commits with the
repository's hooks. Some repositories have a pre-commit hook that reformats files without restaging
them, such as a husky hook that runs `prettier --write`. When that happens, the commit holds our
formatting and the working tree holds the hook's. `createRelease` then pushes the commit, which
succeeds. Its last step switches back to the start branch, and that fails:

```
Error (1): Command failed with exit code 1: git switch release/v4.60.0
error: Your local changes to the following files would be overwritten by checkout:
        sfdx-project.json
```

The user sees exit code 1 for a release that was created and pushed. They are left on the new
branch with a dirty tree, and the pushed commit isn't what their hook would have produced.

`rollForward` has the same exposure: it commits merges with hooks and then switches branches.

Two details make the hook more likely to rewrite the file:

- `stringifyProject` always writes LF, even when the file was checked out with CRLF.
- `JSON.stringify` expands every array, where a formatter may collapse short ones.

## Decision

1. **`commitWithHooks(cwd, message)`** in `release/git.ts` replaces the raw `git commit` calls in
   `createRelease` and `rollForward`. It commits with hooks. If tracked files are dirty afterwards,
   it stages them with `git add -u` and runs `git commit --amend --no-edit`, which runs the hooks
   again. It does this up to two times.
   - Both functions refuse to start on a dirty tree (`assertWorkingTreeReady`). So anything dirty
     after the commit was written by a hook, and folding it in is safe.
   - A formatter is idempotent, so the second pass finds nothing to change.
   - "Dirty" means differing from `HEAD` (`git diff --name-only HEAD`), staged or not.
   - The amend passes `--allow-empty`. A hook that undoes the whole change would otherwise make git
     refuse the amend, which would surface as a confusing `Commit rejected`. With it, the version
     check in step 2 reports what actually happened.
   - If the tree is still dirty after two amends, it throws before anything is pushed, naming the
     files.
   - A rejected commit is reported exactly as it is today (`Commit rejected` with the hook's output).
2. **The version must survive the hook.** After the commit settles, `createRelease` re-reads
   `sfdx-project.json` from `HEAD`. If the hook removed the new version, it stops before pushing.
   `rollForward` already checks its merges with `verifyMerge`.
3. **Line endings are preserved.** `stringifyProject` writes CRLF when the original text used CRLF.
4. **Restoring the start branch is best-effort.** Once the push has succeeded, a failed switch back
   logs a warning with the command to run, instead of failing a release that was created.
   `restoreStart` returns whether it switched.

## Behavior

| Situation                                 | Before                                           | After                                                        |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Hook reformats and restages (lint-staged) | Works                                            | Works, no amend                                              |
| Hook reformats without restaging          | Pushes unformatted commit, then exit 1 on switch | Amends the hook's output in, pushes, returns to start branch |
| Hook keeps changing files on every commit | Same as above                                    | Throws before pushing, naming the files                      |
| Hook rejects the commit                   | `Commit rejected`                                | Unchanged                                                    |
| Hook removes the version bump             | Pushes it                                        | Throws before pushing                                        |
| Switch back fails after a successful push | Throws (exit 1)                                  | Warns with `git switch <branch>`; result is `Created`        |
| CRLF `sfdx-project.json`                  | Rewritten as LF                                  | Stays CRLF                                                   |

The amended commit still sits directly on the remote source branch. That keeps the resume check in
`resumable` working: it expects exactly one bump commit.

## Alternatives considered

- **`git commit --no-verify`.** This avoids the problem, but it also skips commit-msg checks and
  secret scanners, which teams rely on. These functions deliberately respect hooks.
- **Run the repository's formatter ourselves.** We can't know which formatter or configuration a
  repository uses, and its hook already does.
- **Commit the hook's changes as a second commit.** This breaks the one-commit resume check, and it
  leaves a formatting-only commit in every release.
- **`git stash` the hook's changes and switch anyway.** The command would return to the start
  branch, but the pushed commit would still not match the team's formatting, and the stash would
  be left behind.

## Implementation plan

1. `release/git.ts`: add `commitWithHooks`. `restoreStart` now catches a failed switch and
   returns `false`.
2. `release/projectIdentity.ts`: `stringifyProject` keeps CRLF.
3. `createRelease.ts`: `cutBranch` uses `commitWithHooks`, checks the committed version, and warns
   when `restoreStart` returns `false`.
4. `rollForward.ts`: `mergeHop` uses `commitWithHooks` (the amend keeps both merge parents), and
   warns when `restoreStart` returns `false`.

## Testing

Real-git tests, in the style of the existing ones, install hooks into the lead repository's
`.git/hooks`:

- A pre-commit hook that rewrites `sfdx-project.json` without restaging. The release is pushed with
  the hook's formatting, the lead is back on the start branch, the tree is clean, and the new branch
  has exactly one commit.
- The same hook during `rollForward`: the merge commit keeps two parents and includes the hook's
  output.
- A hook that changes a file on every commit: throws before pushing, and no branch is created on the
  remote.
- A hook that reverts the version: throws before pushing.
- A CRLF `sfdx-project.json` stays CRLF after the bump.
- A start branch that can't be restored: the result is `Created`, and a warning names the branch.

## Open questions

- None. The `simply-plugins` commands pass results through unchanged, so no plugin change is
  needed. The fix ships with a `simply-project-core` release and a dependency bump there.
