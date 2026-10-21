# 0049 — One permission set per `.psbuild.json` file; `--file` removed

**Status:** Implemented (core SimplySF/simply-plugins-core#244, `simply-permissions-core@0.7.0`; CLI
SimplySF/simply-plugins#98)
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI) and
`packages/simply-cicd` (`check-permission-sets`), in `simply-plugins`, where this doc is duplicated
as its 0053
**Date:** 2026-10-21

## Problem

A `.psbuild.json` file ([0039](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0039-permissions-build-from-file.md)) is a list:
`{ "defaults": {...}, "permissionSets": [ ... ] }`. The list existed so that one
`sf simply permissions build --file <f>` could regenerate every permission set in a project. Since
[0052](0048-permissions-build-discover.md) (this repo’s 0048), `sf simply permissions build` with no flags finds every
`.psbuild.json` file in the repo and builds them all. The list no longer does anything that discovery
doesn't, and it has costs:

- Two places describe the same thing: an entry's settings, and the `defaults` that fill in the gaps.
  To work out what one permission set is built from, you have to merge them in your head.
- Permission sets that belong to different features or packages share one file, so the file is a
  merge-conflict hotspot and can't sit next to the source it describes.
- `--file` and discovery are two ways to say "build these files." `--file` with a list file builds
  a group, but discovery already builds everything, and nobody has needed to build a group that
  isn't "everything."

## Decision

A `.psbuild.json` file defines **exactly one permission set**. Its top-level object is that permission
set's settings, the same ones the single-set flags take. There is no `permissionSets` array and no
`defaults`. `sf simply permissions build --file` is removed. The command has two modes: the
single-set flags, or no flags (discovery).

`@simplysf/simply-permissions-core` owns the format, so the schema, the loader, and the discovery
function change there. The exports are renamed from "permission sets file" to "permission set build
file". A consumer of the old API then fails to compile, which is better than it silently getting a
different shape from a function with the same name. Both plugins move to the new API in the same
release.

## Behavior

### The file format

```json
{
  "name": "App_Admin",
  "type": "modify-all",
  "label": "App Admin",
  "description": "Full access to the app's objects.",
  "directory": "force-app",
  "output": "force-app/main/default/permissionsets",
  "includeRecordTypes": true,
  "config": "config/app-admin-overrides.json"
}
```

| Key                  | Required | Meaning (same as the flag)                                            |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `name`               | yes      | `--name`: the API name, also the output filename                      |
| `type`               | yes      | `--type`: `read-only`, `view-all`, or `modify-all`                    |
| `directory`          | yes      | `--directory`: source directory to scan                               |
| `output`             | yes      | `--output`: directory to write the XML to                             |
| `label`              | no       | `--label`; defaults to `name`                                         |
| `description`        | no       | `--description`                                                       |
| `includeRecordTypes` | no       | `--include-record-types`; defaults to `false`                         |
| `config`             | no       | `--config`: a path to an overrides file, or the same overrides inline |

`name` is always explicit. It isn't derived from the filename, so renaming the file never changes
which permission set is generated. Relative paths still resolve against the current directory, not
the file's folder. That is unchanged from 0039, so the values mean what they would as flags.

### Which mode runs

