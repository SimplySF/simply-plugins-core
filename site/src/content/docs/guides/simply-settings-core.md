---
title: simply-settings-core
description: Usage examples for @simplysf/simply-settings-core.
---

State and Country/Territory picklist automation: creating states through Setup and activating them
via AddressSettings. Full signatures and types are in the
[API reference](/api/simply-settings-core/readme/).

```sh
npm install @simplysf/simply-settings-core
```

Every example below assumes you already have an authenticated `@salesforce/core` `Connection`, as
described in [Get Started](/getting-started/). Opening a Setup session also needs that connection's token to
carry the `web` or `full` OAuth scope, which `sf org login web` grants.

## Describing the states you want

States are given as a JSON object mapping ISO 3166-2 codes to names:

```ts
import { filterStateDefinitions, parseStateDefinitions } from '@simplysf/simply-settings-core';

const all = parseStateDefinitions(JSON.parse(await readFile('states.json', 'utf8')));
const justTheUs = filterStateDefinitions(all, ['US']);
```

Or download them at run time from an ISO 3166-2 source. `debian` (Debian's
[`iso-codes`](https://salsa.debian.org/iso-codes-team/iso-codes)) is the only source today. Nothing
is cached or written to disk:

```ts
import { fetchIsoCodesStateDefinitions, filterStateDefinitions } from '@simplysf/simply-settings-core';

// version defaults to the latest release tag; allLevels adds nested subdivisions (e.g. French departments)
const { version, definitions } = await fetchIsoCodesStateDefinitions({ source: 'debian', version: 'v4.20.1' });
const france = filterStateDefinitions(definitions, ['FR']);
```

## Creating missing states

Salesforce has no API for creating states, so `createStates` submits Setup's _Configure New State_
form, one state at a time, several in parallel. Plan against the org's current settings first. That
way states that already exist, and countries the org doesn't have, cost no Setup traffic.

```ts
import { Duration } from '@salesforce/kit';
import {
  createStates,
  openSetupSession,
  parseAddressSettingsXml,
  planStateCreation,
  retrieveAddressSettingsXml,
} from '@simplysf/simply-settings-core';

const xml = await retrieveAddressSettingsXml({ connection, wait: Duration.minutes(10) });
const { pending, settled } = planStateCreation(justTheUs, parseAddressSettingsXml(xml));

const session = await openSetupSession({ connection });
const outcomes = await createStates({ session, states: pending, concurrency: 4 });
// each outcome: { country, code, name, status: 'created' | 'exists' | 'rejected' | ..., message? }
```

New states are created inactive and hidden.

## Activating states

```ts
import { Duration } from '@salesforce/kit';
import { activateStates } from '@simplysf/simply-settings-core';

const result = await activateStates({ connection, wait: Duration.minutes(10), states: justTheUs });
if (result.deploy && !result.deploy.success) {
  console.error(result.deploy.failures);
}
```

Only the listed states are touched. A state an admin hid on purpose stays hidden unless it's in the
list. Pass `dryRun: true` to get the same `activated`/`alreadyActive`/`notInOrg` breakdown without
deploying.
