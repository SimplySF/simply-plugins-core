# Contributing to @simplysf/simply-settings-core

State and Country/Territory picklist automation: creating states through Setup and activating them via AddressSettings. This package is part of the [`simply-plugins-core`](https://github.com/SimplySF/simply-plugins-core) monorepo.

**Start with the [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md).** It covers repository structure, environment setup, commit conventions, versioning and publishing, CI, git hooks, and the pull request process — all of which apply here. This file covers only what is specific to this package.

## Working on this package

Run from this directory to target just this package:

```sh
pnpm run build       # compile + lint
pnpm test            # the full gate CI runs
pnpm run test:only   # just the unit tests, skipping lint and the doc gates
pnpm run lint
```

## This is a library, not a CLI plugin

There are no commands, no `command-snapshot.json`, and no `messages/` help text here. Unlike `@simplysf/simply-core` and `@simplysf/simply-report`, which are internal to this monorepo and only happen to be published as a side effect of the release process, `@simplysf/simply-settings-core` is meant to be usable directly by projects outside this repo too (e.g. editor tooling or a CI script that wants the same logic without shelling out to the `sf` CLI). Hold its README, versioning, and dependency footprint to that bar.

## Screen-scraping Setup

`createState` drives a Visualforce Setup page, not an API, because Salesforce offers no API that creates states. That makes `test/address/fixtures/*.html` the contract with Salesforce. When Salesforce changes the _Configure New State_ page, the symptom is `createState` reporting `Setup form layout not recognized` (from `parseNewStateForm`), or `Unrecognized response from Setup` (from `classifyNewStateResponse`). To fix either:

1. Capture the page or response from a real org, and scrub the view-state values and any org or user ids.
2. Replace the fixture with the capture, and adjust the parser or classifier until the tests pass again.

Match fields only by their stable id suffixes (`:editName`, `:editIsoCode`, `:editIntVal`, `:addButton`). Never match on Visualforce's generated `j_id` segments.
