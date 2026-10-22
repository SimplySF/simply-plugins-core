# 0047 — `simply permissions build --check`

**Status:** Implemented (core SimplySF/simply-plugins-core#239, `simply-permissions-core@0.4.0`; CLI
SimplySF/simply-plugins#92)
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0050)
**Date:** 2026-10-20

## Problem

`simply permissions build` generates permission sets from source metadata, and
[0041](0041-permissions-build-from-file.md)'s `--file` lets a project declare every generated set in
one place. Nothing checks that the committed XML still matches what `build` would produce. A
developer can add a custom object or field, or change an override file, without rerunning `build`.
The permission set then silently stops granting access to the new metadata, and nobody notices until
a user hits a missing permission in an org.

CI could check this today by running `build` and then `git diff --exit-code` on the output
directory. That has three problems. It writes into the checkout. It only works when the output is
tracked by git. And its failure message is a raw diff with no hint about which command fixes it.

## Decision

Add a `--check` flag to `simply permissions build`. With `--check`, `build` scans, compiles, and
renders every targeted permission set exactly as it normally would, but compares the result against
the file already on disk instead of writing it. It reports each set as `up-to-date`, `drifted`, or
`missing` and sets `process.exitCode = 1` when any set is not up to date. `--check` works in both
modes: the single-set flags and `--file`.

The comparison goes in `simply-permissions-core` as `checkPermissionSets(specs)`, a sibling of
`generatePermissionSets` that shares its one-scan-per-directory loop. This follows 0041's reasoning
that the build logic has non-CLI consumers. A CI script that already calls `generatePermissionSets`
directly should get drift checking from the same library without shelling out.

## Behavior

```
sf simply permissions build --file config/app.psbuild.json --check
sf simply permissions build --type read-only --name App_Read_Only --directory force-app \
  --output force-app/main/default/permissionsets --check
```

| Flag      | Notes                                                                                 |
| --------- | ------------------------------------------------------------------------------------- |
| `--check` | New boolean, default `false`. Combines with `--file` or with the single-set flags.    |
| (others)  | Unchanged. All validation (required flags, config files, directories) runs as normal. |

### What counts as drift

Each targeted set is compiled to the XML `build` would write to
`<output>/<name>.permissionset-meta.xml`, then compared with that file:

| Status       | Condition                                                          |
| ------------ | ------------------------------------------------------------------ |
| `up-to-date` | The file exists and is **semantically equal** to the rendered XML. |
| `drifted`    | The file exists and differs.                                       |
| `missing`    | No file at that path.                                              |

"Semantically equal" means both documents are parsed and their element trees compared: element
names, attributes, element order, and non-whitespace text must match. Whitespace-only text between
elements (indentation, line endings, a trailing newline) is ignored. This matters because the
Salesforce DX project template's `lint-staged` runs Prettier with `@prettier/plugin-xml` over
`**/*.xml`. A generated file that was reformatted on commit is not drift, and a byte comparison
would report every reformatted file as drifted.

The XML declaration and comments are ignored too. Text and attribute values are compared as strings,
so `True` is not the same as `true`.

A file that isn't well-formed XML counts as `drifted`, not as an error, because rerunning `build`
fixes it. This includes a file with a missing closing tag, which a bad merge can produce.

Element order is significant. `build` sorts every permission list by API name, so a hand-reordered
file is drift, and so is a hand-edited one. A generated file is meant to be owned by the generator.
The generator writes elements in the order Salesforce writes them on retrieve (alphabetical, at the
top level and within each entry), so retrieving an unchanged permission set from an org doesn't make
it drift. Earlier versions wrote `viewAllRecords` before `viewAllFields`, `name` before `enabled`,
and `tabSettings` before `recordTypeVisibilities`, so a retrieved file was reported as drifted even
though it granted the same permissions.

### Output

Human output: the same table as `--file`, with a `STATUS` column added (single-set mode prints a
one-row table too, so the output looks the same in both modes). Then one of:

- `All N permission set(s) are up to date.`
- A warning: `M of N permission set(s) have drifted from their source metadata. Run this command
without --check to regenerate them.`

`--json`: the same shape `build` already returns (an object for single-set, an array for `--file`),
with a `status` field added to each entry. `path` and the permission counts describe what `build`
_would_ write.

```json
{
  "name": "App_Admin",
  "path": "force-app/main/default/permissionsets/App_Admin.permissionset-meta.xml",
  "objectPermissionCount": 12,
  "fieldPermissionCount": 87,
  "status": "drifted"
}
```

### Exit code and errors

- Any `drifted` or `missing` set → `process.exitCode = 1`, and the command still resolves with the
  full result. This follows the precedent set by the `validate` commands
  ([0010](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0010-at4dx-domain-process-binding-validate.md)): throwing would replace the per-set
  results in `--json` output with an error envelope on exactly the runs where CI needs them.
- Every existing error (`invalid-config`, `config-not-found`, `directory-not-found`, `scan-failed`)
  still throws as it does without `--check`, with exit code 1. CI fails either way. The table only
  appears when the inputs themselves were valid.
