# 0043 — `--iso-codes <source>`: fetch state definitions from an ISO 3166-2 source at run time

**Status:** Planned. Core implemented (`simply-settings-core`); CLI follows once it is published.
**Package:** `packages/simply-settings-core` (library, in `simply-plugins-core`); `packages/simply-settings` (CLI, in `simply-plugins`). Duplicated from `simply-plugins`, where it is 0044.
**Date:** 2026-10-14

## Problem

`sf simply settings address state create`/`activate` ([0042](0042-settings-address-states.md))
require a `--file` mapping ISO 3166-2 codes to names. 0042 deliberately shipped no dataset, so
every user has to find, convert, and curate one themselves before the commands do anything. That
is the hardest part of the job, and the result goes stale: ISO 3166-2 changes several times a year
(subdivisions renamed, merged, split), and a hand-maintained file never hears about it.

0042 rejected bundling a dataset for two reasons, and both still hold for anything committed to
this repo:

1. **It goes out of date.** A snapshot in the package is only as fresh as our last release, and
   refreshing it is a chore nobody owns.
2. **Licensing.** The authoritative open source, Debian's
   [`iso-codes`](https://salsa.debian.org/iso-codes-team/iso-codes), is LGPL-2.1+. Converting
   `iso_3166-2.json` into our shape and committing it puts an LGPL-derived file inside an
   Apache-2.0 package.

Both come from _storing_ the data. Neither applies if the command fetches it from upstream each time
it runs.

## Decision

Add an `--iso-codes <source>` flag to both commands as an alternative to `--file`. It names where to
fetch ISO 3166-2 data from at run time. The data is converted in memory to the same definitions
`--file` produces and handed to the existing pipeline unchanged. Nothing is written to the repo,
the package, or (in this version) the user's disk.

**`debian` is the only supported source** for now: Debian's `iso-codes` repository, at its latest
release tag unless `--iso-codes-version` pins one. The flag takes a value from the start, so a
later source (see Open questions) is a new allowed value plus one adapter in core, not a new flag
or a breaking change.

Fetching and converting live in `@simplysf/simply-settings-core`, next to `parseStateDefinitions`,
for the same reason 0042 put everything else there. Each source is an adapter behind one small
interface, and the conversion and validation they share are written once. The CLI only adds flags
and a line reporting which source and version it used.

## Behavior

### Flags (both `create` and `activate`)

| Flag                  | Required                                | Description                                                                                                                                                               |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file`              | Exactly one of `--file` / `--iso-codes` | Unchanged.                                                                                                                                                                |
| `--iso-codes`         | Exactly one of `--file` / `--iso-codes` | The source to fetch ISO 3166-2 state definitions from. Allowed values: `debian`.                                                                                          |
| `--iso-codes-version` | No; requires `--iso-codes`              | The version of the source to use, in that source's own terms. For `debian`, a tag (`v4.20.1`) or branch (`main`) of the `iso-codes` repo. Defaults to the latest release. |
| `--all-levels`        | No; requires `--iso-codes`              | Include subdivisions nested under another subdivision (French departments, English boroughs). By default only top-level subdivisions are used.                            |
| `--country`           | No, multiple                            | Unchanged; filters either input. Strongly suggested with `--iso-codes`, since the unfiltered top level from `debian` is 3,590 states across 200 countries.                |

`--iso-codes` is an oclif option flag with `options: ['debian']`, so any other value fails at flag
parsing with oclif's standard "Expected --iso-codes=… to be one of: debian" message. It has no
default value. The user names the source explicitly, which keeps the command line honest about
where the data comes from, and it keeps `debian` from becoming an accidental default once other
sources exist.

`--file` stops being `required: true` and becomes `exactlyOne: ['file', 'iso-codes']`. Existing
invocations with `--file` behave exactly as before.

```
sf simply settings address state create --target-org myOrg --iso-codes debian --country FR --country DE --dry-run
sf simply settings address state create --target-org myOrg --iso-codes debian --iso-codes-version v4.20.1 --country FR
sf simply settings address state activate --target-org myOrg --iso-codes debian --iso-codes-version v4.20.1 --country FR
```

### Source interface

Each source is one adapter in core:

```ts
type IsoCodesSourceId = 'debian';

type IsoCodesSubdivision = { code: string; name: string; parent?: string };

type IsoCodesSource = {
  id: IsoCodesSourceId;
  label: string; // "Debian iso-codes", for messages and attribution
  homepage: string;
  resolveLatestVersion(options: IsoCodesFetchOptions): Promise<string>; // the default when none is given
  fetchSubdivisions(
    version: string,
    options: IsoCodesFetchOptions,
  ): Promise<{ url: string; subdivisions: IsoCodesSubdivision[] }>;
};

// requestTimeoutMs (default 30 s), retryAttempts (2), initialRetryDelay (2 s), and an undici
// dispatcher (default: a per-call EnvHttpProxyAgent, closed afterwards).
type IsoCodesFetchOptions = { requestTimeoutMs?; retryAttempts?; initialRetryDelay?; dispatcher? };
```

An adapter only knows how to find a version and download that source's data into
`IsoCodesSubdivision[]`. Everything after that is shared: the `parent` filter for `--all-levels`,
validation through the existing `parseStateDefinitions`, and the `--country` filter. A source that
has no hierarchy simply never sets `parent`, and `--all-levels` is then a no-op for it.

### Resolution (all sources)

1. **Version.** Use `--iso-codes-version` as given, or else the adapter's `resolveLatestVersion`.
2. **Fetch.** Call the adapter's `fetchSubdivisions`. All adapters use `undici` (already a core
   dependency) through `EnvHttpProxyAgent`, so `HTTPS_PROXY`/`NO_PROXY` work the way they do for
   the rest of `sf`. Requests have a 30-second timeout, and transport failures (timeouts, resets,
   5xx) are wrapped in `retryWithBackoff`.
3. **Convert.** Drop entries with a `parent` unless `--all-levels` is set, map each remaining entry
   to `code → name`, and pass the result through the **existing** `parseStateDefinitions`. If a
   source ever changes shape, the run fails loudly here, before any org call, instead of creating
   bad states.
4. **Filter.** `--country` exactly as today, including the error for a country with no entries.

The command logs one line before the org work starts, for example
`Using Debian iso-codes v4.20.1: 26 subdivisions for FR (top level only).`, so the run records
which data it used.

### The `debian` source

- **Default version.** Ask the GitLab API for tags sorted by version
  (`GET https://salsa.debian.org/api/v4/projects/iso-codes-team%2Fiso-codes/repository/tags?order_by=version&sort=desc`)
  and take the first tag matching `^v\d+(\.\d+)*$`. The default is a release tag rather than
  `main` because tags are what distributions ship, and `main` can hold in-progress edits. Users who
  want unreleased fixes can say `--iso-codes-version main`.
- **Data.** `GET https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/{version}/data/iso_3166-2.json`
  (about 500 KB). The file is `{ "3166-2": [{ code, name, type, parent? }] }`, which already
  matches `IsoCodesSubdivision`. `type` is dropped (see Open questions). Every current code passes
  `parseStateDefinitions`'s `^[A-Z]{2}-[A-Z0-9]{1,3}$` rule (checked against all 5,046 entries in
  `v4.20.1`).
