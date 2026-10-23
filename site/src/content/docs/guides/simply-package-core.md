---
title: simply-package-core
description: Usage examples for @simplysf/simply-package-core.
---

Package/package-version alias resolution, `sfdx-project.json` dependency management, package
dependency installation, and Dev Hub version lookup logic. Full signatures and types are in the
[API reference](/api/simply-package-core/readme/).

```sh
npm install @simplysf/simply-package-core
```

Every example below assumes you already have an authenticated `@salesforce/core` `Connection`/
`SfProject` — see [Get Started](/getting-started/).

## Finding where a package is declared

```ts
import { findPackageVersions, splitPackageAlias } from '@simplysf/simply-package-core';

const project = await sfProject.retrieveSfProjectJson();
const matches = findPackageVersions(project.getContents(), 'MyPackage');
```

## Building a Dev Hub version-lookup service

```ts
import { buildVersionService } from '@simplysf/simply-package-core';

const versionService = await buildVersionService(connection, sfProject);
const alias = versionService.getVersionAlias('04t000000000001AAA');
```

## Reading and updating package dependencies

```ts
import { buildProjectService } from '@simplysf/simply-package-core';

const projectService = await buildProjectService(sfProject);
const dependenciesByDirectory = projectService.getDependenciesByDirectory();
```

## Installing a project's package dependencies

The engine behind `sf simply package dependencies install`, without the CLI. Dependencies are
resolved from `sfdx-project.json` (aliases, or a Dev Hub for `package` + `versionNumber` pairs),
compared against what the org already has, and installed one at a time.

```ts
import { Duration } from '@salesforce/kit';
import { installPackageDependencies } from '@simplysf/simply-package-core';

const results = await installPackageDependencies({
  project: sfProject,
  targetOrgConnection: connection,
  // Only invoked if a dependency is declared as package + versionNumber.
  targetDevHubConnection: async () => devHubOrg.getConnection(),
  installType: 'Upgrade', // or 'All' | 'Delta'
  installationKeys: { MyProtectedPackage: 'key' }, // alias or 04t id → key
  wait: Duration.minutes(120),
  retryAttempts: 2,
  progress: { info: console.log, warn: console.warn, stepStart: console.log },
  // Omit `prompts` to auto-approve the Delete-upgrade and external-sites confirmations.
});

for (const result of results) {
  console.log(`${result.PackageName}: ${result.Status}`);
}
```

## Cloning the source of a project's package dependencies

The engine behind `sf simply package dependencies clone`. It needs no org: it reads each
package's `repository` from `plugins.simply.packages` in `sfdx-project.json` and runs your own `git`, so
any host works and your existing SSH keys or credential helper supply access.

```json
{
  "plugins": {
    "simply": {
      "packages": {
        "fflib-apex-common": {
          "repository": {
            "url": "https://github.com/apex-enterprise-patterns/fflib-apex-common.git",
            "ref": "v3.0.0"
          }
        },
        "my-core": {
          "repository": { "url": "git@gitlab.example.internal:salesforce/my-core.git", "ref": "main" }
        }
      }
    }
  }
}
```

A key matches a dependency's `package` value exactly, or up to its first `@`, so `fflib-apex-common`
keeps matching as `dependencies manage` moves the dependency from one version alias to the next.

```ts
import { clonePackageDependencies } from '@simplysf/simply-package-core';

const rows = await clonePackageDependencies({
  projectDir: process.cwd(),
  // outputDir: '..', // the default: one sibling folder per repository
  recursive: true, // also clone dependencies of dependencies
  depth: 1, // shallow clones for review
  progress: { warn: console.warn, stepStart: console.log },
});

for (const row of rows) {
  console.log(`${row.package}: ${row.status}${row.directory ? ` → ${row.directory}` : ''}`);
}
```
