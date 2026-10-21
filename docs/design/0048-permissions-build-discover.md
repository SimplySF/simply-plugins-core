# 0048 — `simply permissions build` with no flags builds every `.psbuild.json` file

**Status:** In progress (awaiting `simply-permissions-core@0.6.0`)
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI) and
`packages/simply-cicd` (switches to the shared search), in `simply-plugins`, where this doc is
duplicated as its 0052
**Date:** 2026-10-21

## Problem

[0051](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0051-cicd-check-permission-sets.md) made `.psbuild.json` the standard suffix for permission
sets files, and `sf simply cicd build check-permission-sets` finds every one in the repo by itself.
The command that fixes drift doesn't. A developer whose CI job lists three stale files has to run
`sf simply permissions build --file <f>` three times, and has to know where every file lives. A repo
with files in several places needs a script just to regenerate everything.

Today, running `sf simply permissions build` with no flags is an error (`Missing required flag(s):
--type, --name, --directory, --output`). That invocation is free to give a useful meaning.

## Decision

When `sf simply permissions build` is run with neither `--file` nor any of the flags that describe a
single permission set, it finds every `.psbuild.json` file under the current directory and builds
every permission set they declare. `--check` works the same way, so `sf simply permissions build
--check` is the local equivalent of the CI job.

The search moves from `simply-cicd` into `@simplysf/simply-permissions-core` as
`findPermissionSetsFiles()`, and both plugins call it. `simply-permissions-core` owns the file format
and the suffix constant ([0051](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0051-cicd-check-permission-sets.md) open question 3), so it also owns
the rule for finding the files. With one implementation, the CLI and the CI job can't disagree about
which files exist.

## Behavior

```
sf simply permissions build            # build every permission set in every .psbuild.json file
sf simply permissions build --check    # check them all, exit 1 on drift
```

### Which mode runs

| Flags given                                         | Mode                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `--file`                                            | That file only (unchanged)                                          |
| Any single-set flag (see below)                     | One permission set (unchanged); a missing required flag is an error |
| None of the above (`--check`, `--json` are allowed) | **Discovery**: every `.psbuild.json` file                           |

The single-set flags are `--type`, `--name`, `--directory`, `--output`, `--config`,
`--include-record-types`, `--label`, and `--description`.

A partial set of single-set flags stays an error rather than falling back to discovery: someone who
typed `--name` meant to build one permission set. The error text now mentions both alternatives.

### Discovery

The search is the one from `simply-plugins`' 0051, unchanged: walk from the current directory; match names ending in
`.psbuild.json`; don't descend into `node_modules`, `.git`, `.sf`, or `.sfdx`; don't follow symbolic
links; sort by `/`-separated relative path. Relative paths inside each file resolve against the
current directory, as they do for `--file`.

Every file is loaded and validated before anything is written, extending 0041's validate-first rule
across files: an invalid file fails the command with its path in the error, and no permission set is
generated. All permission sets are then built in one pass, so a source directory shared by several
files is scanned once.

### Output

| Situation                | Output                                                                                                                   | Exit                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| No `.psbuild.json` files | Warning: `No permission sets files (files ending in .psbuild.json) found under the current directory. Nothing to build.` | 0                     |
| Files found, building    | `Found N permission sets file(s).`, then the table with a FILE column, then the count                                    | 0                     |
| Files found, `--check`   | The `--check` table with a FILE column, then the usual drift warning or success line                                     | 1 if any set is stale |
| An invalid file          | `Permission sets file <f>: <the usual error text>`                                                                       | 1                     |

No files found is a warning and a clean exit, matching the CI job's skip. A wrapper script or a
shared `package.json` script can then run the command in any repo.

`--json` returns an array with one entry per permission set, in file order, then declaration order.
Each entry is the `--file` entry plus `file`, the permission sets file that declared it:
`{ file, name, path, objectPermissionCount, fieldPermissionCount, status? }`. No files gives `[]`.

## Alternatives considered

**Copy the search into `simply-permissions`** and move it to core later, the way the suffix constant
went. This would ship without waiting on a core release, but two copies of the walk can drift. For
example, one could gain a skipped directory and the other not, and then the CLI and CI would
disagree about which files exist. The release is cheap, and nothing urgent is waiting on this.

**Fail when no files are found.** This is stricter for a developer who ran the command in the wrong
directory. It was rejected so that the command behaves the same as the CI job, and so that it is safe
in shared scripts. The warning still names the directory that was searched.

**Fall back to discovery whenever the single-set flags are incomplete.** This would mean a typo'd or
forgotten `--type` silently built every file in the repo. Requiring no single-set flags at all keeps
the two modes unambiguous.

**A `--all` flag instead of a flagless default.** This is explicit, but it adds a flag whose only
legal combination is "nothing else". The flagless invocation was an error with no other meaning.

**Build file by file, failing on the first invalid file after earlier files were written.** This is
simpler, but it leaves the repo half-regenerated. Validating everything first costs one extra pass
over small JSON files.

## Implementation plan

1. **Core** (`simply-plugins-core`): move `findPermissionSetsFiles()` and its skip list into
   `src/permissionSetBuild.ts`, export it from `src/index.ts`, add it to `test/index.test.ts`'s
   pinned list, and port `simply-plugins`' 0051 discovery tests. This is a minor release (`0.6.0`).
2. **`simply-cicd`**: bump to `^0.6.0`, delete its local copy, import it from core, and drop the
   moved discovery tests. No behavior change.
3. **`simply-permissions`**: bump to `^0.6.0`; in `build.ts`, add the discovery mode and the FILE
   column; in `messages/simply.permissions.build.md`, update the description, flag descriptions,
   examples, the missing-flags error, and add the new info and warning messages.
4. Tests, then `pnpm run build` (snapshots), `pnpm run readme` in `simply-permissions` and
   `packages/simply`, `pnpm --filter site run sync`, and this doc's index row.

## Testing

**Core:** the discovery cases from `simply-plugins`' 0051 (any depth, sorted, `/` separators; other files ignored; skipped
directories pruned; works regardless of git).

**`simply-permissions` command:**

- With no flags, builds every set from two files, in order, with `file` on each JSON entry.
- With no flags and no files, warns and returns `[]`, exiting 0.
- An invalid file fails, naming the file, and writes nothing from any file.
- `--check` with no other flags reports drift across files and sets exit code 1.
- A partial set of single-set flags (`--name` alone) is still the missing-flags error.

**`simply-cicd`:** the existing `runCheckPermissionSets` tests pass unchanged against the core
function.

## Open questions

1. **The same permission set name in two files** would write the same output path twice, and the
   last one wins. Each file checks for unique names but nothing checks across files. This is left
   unhandled until a repo hits it. A cross-file check would belong in core, so the CI job gets it
   too.
