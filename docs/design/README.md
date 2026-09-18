# Design Documents

Every new feature in this repo gets a design document here **before** it gets code. The point isn't
ceremony — it's that a year from now, the "why" behind a command's shape (why this package, why this
flag, what we rejected) is recoverable without archaeology through git history and PR threads.

## Process

1. **Write the design doc first.** Copy the [template](#template) into
   `docs/design/NNNN-short-slug.md`, using the next free four-digit number.
2. **Get agreement on it** — on the doc, not on the diff. Decisions are cheapest to change here.
3. **Implement**, then update the doc if the implementation taught you something the design got
   wrong. A design doc that quietly diverges from the shipped behavior is worse than none.
4. **Set the status line** to `Implemented` (with the PR link) when it lands.

A design doc is not a substitute for user-facing docs. Command summaries, flag descriptions, and
examples still live in each package's `messages/*.md` and README — see the root `CONTRIBUTING.md`
checklist. The design doc records the reasoning; `messages/` records the behavior.

## When a design doc is required

- Any new command, or a new subtopic.
- Any change to an existing command's flags, output shape, or error behavior that users would
  notice.
- Any new shared module in `simply-core` or `simply-report`, or a change to how packages depend on
  each other — including how the sibling [`simply-plugins`](https://github.com/SimplySF/simply-plugins)
  repo's plugins consume a library published from here.
- Extracting or growing a library package meant for consumption outside this monorepo (like
  `simply-aep-core`) — a different, higher bar than the monorepo-internal libraries above, since an
  external consumer can't be found and fixed the way an internal one can.

Not required for: bug fixes that restore documented behavior, dependency bumps, test-only changes,
refactors that keep the public surface identical (though a short doc is welcome for large ones —
`packages/simply-cicd/REFACTOR-PLAN.md` is that kind of document).

## Index

> **Repo rename (2026-09-11):** this repository was renamed from `simply-node` to
> `simply-plugins-core`. Links everywhere were repointed, but the prose in these design docs
> deliberately keeps the old name, because that is what the repo was called when each doc was
> written. Read every `simply-node` mention below, and in the docs themselves, as this repo.

Docs 0001-0005, 0007, 0008, and 0021 were removed here when their packages moved to
[`simply-plugins`](https://github.com/SimplySF/simply-plugins) (see 0026) — they're plugin-only,
with no `simply-core`/`-core` library involvement, so they now live only in that repo's
`docs/design/`. Everything below either concerns a library that stayed here, or is one of the four
`-core`-extraction stories duplicated into both repos.

| #                                                                    | Title                                                                                 | Status      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| [0006](0006-api-request-budget.md)                                   | API request budget check                                                              | Implemented |
| [0009](0009-aep-library-consumption.md)                              | Splitting `simply-aep-core` out of `simply-aep`                                       | Implemented |
| [0010](0010-at4dx-domain-process-binding-validate.md)                | `simply aep at4dx domain-process-binding validate`                                    | Implemented |
| [0011](0011-domain-process-binding-issue-scoping.md)                 | Scoped domain-process-binding validation                                              | Implemented |
| [0012](0012-at4dx-domain-process-binding-create-set.md)              | `simply aep at4dx domain-process-binding create`/`set`                                | Implemented |
| [0013](0013-flow-and-permission-set-assignment-cleanup.md)           | `simply flow delete`/`version prune`, `simply permissions assignment delete`          | Implemented |
| [0014](0014-domain-process-binding-entity-definition-eligibility.md) | `domain-process-binding validate`: EntityDefinition field-choice checks               | Implemented |
| [0015](0015-at4dx-binding-validate-create-set.md)                    | `simply aep at4dx binding validate`/`create`/`update`                                 | Implemented |
| [0016](0016-at4dx-selector-config-field-set-inclusion.md)            | `simply aep at4dx field-set-inclusion list`/`validate`/`create`/`update`              | Implemented |
| [0017](0017-at4dx-binding-unit-of-work-write-support.md)             | `binding validate`/`create`/`update` for UnitOfWork bindings                          | Implemented |
| [0018](0018-domain-process-binding-set-rename-to-update.md)          | Rename `domain-process-binding set` to `update`                                       | Implemented |
| [0019](0019-plugin-core-library-extraction.md)                       | Extracting `-core` library packages from the other `simply-*` plugins                 | Implemented |
| [0020](0020-simply-document-core.md)                                 | Splitting `simply-document-core` out of `simply-document`                             | Implemented |
| [0022](0022-at4dx-update-xml-shape-preservation.md)                  | AT4DX `update` commands preserve existing `.md-meta.xml` shape                        | Implemented |
| [0023](0023-simply-apex-core.md)                                     | Splitting `simply-apex-core` out of `simply-apex`                                     | Implemented |
| [0024](0024-apex-test-suite-generate.md)                             | `simply apex test-suite generate`                                                     | Implemented |
| [0025](0025-at4dx-platform-event-subscription-support.md)            | AT4DX Platform Event Subscription support                                             | Draft       |
| [0026](0026-split-simply-node-simply-plugins-repos.md)               | Splitting `simply-node` into `simply-node` + `simply-plugins` repos                   | Implemented |
| [0027](0027-core-extraction-round-1-post-split.md)                   | Continuing `-core` extraction under the two-repo split (round 1, excl. `simply-cicd`) | Implemented |
| [0028](0028-simply-permissions-core.md)                              | Splitting `simply-permissions-core` out of `simply-permissions`                       | Implemented |
| [0029](0029-simply-sobject-core.md)                                  | Splitting `simply-sobject-core` out of `simply-sobject`                               | Implemented |
| [0030](0030-simply-community-core.md)                                | Splitting `simply-community-core` out of `simply-community`                           | Implemented |
| [0031](0031-simply-data-core.md)                                     | Splitting `simply-data-core` out of `simply-data`                                     | Implemented |
| [0032](0032-simply-package-core.md)                                  | Splitting `simply-package-core` out of `simply-package`                               | Implemented |
| [0033](0033-simply-schema-core.md)                                   | Splitting `simply-schema-core` out of `simply-schema`                                 | Implemented |
| [0034](0034-content-note-upload.md)                                  | Content Note bulk upload (`simply-core` + `simply-data-core`)                         | Implemented |
| [0035](0035-simply-project-setup-core.md)                            | `@simplysf/simply-project-setup-core`                                                 | Draft       |
| [0036](0036-at4dx-domain-binding-trigger-validate.md)                | `simply-aep-core`: `missing-domain-trigger` binding validation rule                   | Implemented |
| [0037](0037-simply-cicd-core.md)                                     | Splitting `simply-cicd-core` out of `simply-cicd`                                     | Draft       |
| [0038](0038-simply-project-setup-core-file-write-strategies.md)      | `simply-project-setup-core`: `jsonMergeFiles`/`regexCustomizations` file strategies   | Draft       |
| [0039](0039-package-dependencies-install-service.md)                 | `simply-package-core`: `installPackageDependencies` service (used by `simply-cicd`)   | Implemented |
| [0040](0040-community-publish-request-timeouts.md)                   | Bounded per-attempt timeouts for community publish network calls                      | Draft       |

## Template

```markdown
# NNNN — Title

**Status:** Draft | Planned | Implemented (PR #N) | Superseded by NNNN
**Package:** the `packages/*` this lands in
**Date:** YYYY-MM-DD

## Problem

What the user can't do today, and why that hurts.

## Decision

The one-paragraph answer: what we're building and where it lives.

## Behavior

The user-visible contract — command name, flags, resolution rules, output, errors. Tables beat
prose for lookup rules.

## Alternatives considered

Each option we rejected and the specific reason. This section is the one future readers come back
for.

## Implementation plan

Files added/changed, in the order they'd be written.

## Testing

Unit and NUT coverage, and what each case pins down.

## Open questions

Anything deliberately left undecided, and who decides it.
```
