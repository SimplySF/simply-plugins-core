# @simplysf/simply-settings-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-settings-core?label=@simplysf/simply-settings-core)](https://npmjs.com/@simplysf/simply-settings-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-settings-core.svg)](https://npmjs.com/@simplysf/simply-settings-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

State and Country/Territory picklist automation. This package creates states through Setup's
_Configure New State_ form, which no Salesforce API can do. It also activates them by deploying
`AddressSettings`. It is not a Salesforce CLI plugin. It's the library layer behind
[`@simplysf/simply-settings`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-settings)'s
`settings address state` commands, published separately so anything can import the same logic
without pulling in the CLI framework: an editor extension, a CI job, a script.

## Install

```bash
npm install @simplysf/simply-settings-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()`. This package ships ESM only.

## API

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                                                                      | Description                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseStateDefinitions(json)`                                               | Validates a `{ "US-CA": "California" }` object into `StateDefinition[]`, naming the first bad entry.                                                                   |
| `filterStateDefinitions(definitions, countries?)`                           | Narrows definitions to ISO country codes. Fails on a malformed code or a country with no definitions.                                                                  |
| `formatStateKey(definition)`                                                | `US-CA` for a definition.                                                                                                                                              |
| `retrieveAddressSettingsXml(options)` / `deployAddressSettingsXml(options)` | Metadata API retrieve/deploy of the org's `Address` settings, as `Address.settings-meta.xml` text. A failed deploy is reported in the result, not thrown.              |
| `parseAddressSettingsXml(xml)`                                              | The countries and states in a settings file, with ISO codes kept as strings (Andorra's `02` stays `02`).                                                               |
| `planStateCreation(definitions, settings)`                                  | Splits definitions into `pending` (to submit) and `settled` (`exists`, `country-missing`) without any Setup traffic.                                                   |
| `openSetupSession(options)` / `SetupSession`                                | A cookie-carrying session on the org's Setup pages, opened through a single-use frontdoor URL (the mechanism `sf org open` uses).                                      |
| `createState(session, definition, options?)`                                | Submits one state through _Configure New State_ and classifies the result. Retries transport failures, and reports per-state problems as `failed` instead of throwing. |
| `createStates(options)`                                                     | Runs `createState` over many states, `concurrency` at a time (default `DEFAULT_CREATE_CONCURRENCY`, 4).                                                                |
| `parseNewStateForm(html)` / `fillNewStateForm(form, definition)`            | Finds the form by its fields' stable id suffixes, not Visualforce's generated ids, and builds the submission.                                                          |
| `classifyNewStateResponse(response)`                                        | Maps a form POST response to `created`, `exists`, `rejected`, `country-missing`, or `failed`.                                                                          |
| `planStateActivation(xml, definitions)`                                     | Sets `<active>`/`<visible>` on exactly the listed states. Every other state and country is untouched.                                                                  |
| `activateStates(options)`                                                   | Retrieve, `planStateActivation`, then deploy. Supports `dryRun`.                                                                                                       |
| `isLoginPage(response)`, `NEW_STATE_FORM_PATH`, `SetupTransportError`       | Supporting helpers and constants.                                                                                                                                      |

```ts
import {
  createStates,
  openSetupSession,
  parseAddressSettingsXml,
  parseStateDefinitions,
  planStateCreation,
  retrieveAddressSettingsXml,
} from '@simplysf/simply-settings-core';
import { Duration } from '@salesforce/kit';

const definitions = parseStateDefinitions({ 'US-GU': 'Guam', 'AD-02': 'Canillo' });
const settings = parseAddressSettingsXml(await retrieveAddressSettingsXml({ connection, wait: Duration.minutes(10) }));
const { pending, settled } = planStateCreation(definitions, settings);

const session = await openSetupSession({ connection });
const outcomes = await createStates({ session, states: pending, onProgress: (outcome) => console.log(outcome) });
```

```ts
import { activateStates, parseStateDefinitions } from '@simplysf/simply-settings-core';
import { Duration } from '@salesforce/kit';

const result = await activateStates({
  connection,
  wait: Duration.minutes(10),
  states: parseStateDefinitions({ 'US-GU': 'Guam' }),
});
// result.activated / alreadyActive / notInOrg, and result.deploy if a deploy ran
```

Opening a Setup session needs an access token that can reach the UI (the `web` or `full` OAuth
scope), as granted by `sf org login web`. Without one, `openSetupSession` throws a
`SetupSessionError` before anything is submitted.

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).
