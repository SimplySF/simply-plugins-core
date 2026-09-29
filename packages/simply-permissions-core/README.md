# @simplysf/simply-permissions-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-permissions-core?label=@simplysf/simply-permissions-core)](https://npmjs.com/@simplysf/simply-permissions-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-permissions-core.svg)](https://npmjs.com/@simplysf/simply-permissions-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Permission set generation from source metadata, permission set XML, and permissions report rendering. This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-permissions`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-permissions)'s permission set build/report commands, published separately so it can be imported directly by anything that wants the same rendering (an editor extension, a CI job, a script) without pulling in the CLI framework.

## Install

```bash
npm install @simplysf/simply-permissions-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                                                                                                 | Description                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `buildPermissionSetXml(data)`                                                                                                          | Pure function: renders a complete `PermissionSet` metadata XML document from typed template data.  |
| `buildPermissionsReportHtml(options)`                                                                                                  | Pure function: renders a self-contained HTML report of permission sets/groups, grouped by package. |
| `ObjectPermission`, `FieldPermission`, `TabSetting`, `RecordTypeVisibility`, `UserPermission`, `PermissionSetTemplateData`             | Types for `buildPermissionSetXml`'s input.                                                         |
| `ObjectPermissionEntry`, `FieldPermissionEntry`, `PermissionSetReportEntry`, `PermissionSetGroupReportEntry`, `GroupedPermissionsData` | Types for `buildPermissionsReportHtml`'s input.                                                    |

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

```ts
import { buildPermissionsReportHtml } from '@simplysf/simply-permissions-core';

const html = buildPermissionsReportHtml({
  username: 'user@example.com',
  reportDate: new Date().toISOString(),
  groupedData: new Map([['', { permissionSets: [], permissionSetGroups: [] }]]),
});
// write html to a report file
```

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
| `scanPermissionSetSource(directory)` | Scans a source directory for custom objects, permissionable fields, tabs, and record types. |
| `compilePermissionSet(scan, options)` | Pure function: applies a `type` baseline (`read-only`/`view-all`/`modify-all`) and overrides to a scan, returning `PermissionSetTemplateData`. |
| `writePermissionSet(data, name, output)` | Renders and writes `<output>/<name>.permissionset-meta.xml`. |
| `loadPermissionSetBuildConfig(filePath)` | Loads and validates an overrides file (`PermissionSetBuildConfigSchema`). |
| `loadPermissionSetsFile(filePath)` | Loads and validates a permission sets file (`PermissionSetsFileSchema`) into `PermissionSetSpec[]`: defaults applied, override files loaded, source directories checked. |
| `generatePermissionSets(specs, onPermissionSet?)` | Builds and writes each spec, scanning each distinct source directory once. |
| `PermissionSetBuildError` | Thrown by the above with a structural `code` (`scan-failed`, `invalid-config`, `config-not-found`, `directory-not-found`) and `args`. |
| `PermissionSetBuildConfigSchema`, `PermissionSetsFileSchema` | zod schemas for the overrides file and the permission sets file. |
| `PermissionSetType`, `PermissionSetSourceScan`, `PermissionSetBuildOptions`, `PermissionSetSpec`, `PermissionSetBuildResult`, `PermissionSetBuildErrorCode`, `PermissionSetBuildConfig`, `PermissionSetsFile` | Types for the permission set build functions. |
