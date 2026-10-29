# @simplysf/simply-document-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-document-core?label=@simplysf/simply-document-core)](https://npmjs.com/@simplysf/simply-document-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-document-core.svg)](https://npmjs.com/@simplysf/simply-document-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Confluence-storage-format change report and technical design document rendering. This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-document`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-document)'s `sf simply document diff`/`generate` commands, published separately so it can be imported directly by anything that wants the same rendering (an editor extension, a CI job, a script) without pulling in the CLI framework.

Unlike the other internal libraries in this monorepo (`@simplysf/simply-core`, `@simplysf/simply-plugin-kit`, `@simplysf/simply-report`), this package is meant to be depended on by projects outside this repo, not only by other `simply-*` packages.

## Install

```bash
npm install @simplysf/simply-document-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildChangeReportHtml(changes, customTemplateSource?)`         | Pure function: renders a Confluence-storage-format change report grouping a set of changed components by component type, for pasting into a release/change-management page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `buildTechnicalDesignDocumentHtml(data, customTemplateSource?)` | Pure function: renders a full Confluence-storage-format technical design document from a Salesforce project's scanned metadata — objects/data model, security model, groups/queues/permissions, solution inventory, and custom code inventory.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ChangeEntry`, `ChangesByComponentType`                         | Types for `buildChangeReportHtml`'s input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `TechnicalDesignDocumentData`                                   | The full data model `buildTechnicalDesignDocumentHtml` renders, plus its 28 supporting item types: `ApexClassItem`, `ApexTriggerItem`, `ApprovalProcessItem`, `AuraComponentItem`, `CustomApplicationItem`, `CustomFieldItem`, `CustomLabelItem`, `CustomMetadataItem`, `DashboardItem`, `DigitalExperienceBundleItem`, `EmailTemplateItem`, `ExperienceBundleItem`, `FieldSetItem`, `FlexipageItem`, `FlowItem`, `GroupItem`, `LayoutItem`, `LightningComponentItem`, `ObjectItem`, `PermissionSetGroupItem`, `PermissionSetItem`, `QueueItem`, `RecordTypeItem`, `ReportItem`, `SharingRuleItem`, `StaticResourceItem`, `ValidationRuleItem`, `VisualforcePageItem`. |

| ERD export                                                                                                   | Description                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `buildEntityRelationshipModel(objects)`                                                                      | Builds sorted entities, relationship edges, and `skippedFields` from `ObjectItem[]`.             |
| `splitEntityRelationshipModel(model, options?)`                                                              | Returns `{ diagrams, unrelatedObjects }`, splitting connected clusters above the size threshold. |
| `renderMermaidErDiagram(diagram)`                                                                            | Renders sorted Mermaid `erDiagram` source without a code fence or trailing newline.              |
| `buildEntityRelationshipDiagramMarkdown(objects, options?)`                                                  | Returns `{ markdown, model, diagrams, unrelatedObjects }`, ready to save as Markdown.            |
| `EntityRelationshipModel`, `ErdEntity`, `ErdRelationship`, `ErdRelationshipKind`, `ErdDiagram`, `ErdOptions` | Types for graph construction, splitting, and rendering.                                          |

The two HTML rendering functions accept an optional second `customTemplateSource` argument: a caller-supplied Handlebars template string, compiled against the same `Handlebars` instance as the built-in template (so it can use the same partials/helpers — `changeTable` for the change report, `loud` for the technical design document).

```ts
import { buildChangeReportHtml, type ChangesByComponentType } from '@simplysf/simply-document-core';

const changes: ChangesByComponentType = {
  apexClasses: [
    {
      componentName: 'AccountService',
      componentType: 'ApexClass',
      changeType: 'Added',
      changeDescription: 'New service class',
      path: 'force-app/main/default/classes/AccountService.cls',
    },
  ],
};

const html = buildChangeReportHtml(changes);
// paste the result into a Confluence page's storage-format editor
```

```ts
import { buildTechnicalDesignDocumentHtml, type TechnicalDesignDocumentData } from '@simplysf/simply-document-core';

const html = buildTechnicalDesignDocumentHtml(scannedProjectData);
```

## Entity relationship diagrams

```ts
import { buildEntityRelationshipDiagramMarkdown, type ObjectItem } from '@simplysf/simply-document-core';

const objects: ObjectItem[] = [
  {
    name: 'Invoice__c',
    customFields: [{ fullName: 'Account__c', fieldType: 'Lookup', referenceTo: 'Account', required: 'true' }],
  },
];
const { markdown, model, diagrams } = buildEntityRelationshipDiagramMarkdown(objects, {
  title: 'Billing',
  maxObjects: 40,
  hubs: ['User'],
});
// Save markdown; paste each Mermaid block into Gliffy via Create from code → Mermaid.
// model.skippedFields reports relationship fields missing referenceTo.
```

Only raw `Lookup`, `MasterDetail`, and `Hierarchy` types become edges; nodes have no field
attributes. `CustomFieldItem.fieldType` preserves the raw metadata type when `type` is a display
string such as `Lookup(Account)`. Raw `type: 'Lookup'` also works. `referenceTo` accepts a string or
an array of target names. Hierarchy fields are self relationships. Standard relationships absent
from DX metadata cannot be inferred.

The default threshold is 40 connected nodes including external objects. Above it, splitting finds
components with at least one non-hub edge, then reattaches hubs (`User` by default). `hubs: []`
disables hub removal. Objects connected only to hubs do not seed a diagram after splitting.
Hub-to-hub edges appear in every diagram already containing either endpoint. Split diagrams are
marked `oversized` when their in-project node count exceeds the threshold; heading counts include
external nodes. Unrelated in-project objects appear in a separate list. All output uses ordinal
sorting for repeatable diffs, with underscores escaped outside Mermaid blocks.

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