- **Unknown version.** The raw URL returns 404 for a tag or branch that doesn't exist.

### Why top level by default

ISO 3166-2 lists more than one level for some countries, and a Salesforce org almost always wants
one level. In `debian` `v4.20.1`, 1,456 of the 5,046 entries have a `parent`:

| Country | All entries | Top level | What the top level is                                        |
| ------- | ----------- | --------- | ------------------------------------------------------------ |
| US      | 57          | 57        | 50 states, DC, 6 outlying areas                              |
| CA      | 13          | 13        | Provinces and territories                                    |
| FR      | 124         | 26        | Regions and overseas collectivities (departments are nested) |
| GB      | 221         | 4         | England, Scotland, Wales, Northern Ireland                   |

For FR and GB, neither level is right for every org. Top level is the safer default because it is
smaller and easier to review. `--all-levels` gets the full list, and a curated `--file` still
covers anything in between.

### Output

Both result types gain an optional `source` field. This is additive, and it is absent for `--file`:

```ts
source?: { kind: 'iso-codes'; provider: IsoCodesSourceId; version: string; allLevels: boolean };
```

Everything else is as in 0042.

### Errors

| Situation                                     | Message (gist)                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--iso-codes` value not supported             | oclif's standard "Expected --iso-codes=… to be one of: debian".                                                            |
| Network failure or non-200 after retries      | "Couldn't download ISO 3166-2 data from {label} ({url}): {reason}. Check your network or proxy, or pass `--file` instead." |
| No default version could be resolved          | Same, naming the endpoint; suggest `--iso-codes-version`.                                                                  |
| `--iso-codes-version` doesn't exist           | "{label} has no version '{v}'." with a link to where that source lists its versions.                                       |
| Response isn't the expected shape / bad entry | The existing `parseStateDefinitions` error, prefixed with the source URL.                                                  |

### Behavior worth knowing about

- **Duplicate names.** In `debian` `v4.20.1`, 9 top-level names repeat within a country (for
  example Azerbaijan's `Lənkəran` city and `Lənkəran` district). Salesforce is expected to reject
  the second as a duplicate name, so it shows up as `rejected` with Salesforce's message. That is
  visible rather than wrong, and the code is still reported.
- **Names are ISO's**, romanized with diacritics (`Sant Julià de Lòria`). The integration value is
  still the name, as in 0042.
- **`create` + `activate` drift.** If a new release lands between the two commands, unpinned runs
  could resolve different versions. The docs and examples pin `--iso-codes-version` for that
  reason, and `source.version` in the JSON output makes the version used auditable.

## Licensing

Each source's license is checked when its adapter is added. For `debian`, `iso-codes` is
LGPL-2.1+, and this design never redistributes it: nothing derived from it is committed, published
in our npm packages, or written to disk. The user's machine downloads the data from Debian and uses
it in memory. The package README and the flag's help text credit each supported source and link to
it. Our code stays Apache-2.0 and contains only URLs and converters.

## Alternatives considered

**A boolean `--iso-codes` hard-wired to Debian.** This was the first draft of this doc. It's one
word shorter on the command line, but adding a second source later would need either a new flag or
a breaking change to this one. Taking a value from day one costs `debian` on each command line and
makes the source explicit in scripts.

**A generic `--source file|debian` flag that replaces `--file`.** This would fold the path into a
second flag (`--source file --file states.json`) and change the existing `--file` contract for no
gain. `--file` and `--iso-codes <source>` stay as two clear alternatives.

**Default `--iso-codes` to `debian` when no value is given.** oclif option flags can't take an
optional value cleanly, and with more than one source an implicit default hides where the data came
from. The value is required.

**Commit a generated snapshot and refresh it with a script.** This is rejected for both of the
reasons in Problem. It goes stale between releases, and it makes us distribute an LGPL-derived
file.

**Default `debian` to `main`.** It's fresher, but it can carry unreleased edits. Release tags are
the reviewed data, and `main` is one flag away.

**pycountry, or an npm wrapper of `iso-codes`.** pycountry is Python. The npm wrappers are
unofficial and repackage the same LGPL data on someone else's release schedule. Going to the
source is simpler and is as fresh as possible.

**Cache the download.** Tags are immutable, so caching a tagged file in the `sf` cache directory
would be safe and would make repeat runs work offline. It's left out of v1 because one 500 KB GET
per run is cheap and a cache adds invalidation and storage rules. It's easy to add later, per
source and without changing any flag. Branches like `main` would never be cached.

**A separate `state list --iso-codes <source>` command to export a starter `--file`.** This is
useful for curation, but it's a separate feature (see Open questions).

## Implementation plan

1. **`simply-plugins-core` (`simply-settings-core`)**: add `src/address/isoCodes/`:
   - `types.ts`, with `IsoCodesSourceId`, `IsoCodesSubdivision`, `IsoCodesSource`, and
     `IsoCodesFetchOptions`.
   - `http.ts`, a shared `getJson` (timeout, `retryWithBackoff` on transport failures, 404 returned
     as `undefined` for the adapter to interpret, and everything else as `IsoCodesDownloadError`).
   - `debian.ts`, the `debian` adapter (tag lookup, raw URL, and its shape check).
   - `index.ts`, with `ISO_CODES_SOURCES` (the registry, `{ debian }`), the
     `ISO_CODES_SOURCE_IDS` used for the CLI flag's `options`, the pure
     `subdivisionsToStateDefinitions(subdivisions, { allLevels })`, and
     `fetchIsoCodesStateDefinitions({ source, version?, allLevels?, ...IsoCodesFetchOptions })`,
     which returns `{ source, label, version, url, allLevels, definitions }`.

   Export these from the barrel, add them to `test/index.test.ts` and the README `## API` table,
   copy this doc into that repo, and release a minor version.