| Flags given                                         | Mode                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Any single-set flag                                 | One permission set (unchanged); a missing required flag is an error |
| None of the above (`--check`, `--json` are allowed) | Discovery: every `.psbuild.json` file (0052's search, unchanged)    |
| `--file`                                            | **Removed**: oclif's unknown-flag error                             |

### Discovery output

The output is the same as 0052's, except that each file contributes exactly one row. The `--json`
entries keep their shape: `{ file, name, path, objectPermissionCount, fieldPermissionCount, status? }`,
one per file, in file order.

### Errors

Every file is loaded and validated before anything is written, as before. Two errors are new:

| Situation                                             | Error                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file in the old format (top-level `permissionSets`) | `Permission set build file <f>: <f> uses the old format, a "permissionSets" list, which is no longer supported. Split it into one .psbuild.json file per permission set, with each permission set's settings at the top level.` |
| Two files define the same `name`                      | `Permission set <name> is defined by both <a> and <b>. Each permission set must be defined by exactly one .psbuild.json file.`                                                                                                  |

The duplicate check replaces the old schema's per-file "names must be unique" rule. With one
permission set per file, every duplicate is a cross-file duplicate, so the check now spans every
discovered file. That also resolves 0052's open question 1. Without the check, the last file wins
and silently overwrites the other's output.

### `sf simply cicd build check-permission-sets`

This command uses the same discovery, loading, and duplicate check. All files are now validated
before any is checked, matching the build command. Its `--json` result changes from
`files: [{ file, permissionSets: [...] }]` to `files: [{ file, permissionSet }]`. The regenerate hint
becomes `sf simply permissions build`, which rebuilds everything, because `--file` no longer exists.

## Alternatives considered

**Keep `--file`, pointing at one single-set file.** This would let someone rebuild one permission set
without the long list of flags. It was rejected to keep one way of saying "build from a file":
discovery builds everything in seconds, and the single-set flags remain for one-off builds. It can be
added back later without breaking anything; removing it later would break things.

**Accept both formats.** Old files would keep working, but every consumer would need to handle both
shapes forever, and the "which file declares this set" question would stay muddy. The package is
pre-1.0 and has few files in the wild. A targeted error that says exactly how to migrate is
cheaper than a permanent second format.

**Derive `name` from the filename** (`App_Admin.psbuild.json` builds `App_Admin`). It saves one line,
but a file rename would then change which permission set gets generated, and the old one would be
left behind as an orphan.

**Resolve paths against the file's folder.** This would allow short relative paths in files kept
next to their source. It was rejected because it changes how every existing value resolves, and it
makes a file's values mean something different from the same flags. It can be revisited separately.

**Keep the old export names with the new shape.** `loadPermissionSetsFile` returning one spec instead
of an array would type-check at many call sites (`for…of` over a non-array fails, but spreading and
passing it on may not). Renaming makes every consumer look at the change.

## Implementation plan

1. **Core** (`simply-plugins-core`, breaking, `0.7.0`):
   - `schemas/permissionSetsFile.ts` → `schemas/permissionSetBuildFile.ts`:
     `PermissionSetBuildFileSchema` (flat, required `name`/`type`/`directory`/`output`),
     `PermissionSetBuildFile`, `PERMISSION_SET_BUILD_FILE_SUFFIX`.
   - `permissionSetBuild.ts`: `loadPermissionSetBuildFile(path): Promise<PermissionSetSpec>`
     (adds the `legacy-format` error code), `findPermissionSetBuildFiles()`, and
     `assertUniquePermissionSetNames(entries)` (adds the `duplicate-name` code).
   - `index.ts` and `test/index.test.ts`'s pinned list; tests; README and site guide.
2. **`simply-permissions`**: bump to `^0.7.0`; remove `--file`, `suffixedName`, and the
   unsuffixed-file warning; adapt discovery; update messages, the README, and the site page.
3. **`simply-cicd`**: bump to `^0.7.0`; validate everything first, check duplicates, use the new
   result shape and regenerate hint; update messages, the README, and the site pages.
4. `pnpm run build` (snapshots), `pnpm run readme` in both plugins and `packages/simply`,
   `pnpm --filter site run sync`, and the index rows in both repos.

## Testing

**Core:** a flat file loads into one spec, with inline and file-referenced `config`; a missing required
key is `invalid-config`; an old-format file is `legacy-format`; a missing source directory is still
`directory-not-found`; `assertUniquePermissionSetNames` accepts distinct names and throws
`duplicate-name` naming both files; discovery is unchanged.

**`simply-permissions`:** discovery builds one set per file, in file order, with `file` on each
entry; an old-format file fails, naming the file, and writes nothing; a duplicate name across two
files fails and writes nothing; `--check` with discovery still reports drift and exit code 1;
`--file` is rejected as an unknown flag; single-set mode is unchanged.

**`simply-cicd`:** an up-to-date repo succeeds; stale sets across files are all reported before
failing, with the new hint; an invalid file fails before anything is checked; a duplicate name
fails.

## Open questions

None.
