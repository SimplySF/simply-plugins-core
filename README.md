# Simply Plugins Core

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The core Node/TypeScript libraries behind [SimplySF](https://github.com/SimplySF)'s Salesforce CLI plugins, published standalone. Each package is a plain library with no CLI dependency — install it and call its functions directly from a script, an editor extension, a CI job, or any other Node codebase.

## Packages

This repository is a monorepo. Fourteen packages are published independently to npm:

| Package                                                                     | What it's for                                                                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@simplysf/simply-core`](packages/simply-core)                             | Querying, bulk export, CSV, and `sfdx-project.json` utilities                                                                                      |
| [`@simplysf/simply-report`](packages/simply-report)                         | Shared HTML report scaffolding (page shell, base stylesheet, Handlebars environment)                                                               |
| [`@simplysf/simply-aep-core`](packages/simply-aep-core)                     | Apex Enterprise Patterns (fflib, force-di, AT4DX) binding scan and resolution logic                                                                |
| [`@simplysf/simply-document-core`](packages/simply-document-core)           | Confluence-storage-format change report and technical design document rendering, plus Mermaid ERDs                                                 |
| [`@simplysf/simply-apex-core`](packages/simply-apex-core)                   | Apex execute, log-purge, and trace-flag logic                                                                                                      |
| [`@simplysf/simply-permissions-core`](packages/simply-permissions-core)     | Permission set XML and permissions report rendering                                                                                                |
| [`@simplysf/simply-sobject-core`](packages/simply-sobject-core)             | Field history object derivation/filtering and relationship-field discovery                                                                         |
| [`@simplysf/simply-community-core`](packages/simply-community-core)         | Community publish/deploy/domain-verification logic and site-file discovery                                                                         |
| [`@simplysf/simply-data-core`](packages/simply-data-core)                   | Content Version upload/download and CSV row counting logic                                                                                         |
| [`@simplysf/simply-package-core`](packages/simply-package-core)             | Package/package-version alias resolution, `sfdx-project.json` dependency management, package dependency installation, and Dev Hub version lookup   |
| [`@simplysf/simply-schema-core`](packages/simply-schema-core)               | sObject schema generation (CSV/Excel parsing, field/object normalization) and interactive schema-report rendering                                  |
| [`@simplysf/simply-project-setup-core`](packages/simply-project-setup-core) | Salesforce DX project file/dependency standardization engine (template packs, `.gitignore` composition, `package.json` scripts/dependency merging) |
| [`@simplysf/simply-cicd-core`](packages/simply-cicd-core)                   | CI/CD pipeline stages, ALM issue linking (Jira, GitLab Issues) and VCS API clients (GitHub, GitLab)                                                |
| [`@simplysf/simply-settings-core`](packages/simply-settings-core)           | State and Country/Territory picklist automation: create states through Setup and activate them via AddressSettings                                 |
| [`@simplysf/simply-flow-core`](packages/simply-flow-core)                   | Flow deactivation/deletion and obsolete Flow version pruning                                                                                       |

See each package's README for its full API reference and usage examples, or browse the [documentation site](https://simplysf.github.io/simply-plugins-core/) for API docs and code snippets across all fifteen.

## Installation

Install whichever package(s) you need — they're independent, so there's no need to install all fifteen:

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

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the repo structure, how to set up and build the project, our commit conventions, and how to submit a pull request. Each package also has its own `CONTRIBUTING.md` covering what's specific to it — read the root one first, then that package's. Please also read our [Code of Conduct](CODE_OF_CONDUCT.md).

## Issues

Please report bugs or request features by [opening an issue](https://github.com/SimplySF/simply-plugins-core/issues) in this repository.

## License

Licensed under the [Apache-2.0](LICENSE.txt) license.