2. **`simply-plugins` (`simply-settings`)**: in `src/common/loadStateDefinitions.ts`, accept
   `{ file } | { isoCodes: { source, version?, allLevels } }` and return
   `{ definitions, source? }`. Add the three flags (`--iso-codes` with
   `options: ISO_CODES_SOURCE_IDS`) and `exactlyOne` to both commands, log the source line, add
   `source` to both results, and update `messages/*.md` (summaries, descriptions, examples, the
   new errors, and the attribution). Bump `@simplysf/simply-settings-core`, then `pnpm run build`
   (for `command-snapshot.json`), `pnpm run readme` here and in `packages/simply`, and
   `pnpm --filter site run sync`.
3. In 0042, point its "Bundle an ISO 3166-2 dataset" alternative and open question 5 at this doc.

## Testing

**Core (vitest, `undici` `MockAgent`):**

- `subdivisionsToStateDefinitions`: top level by default, everything with `allLevels`, a bad code
  rejected with the existing message, and entries without `parent` kept either way.
- `debian` adapter: the version lookup skips non-release tags and errors when there are none, the
  right raw URL for a pinned version, a wrong top-level shape rejected, a 5xx retried, a 404 turned
  into the "no version" error, and a timeout turned into the download error naming the URL.
- `fetchIsoCodesStateDefinitions` dispatches to the registered adapter and reports `source` and
  the resolved `version`.

