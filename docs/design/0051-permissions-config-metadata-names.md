# 0051 — Override keys match the PermissionSet metadata

**Status:** Draft
**Package:** `packages/simply-permissions-core` (library); `packages/simply-permissions` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0055)
**Date:** 2026-10-22

## Problem

[0050](0050-permissions-config-record-access-names.md) renamed `viewAll` and `modifyAll` to the
metadata's `viewAllRecords` and `modifyAllRecords`. The rest of a permission set build config's
override keys still differ from the XML they produce:

| Section   | Config key                         | PermissionSet XML                                      |
| --------- | ---------------------------------- | ------------------------------------------------------ |
| `objects` | `read`, `create`, `edit`, `delete` | `allowRead`, `allowCreate`, `allowEdit`, `allowDelete` |
| `tabs`    | `visible: boolean`                 | `<visibility>`: `Visible`, `Available`, or `None`      |

Tabs are more than a naming problem. The generator writes `visible: false` as
`<visibility>Hidden</visibility>`, which is a profile value, not one a permission set accepts. And a
boolean can't express `Available` (the tab is available but hidden from the user's nav).

The other sections already match: `fields` (`readable`, `editable`), `recordTypeVisibilities`
(`visible`), `userPermissions` (keyed by `<name>`, valued by `<enabled>`), and
`hasActivationRequired`.

## Decision

Every override key is the PermissionSet element it sets:

- `objects` entries take `allowRead`, `allowCreate`, `allowEdit`, `allowDelete`, `viewAllRecords`,
  `modifyAllRecords`, and `viewAllFields`.
- `tabs` entries take `visibility`: `Visible`, `Available`, or `None`, written to the XML as given.

The old keys are rejected with `invalid-config`, as in 0050: `read was renamed to allowRead.`,
`visible was renamed to visibility (Visible, Available, or None).`

Generated defaults: a scanned tab is `Visible`, as before. A tab that only an override names, with
no `visibility` of its own, is `None` (it was `Hidden`).

The exported `TabSetting` type changes from `{ tab, visible: boolean }` to
`{ tab, visibility: TabVisibility }`, with `TabVisibility` exported alongside it.

This ships in the same release as 0050 (`simply-permissions-core@0.8.0`), so consumers migrate once.

## Alternatives considered

**Keep `tabs[].visible` and only fix the `Hidden` output.** It fixes the deploy problem but keeps a
key that isn't the metadata's, and still can't express `Available`.

**Accept both old and new keys.** Rejected for the same reasons as in 0050: two names for one setting
forever, and a precedence rule for files that set both.

## Implementation plan

1. **Core:** rename the `objects` keys; replace `tabs[].visible` with a `visibility` enum; generalize
   0050's renamed-key rejection to both schemas; `TabSetting.visibility` in the template, which
   writes it unchanged; tests.
2. **`simply-permissions`:** the README's `--config` example and table.

## Testing

**Core:** each renamed key is rejected from an inline `config` and from an overrides file, naming the
new key; every renamed key in one file is reported at once; an invalid `visibility` value is
rejected; overrides with the new keys compile; a scanned tab is `Visible` and an override-only tab
without `visibility` is `None`; the template writes `Visible`, `Available`, and `None` as given and
never `Hidden`.

## Open questions

None.
