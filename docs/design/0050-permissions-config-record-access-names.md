# 0050 — Overrides use `viewAllRecords` / `modifyAllRecords`

**Status:** Implemented (core SimplySF/simply-plugins-core#246, `simply-permissions-core@0.8.0`; CLI
SimplySF/simply-plugins#100)
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0054)
**Date:** 2026-10-21

## Problem

A permission set build config's `objects` entries (the `--config` file, or a `.psbuild.json` file's
`config`) take `read`, `create`, `edit`, `delete`, `modifyAll`, `viewAll`, and `viewAllFields`. The
generated XML calls the last three `modifyAllRecords`, `viewAllRecords`, and `viewAllFields`. So
`viewAllFields` matches the metadata and the other two don't. `viewAll` next to `viewAllFields` also
reads as though one were a superset of the other, when they grant different things: every record
versus every field.

## Decision

Rename `viewAll` to `viewAllRecords` and `modifyAll` to `modifyAllRecords`, the names Salesforce's
`ObjectPermissions` metadata uses. Meaning and defaults are unchanged.

An `objects` entry that still uses `viewAll` or `modifyAll` is rejected as `invalid-config`, with an
issue naming the new key. Without the check, zod strips the unknown key and the override silently
stops applying: a `"viewAll": true` would quietly generate a permission set without View All Records.

## Behavior

```json
{
  "objects": {
    "Account": { "read": true, "viewAllRecords": true },
    "Case": { "modifyAllRecords": false }
  }
}
```

| Situation                                     | Result                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `viewAllRecords` / `modifyAllRecords`         | Overrides the type's baseline, as `viewAll` / `modifyAll` did                               |
| `viewAll` / `modifyAll` in an `objects` entry | `invalid-config`, path `objects.<Object>.viewAll`: `viewAll was renamed to viewAllRecords.` |

The rejection is the same for an overrides file and an inline `config`; the error names the file
the key is in, as any other `invalid-config` does.

## Alternatives considered

**Accept both names.** Existing files keep working, but then two keys mean the same thing forever,
and a file setting both needs a precedence rule. The package is pre-1.0 and these keys are rare; a
targeted error is a one-line fix for whoever hits it.

**Silently ignore the old names.** This is what zod does by default. It turns a rename into a
permission set that grants less than its file says, which is the worst failure for this tool.

## Implementation plan

1. **Core** (breaking, `0.8.0`, #246): rename the keys in `ObjectPermissionConfigSchema`, reject
   the old ones, apply the new ones in `compilePermissionSet`; tests. The API reference regenerates
   from the schema at site build time; the README and guide don't list these keys.
2. **`simply-permissions`**: skip `0.8.0` and move straight to `^0.10.0` with 0051; update the
   README's config section and example, and the command's messages if they mention the keys.

## Testing

**Core:** `viewAllRecords` / `modifyAllRecords` overrides change the compiled object permission in
both directions; `viewAll` and `modifyAll` are each rejected with `invalid-config` and a message
naming the new key, from an overrides file and from an inline `config`.

## Open questions

None.
