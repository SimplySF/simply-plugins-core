# Contributing

Thanks for your interest in contributing to Simply! This document covers the repo structure, how to get set up, and how to submit changes.

1. Please read our [Code of Conduct](CODE_OF_CONDUCT.md).
2. Create a new issue before starting significant work so we can keep track of what you're trying to add or fix, offer suggestions, and avoid duplicate effort.
3. Fork this repository.
4. [Set up your environment](#setup) and make sure you can build and test the affected package(s) locally.
5. Create a topic branch in your fork.
6. For a new command, a user-visible flag/output/error change, or a new shared module, write a design document in [`docs/design/`](docs/design/README.md) and get it agreed on before you start implementing.
7. Make your change, following the [commit message format](#commit-messages) below.
8. Write tests for your change. No pull request will be accepted without tests covering the change.
9. Open a pull request against `main`. We'll review your code, suggest any needed changes, and merge it in.

## Repository Structure

This repository is a Lerna monorepo containing twelve framework-independent libraries — no Salesforce
CLI plugins live here anymore (see [`simply-plugins`](https://github.com/SimplySF/simply-plugins) for
those, and [docs/design/0026](docs/design/0026-split-simply-node-simply-plugins-repos.md) for why).
Every package has its own `CONTRIBUTING.md` covering what's specific to it — read this file first,
then that one.

| Package                                                                     | Description                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@simplysf/simply-core`](packages/simply-core)                             | Shared internal library                                                                                                                                                                                                                                                |
| [`@simplysf/simply-report`](packages/simply-report)                         | Shared HTML report scaffolding                                                                                                                                                                                                                                         |
| [`@simplysf/simply-aep-core`](packages/simply-aep-core)                     | AT4DX binding scan/resolve library — meant for direct use outside this monorepo too                                                                                                                                                                                    |
| [`@simplysf/simply-document-core`](packages/simply-document-core)           | Change report/technical design document rendering library — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                                     |
| [`@simplysf/simply-apex-core`](packages/simply-apex-core)                   | Apex execute/log-purge/trace-flag library — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                                                     |
| [`@simplysf/simply-permissions-core`](packages/simply-permissions-core)     | Permission set XML and permissions report rendering — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                                           |
| [`@simplysf/simply-sobject-core`](packages/simply-sobject-core)             | Field history object derivation/filtering and relationship-field discovery — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                    |
| [`@simplysf/simply-community-core`](packages/simply-community-core)         | Community publish/deploy/domain-verification logic and site-file discovery — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                    |
| [`@simplysf/simply-data-core`](packages/simply-data-core)                   | Content Version upload/download and CSV row counting logic — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                                    |
| [`@simplysf/simply-package-core`](packages/simply-package-core)             | Package/package-version alias resolution, `sfdx-project.json` dependency management, package dependency installation, and Dev Hub version lookup — like `simply-aep-core`, meant for direct use outside this monorepo too                                              |
| [`@simplysf/simply-schema-core`](packages/simply-schema-core)               | sObject schema generation (CSV/Excel parsing, field/object normalization) and interactive schema-report rendering — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                             |
| [`@simplysf/simply-project-setup-core`](packages/simply-project-setup-core) | Salesforce DX project file/dependency standardization engine (template packs, `.gitignore` composition, `package.json` scripts/dependency merging) — like `simply-aep-core`, meant for direct use outside this monorepo too, and ships no templates/presets of its own |
| [`@simplysf/simply-cicd-core`](packages/simply-cicd-core)                   | ALM issue linking (Jira, GitLab Issues) and VCS API clients (GitHub, GitLab) — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                                                                  |
| [`@simplysf/simply-settings-core`](packages/simply-settings-core)           | State and Country/Territory picklist automation: create states through Setup and activate them via AddressSettings — like `simply-aep-core`, meant for direct use outside this monorepo too                                                                            |

Every package here is consumed by one or more plugins over in `simply-plugins`, as an ordinary
published npm dependency — there is no workspace-protocol link between the two repos. A change to a
public API here (a new export, a changed function signature, a changed return shape) is effectively
a cross-repo contract change: see [Pull Requests](#pull-requests) below.

There's also a top-level [`site/`](site) directory — the [Astro Starlight](https://starlight.astro.build/) documentation site, deployed to GitHub Pages. It's part of the pnpm workspace (so `pnpm install` at the root sets it up too), but it's not a `packages/*` entry, so Lerna never versions, publishes, or runs `build`/`test`/`lint` scripts against it. See [Documentation Site](#documentation-site) below for how to work on it.

Tooling:

- **Package manager:** pnpm workspaces
- **Task orchestration:** Lerna v10 (independent versioning) + Wireit (per-package build caching)
- **Language:** TypeScript (ESM)
- **Node:** ^22.13.0 || ^24.0.0 || ^26.0.0 (required by Lerna 10; the published CLI plugins themselves only require >=22.0.0)

## Setup

This repo pins its pnpm version via the `packageManager` field in `package.json`. Use [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node.js) to install that exact version rather than installing pnpm globally:

```sh
corepack enable
git clone git@github.com:SimplySF/simply-plugins-core.git
cd simply-plugins-core
corepack install   # installs the pnpm version pinned in package.json
pnpm install
pnpm run build
pnpm test
```

`corepack enable` only needs to be run once per machine. After that, Corepack transparently uses whatever version of pnpm is pinned in `package.json`, so every contributor and CI job runs the same version.

`pnpm install` at the root installs and links every workspace package and sets up git hooks automatically via husky.

To try your changes against a real org or an existing script, `pnpm link` the package you're working on into whatever consumes it — including a local checkout of [`simply-plugins`](https://github.com/SimplySF/simply-plugins) if you're validating a change to a plugin-facing API:

```sh
cd packages/simply-core
pnpm link --global
cd ../../simply-plugins/packages/simply-data
pnpm link --global @simplysf/simply-core
```

## Common Commands

Run from the repo root to target all packages:

```sh
pnpm run build       # lerna run build (compile + lint)
pnpm run compile     # lerna run compile
pnpm run lint        # lerna run lint
pnpm run test        # lerna run test
pnpm run test:only   # lerna run test:only
pnpm run format      # lerna run format
pnpm run reset       # clear node_modules, the lockfile, and all wireit/TS/ESLint caches
pnpm run reset:install  # same as reset, then reinstall dependencies
```

Run inside a single package directory to target just that package:

```sh
cd packages/simply-core
pnpm run build
pnpm test
```

## Adding a Dependency

To add a dependency to a specific package:

```sh
pnpm add <package> --filter @simplysf/simply-core
```

To add a root-level devDependency (e.g., a shared build tool):

```sh
pnpm add -w -D <package>
```

## Documentation Site

The [docs site](https://simplysf.github.io/simply-plugins-core/) lives in [`site/`](site) — an [Astro Starlight](https://starlight.astro.build/) site, deployed to GitHub Pages by `.github/workflows/docs.yml` on every push to `main` that touches `site/**` or any package's `src/`, `README.md`, or `package.json`.

```sh
pnpm --filter site run dev     # local preview at http://localhost:4321/simply-plugins-core/
pnpm --filter site run build   # production build to site/dist, run before opening a PR that touches site/
```

Every page under `site/src/content/docs/api/` is generated at build time by the
[`starlight-typedoc`](https://www.npmjs.com/package/starlight-typedoc) integration configured in
`site/astro.config.mjs` — one instance per package, each pointed at that package's `src/index.ts` and
`tsconfig.json`. Nothing under `api/` is hand-edited or committed; if a page is wrong, fix the
exported function/type's JSDoc comment in the package's `src/`, not the generated page. Adding a new
package means adding another `createStarlightTypeDocPlugin()` instance (with its own
non-overlapping `output` path) in `astro.config.mjs`, plus a row in both its `sidebar.Guides` and
`sidebar["API Reference"]` arrays.

Everything under `site/src/content/docs/guides/` is hand-authored — one file per package, with
realistic usage examples pulled from real call sites (in this repo's own tests, or in
[`simply-plugins`](https://github.com/SimplySF/simply-plugins), which consumes every package here).
Keep a guide in sync with a package's public API when you change it: an example that no longer
compiles is worse than no example.

## Commit Messages

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint on commit). This matters beyond style: Lerna uses your commit types during release to decide which packages get versioned and how their `CHANGELOG.md` is generated.

```text
feat: add support for X
fix: correct handling of Y
docs: update README
chore: bump a dependency
```

If your change only affects one package, scope the commit to it, e.g. `feat(simply-core): add chunked bulk query support`.

## Pull Requests

- Keep pull requests focused on a single change where possible.
- If the change has a design document in [`docs/design/`](docs/design/README.md), update it to match what actually shipped, including its `Status` line and its row in the index. A design doc that quietly disagrees with the code is worse than none.
- Make sure `pnpm run build` and `pnpm test` pass before opening the PR. CI runs both across every package; the pre-push hook runs the same checks but scoped to packages changed since the last release tag (see [Git Hooks](#git-hooks)), so a passing push doesn't guarantee a passing PR if your branch touches a root-level config file (e.g. `tsconfig.json`, `eslint.config.mjs`) that no single package's directory reflects.
- Aim for high test coverage on new code.
- Update the relevant package's README (its public API surface, examples) if you changed an exported
  function's signature, behavior, or return shape.
- If the change is to a package also consumed by a plugin in [`simply-plugins`](https://github.com/SimplySF/simply-plugins)
  (i.e. anything except a purely internal change to `simply-core`/`simply-report`), call out in the
  PR description what, if anything, changes for that consumer — a breaking change here needs a
  coordinated version bump on both sides.

## Versioning and Publishing

Versioning uses Lerna's independent mode — each package has its own version and can release separately.

The `release` workflow runs on pushes to `main` and, in a single step, bumps versions, updates each package's `CHANGELOG.md`, creates git tags in the format `@simplysf/simply@<version>`, pushes them, creates a GitHub release per changed package, and publishes each bumped package to npm:

```sh
lerna publish --conventional-commits --create-release github --yes
```

### Prerelease

Push to a `prerelease/**` branch (e.g., `prerelease/my-feature`) to trigger a prerelease, versioned and published the same way:

```sh
lerna publish --conventional-commits --conventional-prerelease --preid dev --create-release github --yes
```

### Recovering a Failed Publish

If a version was tagged and released but npm publish failed for one or more packages (e.g. a registry outage), trigger the `release` workflow manually (`workflow_dispatch`) with the `prerelease` input left blank. This runs `lerna publish from-package --yes`, which compares each package's committed version against what's actually on npm and publishes anything missing, without bumping versions again.

## CI

| Workflow      | Trigger                                                                                        | What it does                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`    | Push to non-main branches                                                                      | Runs `pnpm run build` + `pnpm test` on Linux (lts/_, lts/-1) and Windows (lts/_)                                                                                                        |
| `release.yml` | Push to `main` or `prerelease/**`, or manual dispatch                                          | Runs `pnpm run build` + `pnpm test`, then bumps versions, tags, creates GitHub releases, and publishes to npm in one step (see [Versioning and Publishing](#versioning-and-publishing)) |
| `docs.yml`    | Push/PR touching `site/**` or a package's `src`/`README.md`/`package.json`, or manual dispatch | Builds the docs site, checks for broken internal links, and deploys to GitHub Pages on `main`                                                                                           |

## Git Hooks

| Hook         | Command                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` — runs `prettier --write` on staged files                                       |
| `commit-msg` | `commitlint` — enforces conventional commit format                                            |
| `pre-push`   | `lerna run build --since --include-dependents && lerna run test --since --include-dependents` |

`pre-push` only builds/tests packages changed since the last release tag (plus their transitive
dependents) to keep the hook fast locally — CI (`test.yml`) always runs `pnpm run build` + `pnpm test`
across every package, so nothing changed here reduces what actually gates a merge.

Hooks are installed automatically on `pnpm install` via the `prepare: husky` script.

## Reporting Issues

Please report bugs or request features by [opening an issue](https://github.com/SimplySF/simply-plugins-core/issues) rather than submitting a PR without prior discussion for anything non-trivial.
