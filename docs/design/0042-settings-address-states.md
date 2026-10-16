# 0042 — `simply settings address state create`/`activate`

**Status:** Implemented (PR #227, shipped as `@simplysf/simply-settings-core@0.2.0`; plugin
SimplySF/simply-plugins#66). Not yet exercised against a live org; see Testing.
**Package:** new `packages/simply-settings` (CLI, in `simply-plugins`); new
`packages/simply-settings-core` (library, in `simply-plugins-core`). Duplicated from `simply-plugins`, where it is 0041.
**Date:** 2026-10-14

## Problem

An org with State and Country/Territory Picklists enabled ships with states for only a handful of
countries. Adding the rest — ISO 3166-2 lists roughly 5,000 subdivisions — has to be done one state
at a time through **Setup → State and Country/Territory Picklists → Configure New State**.
Salesforce documents that this can't be automated through the platform's APIs: "You can't use
Metadata API to create or delete new states, countries, or territories", and "you can't deploy new
ISO codes … using any API"
([State and Country/Territory Picklists and Metadata API](https://help.salesforce.com/s/articleView?language=en_US&id=sf.admin_state_country_picklists_api.htm&type=5)).

[mattandneil/statecodes](https://github.com/mattandneil/statecodes) works around this with an Apex
batch that screen-scrapes that Setup form. It's useful, but it means installing an unlocked package
(plus a Remote Site Setting to the org's own domain) into every org, and it finishes with a manual
Workbench step: retrieve `Address.settings`, find-and-replace `<active>false</active>` and
`<visible>false</visible>`, and deploy it back, because every new state is created inactive and
hidden. Nothing in this CLI does any of this today.

### What the upstream package does (read in full)

`StateCodes.cls` (5,318 lines, ~5,040 of them a hardcoded `Map<String,String>` of
`'{Country}-{State}' => 'State name'`) runs as a batch of scope size 1, one state per `execute`:

1. `GET {orgDomain}/i18n/ConfigureNewState.apexp?countryIso={Country}`, with the running user's
   session id as the `sid` cookie.
2. Pull the four Visualforce view-state hidden fields (`ViewState`, `ViewStateVersion`,
   `ViewStateMAC`, `ViewStateCSRF`) out of the HTML. The country is encoded in the view state.
3. `POST` the form back (`application/x-www-form-urlencoded`) with the state name, ISO code, and
   integration value (set equal to the name), using **hardcoded** generated component ids
   (`configurenew:j_id1:blockNew:j_id9:nameSectionItem:editName`, …, `…:j_id43:addButton`).
4. Classify the response HTML:
   - `<h4>Errors</h4>` or `<h4>Error:</h4>`: a validation error, e.g. the state already exists.
     The batch silently `continue`s.
   - `You are missing information`: the country doesn't exist in the org. Also silently skipped.
   - No `success=true` redirect: an unrecognized failure, written to a `Document` in the user's
     personal folder.
5. Retry each request once on `CalloutException` ("Read timed out"), and email the user on finish.

`StateCodes.page` is a Visualforce page for editing the map as JSON, starting/aborting the batch,
and polling `AsyncApexJob`. It has no logic beyond that.

The upstream repo has **no license** (`gh api repos/mattandneil/statecodes` → `license: null`). We
reimplement the technique, which is a description of how Salesforce's own Setup form behaves. We
don't copy its code or its dataset. v1 ships no dataset at all: the caller supplies the states to
create in a `--file` (see Behavior, and Alternatives considered for the dataset options rejected).

## Decision

Add a new plugin, `@simplysf/simply-settings`, under a new `simply settings` topic with an
`address` subtopic: `sf simply settings address state create` and
`sf simply settings address state activate`. The topic is named for the Metadata API's `Settings`
type family, so other `*Settings` commands have an obvious place to land later. `address` mirrors
`AddressSettings`, the type the second command deploys.

All org interaction and HTML handling lives in a new `@simplysf/simply-settings-core` library in
`simply-plugins-core` **from the start**. This follows the same reasoning as
[0024](0024-apex-test-suite-generate.md): don't write it inline and extract it later. The CLI
package stays a thin flags/spinner/table layer. Scraping a Setup form and activating states are
things an editor extension or script could want without the CLI, which meets
[0019](0019-plugin-core-library-extraction.md)'s third criterion.

The plugin is bundled into the `@simplysf/simply` orchestrator like every other plugin.

Three deliberate departures from upstream:

1. **Diff before scraping.** `create` reads the org's current `AddressSettings` (one Metadata API
   retrieve) first. States whose ISO code already exists, and countries the org doesn't
   have, are classified without any HTTP traffic. Upstream sends two requests for every one of its
   ~5,040 entries on every run, even when nothing is missing.
2. **Parse the form instead of hardcoding component ids.** The `j_id9`/`j_id43` ids are generated
   by Visualforce and shift whenever Salesforce changes the page. We submit every hidden input the
   GET response contains, and find the name/code/integration-value inputs and the Add button by
   their stable id **suffixes** (`:editName`, `:editIsoCode`, `:editIntVal`, `:addButton`).
3. **Report every outcome.** Upstream silently swallows validation errors, so a state rejected
   for a real reason (say, a duplicate _name_) looks the same as one that already existed. Every
   state gets a status and, where Salesforce gave one, its message.

## Behavior

### Input: state definitions

Both commands take the same required `--file`: a JSON object mapping ISO 3166-2 codes to names,
`{ "US-CA": "California", … }`. This is the same `{Country}-{State}` → name shape the upstream page
edits, so an existing customized list ports unchanged. There is no bundled default; adding one
later would make `--file` optional without changing its shape.

Keys must match `^[A-Z]{2}-[A-Z0-9]{1,3}$`, and names must be non-empty. The command fails before
any org call on the first invalid entry, naming it, and on a file that isn't readable JSON.
`--country` (multiple, case-insensitive) then filters the list to those ISO 3166-1 alpha-2 codes. A
`--country` that is malformed, or has no entries in the file, is an error rather than an empty
result, so a typo can't silently do nothing. The integration value is always set to the name, as
upstream does. Setting it separately is out of scope for v1; see Open questions.

### `sf simply settings address state create`

```
sf simply settings address state create --target-org myOrg --file states.json --country US --country CA
sf simply settings address state create --target-org myOrg --file states.json --dry-run
```

| Flag            | Char | Required        | Description                                                                                                               |
| --------------- | ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--target-org`  | `-o` | Yes             | `simply-plugin-kit`'s shared org flag.                                                                                    |
| `--api-version` | —    | No              | Same.                                                                                                                     |
| `--file`        | `-f` | Yes             | State definitions JSON (above).                                                                                           |
| `--country`     | `-c` | No, multiple    | Only these countries.                                                                                                     |
| `--concurrency` | —    | No (default 4)  | How many states are submitted in parallel (1–10). Each state is still a GET then a POST against its own fresh view state. |
| `--wait`        | `-w` | No (default 33) | Minutes to wait for the AddressSettings retrieve.                                                                         |
| `--dry-run`     | —    | No              | Do the diff and print what would be created; send no Setup-form requests.                                                 |

**Flow.**

1. Resolve and filter the definitions.
2. Retrieve `Settings:Address` through `@salesforce/source-deploy-retrieve` into a temporary
   directory and parse it. A retrieve rather than `metadata.read`, so `activate` reads and writes
   back one representation (the source-format file) with no type coercion in between; ISO codes
   like Andorra's `02` must stay strings. If the settings hold no countries at all, State and
   Country/Territory Picklists isn't enabled, and the command fails saying so.
3. Plan. Each definition becomes `exists` (the ISO code is already present under that country),
   `country-missing` (no such country in the org), or `pending`.
4. Unless `--dry-run`, open a Setup session (below) and submit each `pending` state through
   `mapConcurrent` (from `simply-core`), with `retryWithBackoff` wrapping transport-level failures
   only (timeouts, resets, 5xx). Re-POSTing after a timeout is safe: if the first attempt landed,
   the retry comes back as a duplicate and is classified `exists`.
5. Print a summary table of counts by status, plus a detail table of every `rejected`/`failed`
   row. Finish with a hint to run `state activate` when anything was created, since new states
   are created inactive. When nothing is pending, no Setup session is opened at all.

**Opening a Setup session.** Seed a cookie jar with the connection's access token as a host-only
`sid` cookie on the instance host (the CLI's own cached session), then GET
`/i18n/ConfigureNewState.apexp?countryIso=US` with it (`undici` with manual redirect-following,
collecting `Set-Cookie` per host, since `*.salesforce.com` cookies don't reach
`*.salesforce-setup.com`; the token itself never leaves the instance host). Redirects include Salesforce's `redirectOnLoad()` interstitial: a 200
page whose script calls `window.location.replace('…')` in place of a 3xx. Every GET follows its
`https:` target the way a browser would, within the same 10-hop limit. A real org answered the
form's own URL with one, which the first release didn't follow, so every state failed with "Setup
form layout not recognized". If the chain ends on an `/identity/` page (MFA registration, device
verification), the command fails with "Salesforce wants this user to complete an
identity-verification step…", since only a person in a browser can get past it.

The first release opened the session the way `@salesforce/core`'s `Org.getFrontDoorUrl` (and so
`sf org open`) does: a single-use `frontdoor_uri` from `/services/oauth2/singleaccess`. That starts
a _new_ UI session, and a production org held it at passkey registration
(`/_ui/identity/webauthn/AddPasskeyUi`, reached through `lhdoredir()` and `contentDoor` script
pages the interstitial matcher doesn't recognize), even though the same user's browser session went
straight to Setup. So every state failed with "Setup form layout not recognized" while the form was
fine. The cached token as a `sid` cookie reaches the form directly on that org. It also avoids the
problem that ruled out `frontdoor.jsp?sid=`: the token travels in a cookie header to the org's own
host, never in a URL. `refreshAuth()` runs first, because Setup answers an expired token with the
login page rather than a 401 jsforce would refresh on. If the redirect chain ends on a login page or
a non-200, the command fails before submitting anything: "Couldn't open a Setup session with this
org's credentials. The auth may lack the `web` or `full` OAuth scope." The access token never
appears in output or error messages; transport errors name only the path.

**Submitting one state** (`createState(session, definition)`):

1. `GET /i18n/ConfigureNewState.apexp?countryIso={Country}`.
2. Find the first form that has all four of `:editName`, `:editIsoCode`, `:editIntVal`, and
   `:addButton`. Submit what a browser would: every hidden input (the four view-state fields plus
   the form's own marker input), text inputs at their default, checked checkboxes, selected
   options, and textareas, but no disabled controls and no submit button except Add. Set the
   name, code, and integration-value inputs. A real page renders the `com.salesforce.visualforce.*`
   view-state inputs _after_ `</form>`, in `<span id="ajax-view-state-page-container">`, and
   Visualforce's script copies them in on submit, so they're collected from the whole page. If no
   form has all four suffixes, the state is `failed` with "Setup form layout not recognized", with
   the identity-verification message for an `/identity/` page, or with "The Setup session expired
   or was rejected" for a login page. This is the tripwire for Salesforce changing the page.
3. `POST` the form to its `action` URL without following the redirect, since a Visualforce
   postback signals success through where it redirects to, and classify the response:

Checked in this order, the same order as upstream:

| Response contains                                                                                 | Status            | Message                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `<h4>Errors</h4>`/`<h4>Error:</h4>`, message matching "already exists/in use/used" or "duplicate" | `exists`          | Salesforce's text                                            |
| Any other `<h4>Errors</h4>`/`<h4>Error:</h4>`                                                     | `rejected`        | Salesforce's text (first `<li>`, or the text after `Error:`) |
| `You are missing information`                                                                     | `country-missing` | —                                                            |
| `success=true` in the body or the redirect `Location`                                             | `created`         | —                                                            |
| Anything else                                                                                     | `failed`          | "Unrecognized response from Setup (HTTP n)."                 |

A 5xx, a timeout, or a socket failure is retried (twice by default, backing off from 2 seconds).
Any other exception becomes `failed` with its message. `createState` never throws, so one bad state
can't stop a run of thousands.

The exact "already exists" wording is pinned from a real org during live verification (see
Testing). Until it matches, a duplicate shows up as `rejected`, which is visible rather than wrong.

**Output.** `--json` returns:

```ts
type StateCreateResult = {
  summary: Record<'created' | 'would-create' | 'exists' | 'country-missing' | 'rejected' | 'failed', number>;
  states: Array<{ country: string; code: string; name: string; status: StateCreationStatus; message?: string }>;
};
```

`states` is in the file's order. `--dry-run` reports `would-create` in place of `pending`. Following the `validate` commands'
convention, `process.exitCode = 1` when any state is `rejected` or `failed`; the result is still
returned in full.

### `sf simply settings address state activate`

```
sf simply settings address state activate --target-org myOrg --file states.json --country US
```

| Flag            | Char | Required        | Description                                          |
| --------------- | ---- | --------------- | ---------------------------------------------------- |
| `--target-org`  | `-o` | Yes             | Shared org flag.                                     |
| `--api-version` | —    | No              | Same.                                                |
| `--file`        | `-f` | Yes             | Same definitions input as `create`.                  |
| `--country`     | `-c` | No, multiple    | Same filter.                                         |
| `--wait`        | `-w` | No (default 33) | Minutes to wait for the retrieve and for the deploy. |
| `--dry-run`     | —    | No              | Report what would change; deploy nothing.            |

**Scope.** Only states that are both in the resolved definitions **and** present in the org get
`<active>true</active>` and `<visible>true</visible>`. Other states, and every country, are left
alone. This makes `create` + `activate` with the same flags a matched pair, and it never re-enables
a standard state an admin deliberately hid. Upstream's find-and-replace activates everything
instead, which is the main behavior change here.

**Mechanism.** Retrieve `AddressSettings` (as `create` does), set the two fields to `true` on the
matched states, and deploy the settings back through `@salesforce/source-deploy-retrieve` from a
temporary directory, polling up to `--wait`. The XML round-trips through `fast-xml-parser` with
every value kept as a string, so everything else is written back unchanged. A state missing
`<active>`/`<visible>` entirely gets them added in the schema's element order. The upstream README
warns that `Address.settings` retrieved from _another_ org can drift from the target's labels.
That doesn't apply here, because we write back exactly what we just read from the same org. If
nothing needs changing, nothing is deployed and the command says so.

**Output.** A summary table (activated / already active / not in org), and a warning naming the
listed states that aren't in the org (the first 20, then a count), with a hint to create them. A
failed deploy is an error carrying the deploy id and its component errors. `--json` returns:

```ts
type StateActivateResult = {
  activated: StateDefinition[];
  alreadyActive: StateDefinition[];
  notInOrg: StateDefinition[];
  deployId?: string; // absent for --dry-run, or when nothing needed activating
};
```

### `@simplysf/simply-settings-core` API

| Export                                                                                    | Kind | Purpose                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `parseStateDefinitions(json)`                                                             | pure | Validate/normalize the `--file` shape; throws `SfError` naming the bad key.                                 |
| `filterStateDefinitions(defs, countries?)`                                                | pure | `--country` filter, erroring on malformed codes or countries with no entries.                               |
| `formatStateKey(def)`                                                                     | pure | `US-CA`.                                                                                                    |
| `retrieveAddressSettingsXml(options)`                                                     | org  | SDR retrieve of `Settings:Address` → the file's text.                                                       |
| `deployAddressSettingsXml(options)`                                                       | org  | SDR deploy of that text; a failed deploy is returned, not thrown.                                           |
| `parseAddressSettingsXml(xml)`                                                            | pure | → countries and states, with the "picklists not enabled" check.                                             |
| `planStateCreation(defs, settings)`                                                       | pure | → `pending`, plus `settled` (`exists` / `country-missing`).                                                 |
| `openSetupSession(options)` / `SetupSession`                                              | org  | Access token as `sid` cookie + cookie jar + login-page check.                                               |
| `parseNewStateForm(html)` / `fillNewStateForm(form, def)`                                 | pure | → the form's action and default fields, or `undefined` if the layout isn't recognized; then the submission. |
| `classifyNewStateResponse(response)`                                                      | pure | → `{ status, message? }` per the table above.                                                               |
| `createState(session, def, options?)` / `createStates(options)`                           | org  | One state / many, with concurrency, retry, and an `onProgress` callback.                                    |
| `planStateActivation(xml, defs)`                                                          | pure | → the rewritten XML (only if something changed) and the three lists.                                        |
| `activateStates(options)`                                                                 | org  | Retrieve + plan + deploy, with `dryRun`.                                                                    |
| `isLoginPage`, `NEW_STATE_FORM_PATH`, `SetupTransportError`, `DEFAULT_CREATE_CONCURRENCY` | —    | Supporting helpers and constants.                                                                           |

## Alternatives considered

**Create states through the Metadata API.** This would be the clean answer, but Salesforce
explicitly doesn't support it (see Problem). `activate` uses the Metadata API precisely because
editing existing states _is_ supported.

**Port the Apex batch and deploy it to the org.** This leaves code, a Remote Site Setting, and
`Document` records in the org, needs Apex test coverage in production, and reports its results
over email. The CLI already holds an authenticated session, so none of that footprint is needed.

**Drive a headless browser (Playwright).** This adds a large dependency and an install step for
what is a two-request form submission. We'd only reconsider if Salesforce moved this Setup page
to Lightning with no server-rendered form.

**Hardcode the upstream component ids.** These are generated ids from the page as it was in 2019.
The suffix-based parse costs about twenty lines and fails loudly when the page changes, instead of
posting garbage.

**Activate everything (upstream's find-and-replace).** This is simpler, but it silently re-enables
states admins hid on purpose. `--file` with the full list, or no `--country`, already covers "do
everything" for the dataset.

**Fold activation into `create` as `--activate`.** Admins commonly create in a sandbox, review,
and then activate. Upstream's README insists on exactly that. Two commands keep that pause
natural. Running the pair back to back is one extra line.

**Topic `simply address` / package `simply-address`.** Considered first. `simply settings address`
was chosen so future `*Settings` metadata commands share a home.

**Bundle an ISO 3166-2 dataset as the default input.** Upstream's ~5,040-entry map is unlicensed,
so it can't be copied. Debian's `iso-codes` (`iso_3166-2.json`) is authoritative and tracks ISO
updates, but it's LGPL-2.1+, and converting it to our shape makes that file a derived LGPL work
inside an Apache-2.0 package. A Wikidata export (CC0) has no licensing friction, but its coverage
and naming vary and would need a curation pass and a refresh script. Either way, someone has to
choose subdivision _levels_ (ISO lists both France's regions and its departments, for example).
Rejected for v1: requiring `--file` has no licensing risk, and a dataset can be added later without
changing any flag's shape. [0043](0043-settings-address-states-iso-codes.md) later did exactly that,
by fetching Debian `iso-codes` at run time instead of bundling it.

**Parse the page with an HTML library (`node-html-parser`).** This was the original plan. The
implementation uses a ~60-line scanner over `<form>`/`<input>`/`<select>`/`<textarea>` tags
instead. It handles any attribute order and quoting and decodes entities, which covers the flat,
well-formed markup Visualforce emits. It also avoids a new runtime dependency, and with it the
repo's supply-chain release-age policy for fresh packages.

**`connection.metadata.read('AddressSettings', 'Address')` to read the settings.** This was the
original plan. It's faster than a retrieve, but `activate` must deploy the settings back, and
`readMetadata`'s jsforce-converted object would have to be re-serialized into XML. A retrieve gives
`create` and `activate` the same source-format file to read and write back verbatim.

## Implementation plan

Per the cross-repo recipe ([0027](0027-core-extraction-round-1-post-split.md)), core first:

1. **`simply-plugins-core`**: `packages/simply-settings-core`, using the standard `-core` library
   shape (`exports`/`main`/`types`, no oclif). Dependencies: `@salesforce/core`, `@salesforce/kit`,
   `@salesforce/source-deploy-retrieve`, `@simplysf/simply-core` (`workspace:^`; for
   `mapConcurrent`/`retryWithBackoff`), `fast-xml-parser` (already used by `simply-core`), and
   `undici` (already used by `simply-core`). Add the `src/address/*` modules per the API table, a
   barrel `src/index.ts`, `test/index.test.ts` (exported-key list), a README `## API` section, a
   `CONTRIBUTING.md` (including how to refresh the HTML fixtures when Salesforce changes the page),
   and this doc as 0042. Register the package in that repo's `eslint.config.mjs` (both arrays), its
   README/CONTRIBUTING package tables, and the docs site (typedoc plugin, guide, sidebar, landing
   card, getting-started). Open that PR and merge it. The package is committed at `0.1.0`, and the
   release workflow bumps it to `0.2.0` on merge, as it did for earlier `-core` packages. npm's
   trusted publishing can only be attached to a package that already exists, so CI's first
   publish fails. Publish `0.2.0` once by hand (`pnpm publish --access public --no-git-checks`
   from the built release commit), then attach the GitHub Actions trusted publisher so later
   releases publish from CI with provenance.
2. **`simply-plugins`**: `packages/simply-settings`, scaffolded from `simply-community`'s
   `package.json`/`bin`/`tsconfig`/wireit block, with `oclif.topics` `simply → settings → address
→ state`. Add `src/commands/simply/settings/address/state/{create,activate}.ts`, a shared
   `src/common/loadStateDefinitions.ts` (reads `--file` and applies `--country`),
   `messages/simply.settings.address.state{,.create,.activate}.md`, and tests. Register the package
   in `eslint.config.mjs`. Then `pnpm run build` (for `command-snapshot.json`) and `pnpm run readme`.
   Until the core package is published, verify against a `pnpm pack` tarball of it through a
   temporary `file:` dependency spec. The commit itself has to wait for the publish:
   `simply-plugins`' pre-commit hook runs `pnpm exec`, which first checks the dependency is installable.
   It then depends on `^0.2.0`, with `@simplysf/simply-settings-core@0.2.0` added to
   `minimumReleaseAgeExclude`.
3. **Register it**: add it to `packages/simply`'s `oclif.plugins`, `dependencies`, and
   `command-snapshot` wireit dependencies, then rebuild and run `pnpm run readme` there. Add it to
   `OTHER_PLUGIN_DIRS` in `site/scripts/sync-command-reference.mjs`, the sidebar in
   `site/astro.config.mjs`, and the root README/CONTRIBUTING tables and install lists, then run
   `pnpm --filter site run sync`.
4. Add the index row to `docs/design/README.md`, and update Status once both PRs land.

## Testing

**Core unit tests (68; vitest, `undici` `MockAgent`, sinon-stubbed SDR):**

- `parseNewStateForm` against a `ConfigureNewState.apexp` fixture. It finds the right form among
  others, submits only what a browser would, still finds fields when the `j_id` numbers change,
  and returns `undefined` when any suffix is missing or for a login page.
- `classifyNewStateResponse`: one fixture per row of the classification table, plus success by
  redirect.
- `parseAddressSettingsXml`/`planStateActivation` against an `Address.settings-meta.xml` fixture:
  `02` stays a string, a lone country or state is still a list, the picklists-not-enabled error,
  only listed states change, the rest of the document round-trips byte-for-byte, and missing
  flags are added in schema order.
- `SetupSession`: the token sent as `sid` to the instance host only, cookies carried per host
  across setup-domain redirects, url-encoded POST without following the redirect, the scope error
  when Setup answers with login, a missing token, the token in no error, and a 5xx as a retryable
  `SetupTransportError`.
- `createState`/`createStates`: the form posted to its action, a rejection's message carried, no
  POST for an unrecognized form, expired-session wording, a 5xx retried and the retry landing as
  `exists`, no retry for other errors, giving up after the configured retries, concurrency bound,
  and input-order results.
- `retrieveAddressSettingsXml`/`activateStates`: retrieves `Settings:Address`, reports a failed
  retrieve, deploys only the listed changes, returns a failed deploy, and skips the deploy for a
  dry run or when nothing changes.

**CLI unit tests (10):** only missing states submitted, results in file order, `--country`
applied, `exitCode` 1 with the message on a rejection, no Setup session for `--dry-run` or when
nothing is missing, an unreadable file explained, a bad `--country` failing before any retrieve,
`activate` deploying only listed inactive states, a dry run deploying nothing, and a failed deploy
surfacing its errors.

**Fixtures are synthetic.** The HTML fixtures are hand-built from Visualforce's standard markup,
not captured from an org. Two real pages have corrected them since. A browser-saved
`ConfigureNewState.apexp` from a sandbox confirmed the field-name suffixes and showed the view state
sitting outside the form. A production org answered the page with a `redirectOnLoad()`
interstitial to MFA registration. The tests now cover both.

**Live verification: not done yet.** No reachable scratch org was available when this was
implemented. Before release, run `create` then `activate` against a scratch org with the
`StateAndCountryPicklist` feature, using a file with one fictitious code (`US-ZZ`). `create`
should report `created` on the first run and `exists` on the second. Then re-retrieve
`AddressSettings` and check the state is active and visible. Use that run to replace the
synthetic fixtures with scrubbed captures and to pin the real "already exists" wording. A NUT that
automates this is follow-up work.

## Open questions

1. **Auth types.** Using the token as a UI session needs `web`/`full` scope. The default
   `sf org login web` app has it; JWT flows with a custom connected app may not. That case is
   handled by the fail-fast error, but it's worth confirming against a JWT-authed org before
   release.
2. **Setup domain.** Whether `/i18n/ConfigureNewState.apexp` on the instance URL still serves the
   classic form, or redirects to `*.my.salesforce-setup.com`, gets confirmed in live verification.
   The cookie jar follows redirects across both hosts either way, script interstitials included.
   A sandbox serves the form itself from `*.sandbox.my.salesforce-setup.com`.
3. **Default `--concurrency`.** 4 is a guess, chosen so a large file runs in tens of minutes
   instead of the hours a serial run takes. Measure against a sandbox and adjust.
4. **Separate integration values** (for example, ISO code as the integration value). Not in v1.
   It would be a value-shape extension to `--file`, not a new flag.
5. **A bundled dataset.** Resolved by [0043](0043-settings-address-states-iso-codes.md):
   `--iso-codes debian` fetches one at run time, which avoids both the licensing and staleness
   problems.
