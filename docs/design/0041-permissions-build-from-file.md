# 0041 — `simply permissions build --file`

**Status:** Draft
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0039)
**Date:** 2026-09-29

## Problem

`simply permissions build` generates **one** permission set per run: `--type`, `--name`,
`--directory`, `--output`, and optionally `--config`, `--label`, `--description`,
`--include-record-types`. A project that maintains several generated permission sets (say, a
read-only, a support, and an admin set) has to keep the flag combinations for every one of them
somewhere — a shell script, a `package.json` script per set, or tribal knowledge — and run each one
separately. Nothing declares "these are all the permission sets this project generates", so they
drift: a set gets added to one developer's script and not to CI, or a label is changed on one
invocation and not the other.

## Decision

Add a `--file` flag to `simply permissions build`: a JSON **permission sets file** declaring every
permission set the project generates, all built in one run. Each entry takes exactly the settings of
one flag-driven `build` run; a top-level `defaults` object supplies the settings most entries share
(`directory`, `output`, `includeRecordTypes`). An entry's overrides are inline or a path to an
existing `--config` file, so projects that already have override files adopt this without rewriting
them. `--file` is exclusive with the single-permission-set flags.

The scan/compile/write logic moves out of the command and into `simply-permissions-core`, following
the [0024](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0024-apex-test-suite-generate.md) precedent (new build logic lands in the `-core`
package, and the command stays a thin flags/spinner/table wrapper). It's split into
`scanPermissionSetSource(directory)`, `compilePermissionSet(scan, options)`, and
`writePermissionSet(data, name, output)`, plus `loadPermissionSetsFile(path)` (validate and resolve
the whole file) and `generatePermissionSets(specs)` (build them, scanning each distinct source
directory once). Both zod schemas (the existing `--config` one and the new file one) move with it,
as `apex-core`'s config schemas did. Failures are signalled as `PermissionSetBuildError` with a
structural `code` the CLI maps to its own messages, matching `ApexTestSuiteError`.

### Related fix, landed separately first

While verifying the extraction, `build` on `main` was found to emit
`<field>Widget__c.Widget__c.Color__c</field>` and `<recordType>Widget__c.Widget__c.Standard</recordType>`
for every field and record type under a `CustomObject` folder: SDR's child `fullName` already
includes the parent, and the code prefixed it again. Those names don't deploy, and a `--config`
override for `Widget__c.Color__c` was added as a second entry instead of merging. That fix ships as
its own PR (`fix/permissions-build-child-names`) ahead of this work; the core extraction carries the
fixed logic.

## Behavior

```
sf simply permissions build --file config/permission-sets.json
```

| Flag                                                             | Char | Notes                                                                    |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| `--file`                                                         | `-f` | New. Must exist. Exclusive with every flag below.                        |
| `--type`, `--name`, `--directory`, `--output`                    |      | No longer `required: true` at the oclif level; required unless `--file`. |
| `--config`, `--include-record-types`, `--label`, `--description` |      | Unchanged.                                                               |

