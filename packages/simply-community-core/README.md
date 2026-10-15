# @simplysf/simply-community-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-community-core?label=@simplysf/simply-community-core)](https://npmjs.com/@simplysf/simply-community-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-community-core.svg)](https://npmjs.com/@simplysf/simply-community-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Community publish/deploy/domain-verification logic and site-file discovery. This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-community`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-community)'s publish/URL commands, published separately so it can be imported directly by anything that wants the same logic (an editor extension, a CI job, a script) without pulling in the CLI framework.

## Install

```bash
npm install @simplysf/simply-community-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                                                                                                                                                                                           | Description                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `publishCommunity(options)`                                                                                                                                                                                                      | Triggers a community publish via the Connect REST API and polls until it completes. `options.onPollError` reports failed status checks. |
| `checkPublishStatus(connection, jobId, requestTimeout?, onPollError?)`                                                                                                                                                           | Builds the `PollingClient`-compatible poll function `publishCommunity` uses.                                                            |
| `queryNetworkByName(connection, name, requestTimeout?)`                                                                                                                                                                          | Looks up a `Network` (Experience Cloud site) by name; throws the same errors as `singleRecordQuery`.                                    |
| `DEFAULT_PUBLISH_REQUEST_TIMEOUT`                                                                                                                                                                                                | Bounds each Salesforce API call above (30s). A stalled request is cancelled, not abandoned.                                             |
| `deployChangedFiles(options)`                                                                                                                                                                                                    | Deploys a specific file list and polls until the deploy reaches a terminal state.                                                       |
| `retrieveCustomSite(connection, site, outputDirectory)`                                                                                                                                                                          | Retrieves a single `CustomSite` component by name.                                                                                      |
| `resolveSearchRoots(directory?, projectDir?)`                                                                                                                                                                                    | Resolves the root directories a site/network lookup should search under.                                                                |
| `resolveRetrieveDestination(directory?, projectDir?)`                                                                                                                                                                            | Resolves the single directory a retrieve should write into.                                                                             |
| `resolveSiteFile(site, roots)`                                                                                                                                                                                                   | Finds the `sites/<site>.site-meta.xml` file for a CustomSite API name.                                                                  |
| `resolveNetworkFile(site, roots)`                                                                                                                                                                                                | Finds the `networks/*.network-meta.xml` file whose `<site>` element names a CustomSite.                                                 |
| `patchCustomSiteXml(xml, options)`                                                                                                                                                                                               | Pure function: replaces a `CustomSite` metadata document's custom URLs with exactly one.                                                |
| `patchNetworkXml(xml, pathPrefix)`                                                                                                                                                                                               | Pure function: patches a `Network` metadata document's `urlPathPrefix`.                                                                 |
| `readNetworkSiteName(xml)`                                                                                                                                                                                                       | Pure function: reads a `Network` metadata document's `<site>` element.                                                                  |
| `verifyDomain(connection, domain)`                                                                                                                                                                                               | Checks whether a custom domain is registered in the target org, and what it's already bound to.                                         |
| `PublishCommunityOptions`, `NetworkRecord`, `DeployChangedFilesOptions`, `DeployChangedFilesResult`, `DeployComponentFailure`, `PatchCustomSiteXmlOptions`, `PatchCustomSiteXmlResult`, `DomainCheckStatus`, `DomainCheckResult` | Option and result types for `publishCommunity`, `queryNetworkByName`, `deployChangedFiles`, `patchCustomSiteXml`, and `verifyDomain`.   |

```ts
import { publishCommunity } from '@simplysf/simply-community-core';

const result = await publishCommunity({ connection, networkId: '0DM000000000001', wait: 10 });
```

```ts
import { resolveSearchRoots, resolveSiteFile } from '@simplysf/simply-community-core';

const roots = await resolveSearchRoots(undefined, process.cwd());
const siteFile = await resolveSiteFile('MySite', roots);
```

```ts
import { patchCustomSiteXml } from '@simplysf/simply-community-core';

const currentXml = await fs.readFile(siteFile, 'utf-8');
const { xml, previousDomains } = patchCustomSiteXml(currentXml, { domain: 'my.example.com', primary: true });
```

```ts
import { verifyDomain } from '@simplysf/simply-community-core';

const check = await verifyDomain(connection, 'my.example.com');
```

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