**CLI:**

- `--file` and `--iso-codes` together, or neither, fail at flag parsing.
- `--iso-codes foo` fails at flag parsing, listing `debian`.
- `--iso-codes-version`/`--all-levels` without `--iso-codes` fail.
- `--iso-codes debian --country FR` hands only FR's top-level definitions to the planner.
- `source` (with `provider: 'debian'`) appears in the JSON for `--iso-codes` and is absent for
  `--file`.

**Live check (manual, once):** run `create --iso-codes debian --country FR --dry-run` against a
real org with no mocks, to confirm the endpoints, proxy handling, and the reported counts. Tests
never hit salsa.debian.org.

## Open questions

1. **Further sources.** Candidates include Unicode CLDR (a permissive license, but ids are a
   lowercased, hyphen-less form of ISO codes, English name coverage is thinner, and the hierarchy
   lives in a separate containment file) and Wikidata (CC0, but coverage and naming vary). Each
   would be its own short design: an adapter, its license check, and its version semantics.
2. **Choosing levels more precisely than top level vs. all levels**, for example
   `--subdivision-type "Metropolitan department"` using `debian`'s `type` field. This is deferred
   until someone needs a level other than those two, and until it's clear whether other sources
   could support it.
3. **Availability of salsa.debian.org.** It has no SLA. If outages turn out to matter in practice,
   options include a mirror fallback inside the `debian` adapter or the cache described above.
   `--file` is always the fallback.
4. **An export command** (`state list --iso-codes debian > states.json`) for teams that want to
   review and commit their own curated file. This would be a separate design if wanted.