Without `--file`, a missing required flag is reported as one error naming each missing flag:
`Missing required flag(s): --directory, --output. Provide them, or use --file to build every
permission set declared in a permission sets file.` (oclif's own per-flag message previously.)

### Permission sets file

```json
{
  "defaults": {
    "directory": "force-app",
    "output": "force-app/main/default/permissionsets"
  },
  "permissionSets": [
    { "name": "App_Read_Only", "type": "read-only" },
    {
      "name": "App_Admin",
      "type": "modify-all",
      "label": "App Admin",
      "includeRecordTypes": true,
      "config": "config/app-admin-overrides.json"
    },
    {
      "name": "App_Support",
      "type": "view-all",
      "config": { "userPermissions": { "ViewSetup": true } }
    }
  ]
}
```

| Key                                       | Equivalent flag          | Notes                                                   |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `permissionSets[].name`                   | `--name`                 | Required. Unique within the file.                       |
| `permissionSets[].type`                   | `--type`                 | Required. `read-only` \| `view-all` \| `modify-all`.    |
| `permissionSets[].label`                  | `--label`                | Defaults to `name`.                                     |
| `permissionSets[].description`            | `--description`          |                                                         |
| `permissionSets[].directory` / `defaults` | `--directory`            | Required on the entry or in `defaults`; entry wins.     |
| `permissionSets[].output` / `defaults`    | `--output`               | Required on the entry or in `defaults`; entry wins.     |
| `permissionSets[].includeRecordTypes`     | `--include-record-types` | Entry, then `defaults`, then `false`.                   |
| `permissionSets[].config`                 | `--config`               | A path to a `--config` file, or the same object inline. |

Relative paths (`directory`, `output`, and a `config` path) resolve against the **current
directory**, exactly as the flags do — not against the file's location.

### Validation and errors

The whole file is validated — schema, referenced override files, source directories — before any
permission set is written, so a typo in the last entry doesn't leave the first ones regenerated and
the rest stale.

| `PermissionSetBuildError.code` | Condition                                                                               | CLI message                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `invalid-config`               | Malformed JSON or schema violation (incl. duplicate `name`, `directory`/`output` unset) | `The configuration file <path> is invalid: <zod detail>`               |
| `config-not-found`             | A referenced override file doesn't exist                                                | `The configuration file <path> does not exist.`                        |
| `directory-not-found`          | An entry's source directory doesn't exist                                               | `The source directory <dir> for permission set <name> does not exist.` |
| `scan-failed`                  | SDR can't resolve the source directory                                                  | `Failed to scan the Salesforce project directory: <detail>`            |

`error.invalidConfig` now names the file (it applies to `--config` too, which previously said "The
permission set configuration file is invalid: …" without a path), and `--config` malformed JSON is
now reported through it rather than as a raw `SyntaxError`.

### Output

Single-set mode is unchanged: `Permission set successfully generated at <path>`, and `--json`
returns `{ path, objectPermissionCount, fieldPermissionCount }`. Progress now shows one
`Building permission set <name>...` line instead of the previous scan/compile/write steps.

With `--file`: a table of `NAME`, `PATH`, `OBJECT PERMISSIONS`, `FIELD PERMISSIONS`, then
`Successfully generated N permission set(s).`; `--json` returns an array of
`{ name, path, objectPermissionCount, fieldPermissionCount }` in file order.

### `simply-permissions-core` additions (minor release)

| Export                                                       | Purpose                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `scanPermissionSetSource(directory)`                         | Objects, permissionable fields, tabs, record types in a source directory. |
| `compilePermissionSet(scan, options)`                        | Pure: `type` baseline + overrides → `PermissionSetTemplateData`.          |
| `writePermissionSet(data, name, output)`                     | Render and write `<output>/<name>.permissionset-meta.xml`.                |
| `loadPermissionSetBuildConfig(path)`                         | Load/validate a `--config` overrides file.                                |
| `loadPermissionSetsFile(path)`                               | Load/validate a permission sets file into `PermissionSetSpec[]`.          |
| `generatePermissionSets(specs, onPermissionSet?)`            | Build and write each spec; one scan per distinct directory.               |
| `PermissionSetBuildError`                                    | `code` + `args`, as above.                                                |
| `PermissionSetBuildConfigSchema`, `PermissionSetsFileSchema` | The two zod schemas.                                                      |

New dependencies: `@salesforce/source-deploy-retrieve`, `@simplysf/simply-core`, `zod` — all
already dependencies of sibling `-core` packages (`apex-core`, `aep-core`, `community-core`).

## Alternatives considered

**A separate `build-all` command.** Prototyped first. It keeps `build`'s required flags and
single-object JSON shape untouched, but adds a second command whose every entry is "a `build` run";
one command with two input modes was preferred. The cost is accepted: `build`'s JSON result is a
union (object without `--file`, array with it), and the required-flag check moves from oclif into
the command.

**A `build all` subcommand.** Makes `build` both a command and a topic, which nothing else in this
repo does.

**Resolve relative paths against the file's directory.** Works from any cwd, but a file kept in
`config/` would need `../force-app` everywhere, and the same value would mean something different in
the file than as a flag.

**Keep the builder in the plugin (`src/common/`).** Ships in one PR without a core release, and was
what the prototype did. Rejected for consistency with 0024: the scan/compile logic has non-CLI
consumers (CI scripts, editor tooling) as plausible as `buildPermissionSetXml`'s.

**Build what we can and report failures at the end.** Validating everything up front makes this
mostly moot; the only remaining mid-run failures are I/O errors on write, where continuing would
produce more of the same error.

## Implementation plan

1. **Fix PR** (`simply-plugins`, `fix/permissions-build-child-names`): child `name` instead of
   `fullName` in `build.ts`, with a fixture-project regression test. Lands first.
2. **Core PR** (`simply-plugins-core`, `feat/permission-set-build-service`):
   `src/permissionSetBuild.ts`, `src/schemas/permissionSetBuildConfig.ts` (moved from the plugin),
   `src/schemas/permissionSetsFile.ts`, barrel exports, `test/index.test.ts` key list, unit tests
   with a fixture project, README API table, site guide, this doc (0041 here, 0039 in `simply-plugins`). Publish.
3. **Feature PR** (`simply-plugins`, `feat/permissions-build-file`): bump
   `@simplysf/simply-permissions-core` to the published version; `build.ts` gains `--file` and
   delegates to core; delete `src/schemas/build/permissionConfig.ts`; `messages`; tests;
   `pnpm run build` (snapshot), `pnpm run readme` in `simply-permissions` and `packages/simply`,
   `pnpm --filter site run sync`; this doc's index row.

## Testing

**Refactor parity** (done during prototyping, not kept as a test): the original `build.ts` and the
extracted logic were run side by side on a fixture project (custom object with normal, required,
and master-detail fields; a record type; a tab; a standalone field on `Account`) across all 3 types
× `--include-record-types` on/off × with/without a config exercising every override section —
byte-identical XML in all 12 combinations, before the child-name fix was applied.

**Core unit** (`permissionSetBuild.test.ts`): scan of the fixture (exclusions, standalone-field
parent, un-prefixed child names, empty directory, `scan-failed`); each type baseline;
`includeRecordTypes`; every override section merging into scanned entries and adding new ones;
`viewAllFields` suppressing field permissions; sorting; `loadPermissionSetsFile` defaults/overrides
resolution and every error code, including the zod messages for duplicate names and unset
`output`; `generatePermissionSets` writing one file per spec with `ComponentSet.fromSource` called
once for two specs sharing a directory (`force-app` and `force-app/`).

**CLI unit** (`build.test.ts`): existing cases; missing-flag message names only the missing flags;
invalid `--config` names the file; `--file` end-to-end with inline and file-referenced overrides;
`--file` + `--type` rejected; nothing written when a later entry is invalid; schema violation
reported with the file path.

**Manual**: `bin/run.js simply permissions build --file ...` in a scratch project — table output,
`--json` array, mixed-flag and missing-flag errors, and the generated XML's field/record type names.

## Open questions

1. **A `--name` filter** with `--file` to regenerate a subset. Cheap to add; left out to keep the
   first version to exactly what was asked.
