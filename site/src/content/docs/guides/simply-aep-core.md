---
title: simply-aep-core
description: Usage examples for @simplysf/simply-aep-core.
---

Apex Enterprise Patterns ([fflib](https://github.com/apex-enterprise-patterns/fflib-apex-common),
[force-di](https://github.com/apex-enterprise-patterns/force-di),
[AT4DX](https://github.com/apex-enterprise-patterns/at4dx)) binding scan, resolution, and code generation. Full
signatures and types are in the [API reference](/api/simply-aep-core/readme/).

```sh
npm install @simplysf/simply-aep-core
```

Every example below assumes an authenticated `@salesforce/core`-style connection where relevant — see
[Get Started](/getting-started/).

## Scanning local `force-app` source for AT4DX bindings

`scanLocalBindings` reads `AT4DXBinding__mdt`/`AT4DXDomainProcessBinding__mdt`-style custom metadata
records out of one or more source directories, without deploying anything:

```ts
import { scanLocalBindings, resolveBindings, ALL_BINDING_TYPES } from '@simplysf/simply-aep-core';

const scan = scanLocalBindings(['force-app'], ALL_BINDING_TYPES);
const bindings = resolveBindings(scan.records);

for (const binding of bindings) {
  console.log(binding.bindingType, binding.key, '->', binding.to, binding.effective ? '(effective)' : '');
}
```

## Validating bindings for problems

`validateBindings` takes a scan result (or raw records + the diagnostics that came with them) and
returns every issue it finds — ambiguous/missing SObject references, sequence collisions, duplicate
`DeveloperName`s, and more:

```ts
import { scanLocalBindings, validateBindings, ALL_BINDING_TYPES } from '@simplysf/simply-aep-core';

const scan = scanLocalBindings(['force-app'], ALL_BINDING_TYPES);
const issues = validateBindings(scan);

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`[${issue.severity}] ${issue.rule}: ${issue.message}`);
  }
  process.exitCode = 1;
}
```

## Scanning an org instead of local source

Same shape, but reads the metadata that's actually deployed to an org:

```ts
import { scanOrgBindings, ALL_BINDING_TYPES } from '@simplysf/simply-aep-core';

const scan = await scanOrgBindings(connection, ALL_BINDING_TYPES);
```

## Building a binding's metadata XML

Useful for anything that wants to generate or update an `AT4DXBinding__mdt` record's `.md-meta.xml`
without shelling out to a CLI:

```ts
import { buildBindingXml } from '@simplysf/simply-aep-core';

const xml = buildBindingXml({
  bindingType: 'Service',
  key: 'MyServiceInterface',
  to: 'MyServiceImpl',
});
```

## Simulating platform event distribution

`PlatformEvents_Subscription__mdt` records route platform events to consumer classes. Given a scan,
`resolvePlatformEventDistribution` answers "which consumers would AT4DX invoke for this event, and why
not the others?" without publishing anything.

```ts
import {
  resolvePlatformEventDistribution,
  scanLocalPlatformEventSubscriptions,
  validatePlatformEventSubscriptions,
} from '@simplysf/simply-aep-core';

const scan = scanLocalPlatformEventSubscriptions(['force-app/main/default']);
const issues = validatePlatformEventSubscriptions(scan);

const { matches, misses } = resolvePlatformEventDistribution(
  { eventBus: 'Order_Event__e', category: 'Fulfillment', eventName: 'OrderShipped' },
  scan.records,
);
```

## Generating a layer

Each generator plans first and writes second, so a caller can show what it would write, check it,
and only then apply it. `planValidation` reports what the planned binding records would break in the
project — a second Domain binding for the same SObject, say — without counting problems that were
already there:

```ts
import { generateDomain, planValidation } from '@simplysf/simply-aep-core';

const preview = await generateDomain.plan(connection, { sobject: 'Account', flavor: 'at4dx' }, { projectRoot });
for (const file of preview.files) console.log(file.status, file.relativePath);

const issues = planValidation(preview, ['force-app', preview.baseDir]);
if (!issues.some((issue) => issue.severity === 'error')) {
  await generateDomain.apply(connection, preview); // refuses to replace existing files unless { overwrite: 'overwrite' }
}
```

`generateService`, `generateSelectorMethod`, `generateFieldSetInclusion`, `generateAction`, and
`generateCriteria` don't need an org: pass `undefined` as the connection.

Generation rejects invalid derived CMDT DeveloperNames rather than renaming them. SObject, class,
and service inputs must be identifiers; binding sequences must be finite, non-negative plain
decimals. `renderGenerationPlan(preview, policy?)` defaults to `EXISTS (will fail)` for existing
files; use `'overwrite'` or `'skip'` to reflect the chosen apply policy. Dry runs also refuse
existing files under the default policy. Writes are not atomic; `write-failed` and `cancelled`
errors include `data.created` so callers can report partial work.
