# 0045 — `simply-aep-core`: the AEP generation engine, ported from `apx-core`

**Status:** Implemented ([PR #232](https://github.com/SimplySF/simply-plugins-core/pull/232))
**Package:** `simply-aep-core`
**Date:** 2026-10-15

## Problem

`simply-plugins`' [0045](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0045-migrate-apx-into-simply-aep.md)
moves `apx`'s code generators into `simply aep generate …`. Its phase 1 is this package: the
generation engine has to live somewhere the CLI and, later, `simply-vscode` can both import, and the
CMDT records it writes have to come from the same serializer the `simply aep at4dx … create`
commands already use. Today that engine lives in `@syntax-syllogism/apx-core`, which renders the
binding records from its own Eta templates and knows nothing about the validators here.

## Decision

Port `apx-core@0.3.1`'s generation surface — naming, describe view, path layout, plan builders,
templates, engine, use-case descriptors and option schemas, result renderer — into
`packages/simply-aep-core/src/generate/`, and export it from the package root. Dead-code analysis
(`src/dead/`, `useCases/dead.ts`, `render/dead.ts`) stays in `apx-core`.

Three changes from a straight copy:

1. **CMDT records come from this package's builders.** The six binding templates are deleted;
   the plan builders call `buildBindingXml`, `buildDomainProcessBindingXml`, and
   `buildFieldSetInclusionXml`. Every other template moves unchanged.
2. **Refuse to overwrite by default.** `applyGeneration` defaults to the engine's `error` policy,
   and that policy now reports every existing path, not the first one.
3. **`planValidation`** scans local source, adds the planned records, and returns only the issues
   those records introduce — the check the CLI's `--force` gates on, shared so the editor makes the
   same call.

The files are relicensed to Apache-2.0 under the SimplySF header, by agreement with `apx-core`'s
author; the README credits `apx-core` as the origin.

## Behavior

### Renames

| `apx-core`                                    | `simply-aep-core`                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `ApxError`, `isApxError`, `ApxErrorCode`      | `AepGenerationError`, `isAepGenerationError`, `AepGenerationErrorCode`         |
| `ApxUseCaseContext`                           | `AepUseCaseContext`                                                            |
| `useCases`, `commandDescriptors`              | `generationUseCases`, `generationCommandDescriptors` (dead-code removed)       |
| `generateUnitOfWork` id `generate-unitofwork` | id `generate-unit-of-work`                                                     |
| `generateSelectorMethod` id                   | unchanged (`generate-selector-method`)                                         |
| `generateSelectorFieldInjection`              | `generateFieldSetInclusion`, id `generate-field-set-inclusion`                 |
| descriptor `cliId` `apx:generate:*`           | `simply:aep:generate:*`, using the command names in `simply-plugins`' 0045     |
| `describeError`                               | `describeGenerationError`                                                      |
| `file`, `text`, `boolean`, `enumValue`        | not exported — schema-building helpers, and far too generic for a package root |
| `ReadUseCase`, `UseCase`                      | not exported — only dead-code analysis was a read use case                     |

Error `code` values are unchanged except `test-pairing-invariant`, which nothing in generation
threw. Data shapes that changed:

- `file-exists` carries `data.absolutePaths` (all of them), not `data.absolutePath`.
- `sobject-not-found` carries `data.cause` as `describe-failed` already did, so a caller can surface
  the API error without `apx`'s describe-intercepting proxy.

Behavior that changed, beyond the overwrite default:

- `WriteUseCase.plan` takes the schema's input type (defaults optional), since it parses the options
  itself.
- `renderGenerationResult` prints `Dry-run planned N files.` for every command's dry run, not just
  the aggregate's (`apx` printed "Generated 0 files" for the others).
- The action/criteria and field-set-inclusion review lines no longer name a nil `…Alternate__c`
  field, since which field is nil now depends on the object.

Post-merge fixes:

- Dry runs enforce `error` overwrite preflight. `renderGenerationPlan(preview, policy = 'error')`
  labels existing files `EXISTS (will fail)`, `OVERWRITE`, or `SKIP` according to policy.
- All emitted CMDT DeveloperNames use the shared create/write validation rule. Invalid derived names
  throw `invalid-developer-name`, including the source name, derived name, and broken rule; they are
  never silently renamed. Builders throw before a preview can reach `planValidation`, so that path
  needs no duplicate DeveloperName check.
- Binding sequences accept only finite, non-negative plain decimals, using `ORDER_PATTERN`.
- Cancellation stops between files. An abort after the final file returns the completed manifest.
  Writes are not atomic or rolled back; `write-failed` includes `data.created` just as cancellation does.
- Option schemas reject unsafe SObject/class/service identifiers. The engine resolves every target
  and rejects absolute or escaping paths with `invalid-path` before writing any artifact.

Inherited Apex naming quirks (underscore removal and non-anchored `__c` stripping) are deliberately
unchanged for reference parity. Everything else keeps its `apx-core` name, signature, and behavior.

### Intentional CMDT differences

Every non-CMDT artifact must render byte-for-byte as `apx-core@0.3.1` renders it. The CMDT records
differ, deliberately:

| Difference                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout: two-space indent, one line per `<values>`, this package's field order | The shared serializer's layout; what `create` writes today.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SObject field chosen by EntityDefinition eligibility, not `isCustom`          | `apx` put custom objects in `…Alternate__c` and standard ones in the primary field, and always used the primary field for domain-process and field-set-inclusion records. `validate*` flags both: a `Property__c` binding in the alternate field is `unnecessary-entity-definition-alternate`, and a `User` binding in the primary field is `unsupported-entity-definition-object` (an error). Primary when eligible ([0014](0014-domain-process-binding-entity-definition-eligibility.md)), alternate otherwise. |
| Selector and Service bindings carry `Priority__c` as `xsi:nil`                | `buildBindingXml` always writes the field the type has.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Doubles written as numbers: `BindingSequence__c` `1000`, not `1000.0`         | The builders take the record's `number` fields. The value is the same double; a re-scan reads the same number.                                                                                                                                                                                                                                                                                                                                                                                                    |

The values otherwise match: labels, `To__c`, `BindingInterface__c`, `BindingSequence__c`, every
domain-process-binding field and default, `FieldsetName__c`, `IsActive__c`.

### `planValidation(preview, sourceDirs)`

```ts
planValidation(preview: GenerationPreview, sourceDirs: string[]): GenerationIssue[]
```

- Picks the planned CMDT artifacts out of `preview` (Application Factory bindings,
  `DomainProcessBinding`, `SelectorConfig_FieldSetInclusion`). None: returns `[]` without scanning.
- Scans the existing directories among `sourceDirs` for each record type present.
- Writes the planned records to a temporary directory and scans them back with the same scanner, so
  the records validated are exactly what a later `validate` would read. Each one is labelled
  `source: 'planned'` and given its planned `absolutePath`.
- Drops scanned records whose file a planned artifact replaces (`--overwrite`).
- Runs the matching validator with and without the planned records, and returns the issues that are
  only in the second run. An issue whose message changes because a planned record joined it counts
  as introduced — the planned record is part of it.
- `missing-domain-trigger` isn't checked: it needs a trigger scan, and the domain generator writes the
  trigger itself.

`GenerationIssue` is a union of the three issue types, tagged with
`record: 'binding' | 'domain-process-binding' | 'field-set-inclusion'`.

## Alternatives considered

- **Keep the Eta binding templates, fix them up to match.** Two serializers for one record type is
  the drift `simply-plugins`' 0045 exists to stop.
- **Construct the planned records in memory instead of scanning them back.** Saves a temp directory.
  Rejected: scanning the rendered XML is what proves the records round-trip, and it reuses the
  scanners' own normalization instead of a second copy of it.
- **Count every error, as `createBinding` does.** A generator for one SObject would fail on an
  unrelated pre-existing problem elsewhere in the project. `validate` reports those
  ([0011](0011-domain-process-binding-issue-scoping.md)).
- **A separate `simply-aep-generate-core`.** Covered in `simply-plugins`' 0045: generation imports the
  builders and validators from here anyway, so the two would always release together.

## Implementation plan

1. `src/generate/`: `errors`, `model/`, `naming/`, `describe`, `support`, `paths`, `engine`,
   `templates/` (minus the six binding templates), `planBuilders`, `options`, `useCase`, `useCases`,
   `generation`, `render/`, `planValidation`.
2. Dependencies: `eta`, `pluralize`, `zod`.
3. Exports in `src/index.ts`, and the exported-key test.
4. Tests (vitest): the ported `apx-core` aep and use-case suites; a reference snapshot of every
   artifact `apx-core@0.3.1` renders for 41 input cases, matched byte-for-byte except CMDT; a
   round-trip and value check for every CMDT record; `planValidation`.
5. README `## API` section and `site/src/content/docs/guides/simply-aep-core.md`.

## Testing

| Suite                     | Pins down                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `generate/reference.test` | every non-CMDT artifact equals `apx-core@0.3.1` output; every CMDT artifact scans back with the same values |
| `generate/cmdt.test`      | each generated record re-scans with no `malformed`/`ambiguous`, and validates clean in isolation            |
| `generate/planValidation` | introduced vs. pre-existing issues; overwrite replacement; no CMDT → no scan; missing source dirs           |
| `generate/engine`         | `error` policy lists every existing path and writes nothing; `skip`/`overwrite`; cancellation               |
| `generate/reviewFixes`    | CMDT DeveloperName rule and typed error; binding-sequence and identifier schemas; plan labels               |
| ported `apx-core` suites  | naming, paths, describe, support, plan builders, templates, use cases                                       |

## Open questions

- None blocking. `simply-plugins`' 0045 keeps the layout question (configurable `AepLayout`) open.