- Nothing is written, and the output directory is not created.

### `simply-permissions-core` additions (minor release, `0.4.0`)

| Export                                         | Purpose                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `checkPermissionSets(specs, onPermissionSet?)` | Scan and compile each spec as `generatePermissionSets` does, compare with disk, write nothing. |
| `PermissionSetCheckResult`                     | `PermissionSetBuildResult & { status: PermissionSetCheckStatus }`.                             |
| `PermissionSetCheckStatus`                     | `'up-to-date' \| 'drifted' \| 'missing'`.                                                      |

`generatePermissionSets` and `checkPermissionSets` share a private scan-and-compile iterator, so the
two can't disagree about what a spec compiles to.

New dependency: `fast-xml-parser` (`^5.11.1`, already a direct dependency of `simply-core` and
`simply-settings-core`). It checks well-formedness with `XMLValidator`, then parses both documents
with `preserveOrder` and compares the trees. The draft planned to parse with `xmlbuilder2`, which the
package already uses to render. That was dropped because its parser doesn't check well-formedness:
it silently closes unclosed elements and treats mismatched close tags as matching. A file with its
final `</PermissionSet>` removed would have compared as `up-to-date`, even though it won't deploy.

## Alternatives considered

**Leave it to `build` + `git diff --exit-code` in CI.** This needs no code, but it has the problems
listed under Problem: it writes into the checkout, requires tracked output, and gives a raw diff as
the failure. It also reports Prettier-reformatted files as changed, because `build`'s output is not
Prettier-formatted.

**A separate `simply permissions check` command.** This would duplicate all of `build`'s flags and
`--file` handling. A `--check` mode on the generator matches what CI users already know from
`prettier --check` and `black --check`.

**Byte comparison (after normalizing line endings).** This is simpler and stricter, but it fails on
any project whose commit hooks run Prettier over XML, which is the SFDX template default. Users
would have to exclude generated permission sets from Prettier just to make the check usable.

**Throw an `SfError` on drift.** This gives a clearer "error" in human output, but `--json` loses
the per-set results. It was rejected for the same reason as in `simply-plugins`' 0010.

**Implement it in the plugin only.** This would ship in one PR without a core release. It was
rejected for the same reason 0041 rejected keeping the builder in the plugin: the logic has
plausible non-CLI consumers, and the core already owns how a spec compiles.

## Implementation plan

1. **Core PR** (`simply-plugins-core`): `src/permissionSetBuild.ts` gains `checkPermissionSets`,
   the shared iterator, and an XML tree comparison helper. Barrel exports, the
   `test/index.test.ts` key list, unit tests, the README API table, and this doc (this copy).
   Publish `simply-permissions-core@0.4.0`.
2. **Feature PR** (`simply-plugins`, `feat/permissions-build-check`): bump the core dependency.
   `build.ts` gets `--check`, the `STATUS` column, and the exit code. Then `messages`, tests,
   `pnpm run build` (snapshot), `pnpm run readme` in `simply-permissions` and `packages/simply`,
   `pnpm --filter site run sync`, and this doc's index row and status.

## Testing

**Core unit:** `up-to-date` for a freshly generated file, and after reindenting it, converting it to
CRLF, removing its trailing newline, collapsing it onto one line, or replacing its declaration with
a comment. `drifted` for a changed value, a value differing only in case, a removed or extra entry,
reordered entries, a missing closing tag, non-XML content, empty content, and a new field added to
the source metadata. `missing` for an absent file. One scan for two specs sharing a directory.
Nothing written and no directory created, even for `missing` sets.

**CLI unit:** `--check` with `--file` across a mix of all three statuses: the table, the warning,
`process.exitCode === 1`, and the `--json` array with `status`. A clean run leaves the exit code
unset. Single-set `--check`. Input errors still throw under `--check`. Generated files are not
touched.

**Manual:** in a scratch SFDX project, run `build --file`, then Prettier over the output, then
`--check` (expect clean). Add a field, run `--check` (expect `drifted`, exit 1), then `build` and
`--check` again (expect clean).

## Open questions

1. **Showing what drifted.** Version 1 reports only a status per set. A per-set summary such as
   "+3 field permissions, −1 object permission" would make CI failures easier to act on, but it
   needs a structural diff of `PermissionSetTemplateData` against the parsed file. Proposed as a
   follow-up if users ask for it.
2. **Orphaned files.** A permission set removed from the `--file` declaration leaves its old XML in
   the output directory. That is a different question ("is this file still generated?") from drift,
   so it is left out of scope here.

## Follow-up

`simply-plugins`' design doc
[0051](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0051-cicd-check-permission-sets.md)
standardized permission sets file names on the `.psbuild.json` suffix, so
`sf simply cicd build check-permission-sets` can find them. This doc's example was updated to match.
This library still accepts any filename. Resolving 0051's open question 3, the suffix is exported from
here as `PERMISSION_SETS_FILE_SUFFIX` (`0.5.0`), and both plugins import it instead of defining it.
