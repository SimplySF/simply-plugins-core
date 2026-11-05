# Contributing to @simplysf/simply-project-core

Logic for maintaining a Salesforce DX project's repository, such as rolling release branches forward. This package is part of the [`simply-plugins-core`](https://github.com/SimplySF/simply-plugins-core) monorepo.

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

There are no commands, no `command-snapshot.json`, and no `messages/` help text here. The
`sf simply project` commands that call into this package live in
[`@simplysf/simply-project`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-project).
Like `@simplysf/simply-schema-core`, this package is meant to be usable directly outside this
monorepo too. Hold its README, versioning, and dependency footprint to that bar.

## Tests run real git

`test/release/rollForward.test.ts` builds temporary repositories with a bare remote and runs real
`git` against them, because the guarantees are about git's behavior. It needs `git` on the `PATH`,
and clears inherited `GIT_*` variables so it still works when run from inside a git hook.
