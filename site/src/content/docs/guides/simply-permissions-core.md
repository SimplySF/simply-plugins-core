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

Each permission set a project generates is defined by its own permission set build file: a JSON
object with the same settings as one `sf simply permissions build` run with the single-permission-set
flags. The file is named `*.psbuild.json`, which is how `findPermissionSetBuildFiles()` finds it (and
so how `sf simply cicd build check-permission-sets` and a flagless `sf simply permissions build` do).
`loadPermissionSetBuildFile` itself accepts any filename. The suffix is exported as
`PERMISSION_SET_BUILD_FILE_SUFFIX`.

```json
{
  "name": "App_Admin",
  "type": "modify-all",
  "label": "App Admin",
  "directory": "force-app",
  "output": "force-app/main/default/permissionsets",
  "includeRecordTypes": true,
  "config": "config/app-admin-overrides.json"
}
```

`name`, `type`, `directory`, and `output` are required. `config` is a path to an overrides file or
the same overrides inline. Relative paths resolve against the current directory.

```ts
import { generatePermissionSets, loadPermissionSetBuildFile } from '@simplysf/simply-permissions-core';

// Validate the file (and any overrides file it references) before writing anything...
const spec = await loadPermissionSetBuildFile('config/app-admin.psbuild.json');
// ...then scan the source directory and write the permission set.
const [result] = await generatePermissionSets([spec]);
// { name, path, objectPermissionCount, fieldPermissionCount }
```

To build every permission set in the project, find the files first. The search starts at the
current directory and skips `node_modules`, `.git`, `.sf`, and `.sfdx`. Load every file before
building any, and check that no two declare the same name; otherwise the later one would silently
overwrite the earlier one's output:

```ts
import {
  assertUniquePermissionSetNames,
  findPermissionSetBuildFiles,
  generatePermissionSets,
  loadPermissionSetBuildFile,
} from '@simplysf/simply-permissions-core';

const files = await findPermissionSetBuildFiles(); // ['apps/sales/sales-admin.psbuild.json', 'config/app-admin.psbuild.json']
const entries = await Promise.all(files.map(async (file) => ({ file, spec: await loadPermissionSetBuildFile(file) })));
assertUniquePermissionSetNames(entries);
await generatePermissionSets(entries.map(({ spec }) => spec));
```

To check in CI that the committed permission sets still match their source metadata, check the
same specs instead of generating them. Nothing is written, and formatting differences (indentation,
line endings, comments) don't count as drift:

```ts
import { checkPermissionSets, loadPermissionSetBuildFile } from '@simplysf/simply-permissions-core';

const results = await checkPermissionSets([await loadPermissionSetBuildFile('config/app-admin.psbuild.json')]);
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
