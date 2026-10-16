---
title: Get Started
description: Requirements and installation for the Simply Plugins Core libraries.
---

## Requirements

- Node.js `^22.13.0`, `^24.0.0`, or `^26.0.0`
- Most functions take an authenticated `@salesforce/core` `Connection` — this library doesn't handle
  org auth for you (except `simply-core`'s `authenticateClientCredentials`, which builds one from a
  Connected App's client-credentials flow). If you already have an `sf`-authenticated org, resolve a
  `Connection` from it with `@salesforce/core`'s `AuthInfo`/`Org` APIs.

## Install

Each package is independent and published separately — install only what you need:

```sh
npm install @simplysf/simply-core
npm install @simplysf/simply-report
npm install @simplysf/simply-aep-core
npm install @simplysf/simply-document-core
npm install @simplysf/simply-apex-core
npm install @simplysf/simply-permissions-core
npm install @simplysf/simply-sobject-core
npm install @simplysf/simply-community-core
npm install @simplysf/simply-data-core
npm install @simplysf/simply-package-core
npm install @simplysf/simply-schema-core
npm install @simplysf/simply-project-setup-core
npm install @simplysf/simply-cicd-core
npm install @simplysf/simply-settings-core
npm install @simplysf/simply-flow-core
```

| Package                     | What it's for                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simply-core`               | Querying, bulk export, CSV, and `sfdx-project.json` utilities                                                                                      |
| `simply-report`             | Shared HTML report scaffolding                                                                                                                     |
| `simply-aep-core`           | Apex Enterprise Patterns (fflib, force-di, AT4DX) binding scan and resolution logic                                                                |
| `simply-document-core`      | Confluence-storage-format change report and technical design document rendering                                                                    |
| `simply-apex-core`          | Apex execute, log-purge, and trace-flag logic                                                                                                      |
| `simply-permissions-core`   | Permission set XML and permissions report rendering                                                                                                |
| `simply-sobject-core`       | Field history object derivation/filtering and relationship-field discovery                                                                         |
| `simply-community-core`     | Community publish/deploy/domain-verification logic and site-file discovery                                                                         |
| `simply-data-core`          | Content Version upload/download and CSV row counting logic                                                                                         |
| `simply-package-core`       | Package/package-version alias resolution, `sfdx-project.json` dependency management, and Dev Hub version lookup                                    |
| `simply-schema-core`        | sObject schema generation (CSV/Excel parsing, field/object normalization) and interactive schema-report rendering                                  |
| `simply-project-setup-core` | Salesforce DX project file/dependency standardization engine (template packs, `.gitignore` composition, `package.json` scripts/dependency merging) |
| `simply-cicd-core`          | ALM issue linking (Jira, GitLab Issues) and VCS API clients (GitHub, GitLab)                                                                       |
| `simply-settings-core`      | State and Country/Territory picklist automation: create states through Setup and activate them via AddressSettings                                 |
| `simply-flow-core`          | Flow deactivation/deletion and obsolete Flow version pruning                                                                                       |

## Next steps

Each package has its own guide with real usage examples, and a full API reference generated from its
TypeScript source:

- [simply-core guide](/guides/simply-core/) · [API](/api/simply-core/readme/)
- [simply-report guide](/guides/simply-report/) · [API](/api/simply-report/readme/)
- [simply-aep-core guide](/guides/simply-aep-core/) · [API](/api/simply-aep-core/readme/)
- [simply-document-core guide](/guides/simply-document-core/) · [API](/api/simply-document-core/readme/)
- [simply-apex-core guide](/guides/simply-apex-core/) · [API](/api/simply-apex-core/readme/)
- [simply-permissions-core guide](/guides/simply-permissions-core/) · [API](/api/simply-permissions-core/readme/)
- [simply-sobject-core guide](/guides/simply-sobject-core/) · [API](/api/simply-sobject-core/readme/)
- [simply-community-core guide](/guides/simply-community-core/) · [API](/api/simply-community-core/readme/)
- [simply-data-core guide](/guides/simply-data-core/) · [API](/api/simply-data-core/readme/)
- [simply-package-core guide](/guides/simply-package-core/) · [API](/api/simply-package-core/readme/)
- [simply-schema-core guide](/guides/simply-schema-core/) · [API](/api/simply-schema-core/readme/)
- [simply-project-setup-core guide](/guides/simply-project-setup-core/) · [API](/api/simply-project-setup-core/readme/)
- [simply-cicd-core guide](/guides/simply-cicd-core/) · [API](/api/simply-cicd-core/readme/)
- [simply-settings-core guide](/guides/simply-settings-core/) · [API](/api/simply-settings-core/readme/)
- [simply-flow-core guide](/guides/simply-flow-core/) · [API](/api/simply-flow-core/readme/)
