# Contributing to @simplysf/simply-flow-core

Flow deactivation/deletion and obsolete Flow version pruning logic. This package is part of the [`simply-plugins-core`](https://github.com/SimplySF/simply-plugins-core) monorepo.

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

There are no commands, no `command-snapshot.json`, and no `messages/` help text here. Unlike `@simplysf/simply-core` and `@simplysf/simply-report` — which are internal to this monorepo and only happen to be published as a side effect of the release process — `@simplysf/simply-flow-core` is meant to be usable directly by projects outside this repo too (e.g. an MCP server or a CI script that wants the same logic without shelling out to the `sf` CLI). Hold its README, versioning, and dependency footprint to that bar.
