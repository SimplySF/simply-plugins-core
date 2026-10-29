---
title: simply-document-core
description: Usage examples for @simplysf/simply-document-core.
---

Confluence-storage-format change report and technical design document rendering, plus Mermaid entity relationship diagrams. Full signatures and
types are in the [API reference](/api/simply-document-core/readme/).

```sh
npm install @simplysf/simply-document-core
```

## Rendering a change report

`buildChangeReportHtml` takes changed components grouped by type and renders the same
Confluence-storage-format HTML table used by `simply document diff`:

```ts
import { buildChangeReportHtml, type ChangesByComponentType } from '@simplysf/simply-document-core';

const changes: ChangesByComponentType = {
  apexClasses: [
    {
      componentName: 'AccountService',
      componentType: 'ApexClass',
      changeType: 'Modified',
      changeDescription: 'Added bulk-safe validation',
      path: 'force-app/main/default/classes/AccountService.cls',
    },
  ],
};

const html = buildChangeReportHtml(changes);
```

## Rendering a technical design document

`buildTechnicalDesignDocumentHtml` takes every metadata-type bucket the template supports (Apex
classes/triggers, flows, objects, permission sets, and dozens more — see the
[API reference](/api/simply-document-core/readme/) for the full `TechnicalDesignDocumentData` shape) and
renders one HTML document:

```ts
import { buildTechnicalDesignDocumentHtml, type TechnicalDesignDocumentData } from '@simplysf/simply-document-core';

const data: TechnicalDesignDocumentData = {
  apexClasses: [{ name: 'AccountService', status: 'Active', apiVersion: '62.0' }],
  apexTriggers: [],
  approvalProcesses: [],
  // ... every other bucket the type requires
};

const html = buildTechnicalDesignDocumentHtml(data);
```

Both functions also accept a custom Handlebars template source as a second argument, if you want to
override the built-in layout entirely:

```ts
const html = buildChangeReportHtml(changes, myCustomTemplateSource);
```

## Entity relationship diagrams

Build Mermaid Markdown directly from scanned objects:

```ts
import { buildEntityRelationshipDiagramMarkdown, type ObjectItem } from '@simplysf/simply-document-core';

const objects: ObjectItem[] = [
  {
    name: 'Invoice__c',
    customFields: [{ fullName: 'Account__c', fieldType: 'Lookup', referenceTo: 'Account', required: 'true' }],
  },
];
const { markdown, model, diagrams, unrelatedObjects } = buildEntityRelationshipDiagramMarkdown(objects, {
  title: 'Billing',
  maxObjects: 40,
  hubs: ['User'],
});
```

Save `markdown` to a file, or paste each Mermaid block into Gliffy using **Create from code → Mermaid**.
The diagram shows objects and Lookup, Master-Detail, and Hierarchy fields without field attributes.
Pass raw metadata in `fieldType` (or `type` if it hasn't been formatted for display) and parents in
`referenceTo`. Missing parents are reported in `model.skippedFields`. Standard relationships absent
from DX source aren't inferred. External parents are listed beside each diagram; unrelated objects
are listed at the end.

Above 40 connected nodes (including external parents), diagrams split by connected components after
removing hub edges, then reattach hubs. Set `hubs: []` to disable hub removal. Each connected
non-hub object outside those components seeds its own diagram with its hub relationships, including
external non-hub objects, so hub-only connections remain visible. Hub-to-hub edges join diagrams
already containing either endpoint. `oversized` counts in-project nodes after splitting, while
Markdown heading counts include external nodes. Use `buildEntityRelationshipModel`,
`splitEntityRelationshipModel`, and `renderMermaidErDiagram` separately for other output workflows.
