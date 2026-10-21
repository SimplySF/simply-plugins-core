---
title: simply-permissions-core
description: Usage examples for @simplysf/simply-permissions-core.
---

Permission set generation, permission set XML, and permissions report rendering. Full signatures
and types are in the [API reference](/api/simply-permissions-core/readme/).

```sh
npm install @simplysf/simply-permissions-core
```

## Rendering a PermissionSet metadata document

```ts
import { buildPermissionSetXml, type PermissionSetTemplateData } from '@simplysf/simply-permissions-core';

const data: PermissionSetTemplateData = {
  label: 'My Permission Set',
  hasActivationRequired: false,
  objectPermissions: [
    {
      object: 'Account',
      allowCreate: true,
      allowDelete: false,
      allowEdit: true,
      allowRead: true,
      modifyAllRecords: false,
      viewAllRecords: true,
      viewAllFields: false,
    },
  ],
  fieldPermissions: [],
  tabSettings: [],
  recordTypeVisibilities: [],
  userPermissions: [],
};

const xml = buildPermissionSetXml(data);
// write xml to a `.permissionset-meta.xml` file
```

## Generating permission sets from source

Every permission set a project generates can be declared in one file (the format
`simply permissions build --file` reads) and built in one call. By convention the file is named
`*.psbuild.json`, which is how `sf simply cicd build check-permission-sets` finds it. The library
itself accepts any filename.

```ts
import { generatePermissionSets, loadPermissionSetsFile } from '@simplysf/simply-permissions-core';

// Validate the whole file (and any override files it references) before writing anything...
const specs = await loadPermissionSetsFile('config/app.psbuild.json');
// ...then scan each source directory once and write every permission set.
const results = await generatePermissionSets(specs);
// [{ name, path, objectPermissionCount, fieldPermissionCount }, ...]
```

To check in CI that the committed permission sets still match their source metadata, check the
same specs instead of generating them. Nothing is written, and formatting differences (indentation,
line endings, comments) don't count as drift:

```ts
import { checkPermissionSets, loadPermissionSetsFile } from '@simplysf/simply-permissions-core';

const results = await checkPermissionSets(await loadPermissionSetsFile('config/app.psbuild.json'));
// [{ name, path, objectPermissionCount, fieldPermissionCount, status: 'up-to-date' | 'drifted' | 'missing' }, ...]
if (results.some((result) => result.status !== 'up-to-date')) {
  process.exitCode = 1;
}
```

```ts
import { compilePermissionSet, scanPermissionSetSource, writePermissionSet } from '@simplysf/simply-permissions-core';

const scan = await scanPermissionSetSource('force-app');
const data = compilePermissionSet(scan, { type: 'read-only', name: 'App_Read_Only', includeRecordTypes: false });
await writePermissionSet(data, 'App_Read_Only', 'force-app/main/default/permissionsets');
```

## Rendering a permissions report

```ts
import { buildPermissionsReportHtml } from '@simplysf/simply-permissions-core';

const html = buildPermissionsReportHtml({
  username: 'user@example.com',
  reportDate: new Date().toISOString(),
  groupedData: new Map([['', { permissionSets: [], permissionSetGroups: [] }]]),
});
// write html to a report file
```
