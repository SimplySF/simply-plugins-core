# 0052 — `simply package dependencies clone`

**Status:** In progress (implemented on `feat/package-dependencies-clone` in both repos; unreleased)
**Package:** `packages/simply-package-core` (library); `packages/simply-package` (CLI, in
`simply-plugins`, where this doc is duplicated as its 0056)
**Date:** 2026-10-23

## Problem

A package's `sfdx-project.json` says what it depends on (`packageDirectories[].dependencies`), but
only as package aliases and IDs. Those resolve to versions in a Dev Hub or an org, not to source
code. A developer who wants to review the full set of metadata a project relies on, such as the
objects, Apex, and permission sets its dependencies contribute, has to find each dependency's
repository by hand, clone it, check out roughly the right version, and then repeat that for the
dependency's own dependencies.

Nothing in the project records where a dependency's source lives. That's the missing piece. With it
in place, cloning becomes a mechanical loop.

`sf simply package dependencies install` already exists, and "install" there means installing
package versions into an org. This feature never touches an org, so it gets a different verb:
**clone**.

## Decision

1. **Record each dependency's repository in `sfdx-project.json`** under
   `plugins.simply.packages`, a map from package alias to that package's settings. A `repository`
   in an entry gives a git URL and, optionally, a ref and a subdirectory. Any git host works (GitHub, GitLab.com, self-managed
   GitLab, GitHub Enterprise, Bitbucket, Azure DevOps), because the value is only a URL passed to
   `git clone`.
2. **Add `clonePackageDependencies(options)` to `@simplysf/simply-package-core`.** It resolves each
   dependency to its repository entry and clones or updates it into a folder next to the project.
   With `recursive`, it then follows each clone's own `sfdx-project.json`.
3. **Add `sf simply package dependencies clone`** to `simply-package` as a thin command over that
   function, next to `install` and `manage`.

We considered putting the field on each dependency entry, which was the first idea. It was
rejected for the reasons under [Alternatives considered](#alternatives-considered): Salesforce's
packaging library forwards unknown dependency keys to the server.

## Behavior

### Project configuration

```jsonc
{
  "packageDirectories": [
    {
      "path": "force-app",
      "package": "my-app",
      "versionNumber": "2.4.0.NEXT",
      "dependencies": [
        { "package": "fflib-apex-common@3.0.0-1" },
        { "package": "my-core", "versionNumber": "1.8.0.LATEST" },
        { "package": "SomeAppExchangePackage@5.2" },
      ],
    },
  ],
  "plugins": {
    "simply": {
      "packages": {
        "fflib-apex-common": {
          "repository": {
            "url": "https://github.com/apex-enterprise-patterns/fflib-apex-common.git",
            "ref": "v3.0.0",
          },
        },
        "my-core": {
          "repository": {
            "url": "git@gitlab.example.internal:salesforce/my-core.git",
            "ref": "main",
            "path": "sfdx-source",
          },
        },
      },
    },
  },
}
```

| `repository` field | Type     | Required | Meaning                                                                                                                                                                                                                                                                                                      |
| ------------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`              | `string` | yes      | Anything `git clone` accepts: `https://…`, `ssh://…`, `git@host:group/repo.git`, or a local path. The host doesn't matter.                                                                                                                                                                                   |
| `ref`              | `string` | no       | Branch, tag, or commit SHA to check out. A ref of 7 to 40 hex characters is treated as a SHA only when the remote has no branch or tag by that name. If it's omitted, the clone uses the remote's default branch. It must be a valid git ref name, and can't start with `-`.                                 |
| `path`             | `string` | no       | Subdirectory of the repository where its `sfdx-project.json` lives, for monorepos that hold several packages. The default is the repository root. The clone still contains the whole repository. `path` only tells `--recursive` where to look for the next project file. It must be relative, with no `..`. |

An entry is keyed by package, not by feature, so settings for one package stay together. Only
`repository` exists today. Other keys in an entry are kept and ignored, so later settings can sit
beside it without older versions rejecting the file. An entry without a `repository` is treated as
no mapping.

**Credentials never go in this file.** The command runs the user's own `git`, so it uses whatever
that `git` already has: SSH keys, a credential helper, `gh auth`/`glab auth`, or a corporate
proxy. A `url` that contains userinfo (`https://user:token@…`) is rejected with an error, so that
nobody commits a token to the file by mistake.

### Security

Cloning is for review, not installation. Unlike `npm install`, which runs each package's install
scripts, this command runs nothing from a dependency's repository. git doesn't clone a
repository's hooks or config, submodules aren't fetched, and the cloned `sfdx-project.json` is
only parsed as JSON. The risk starts when someone acts on a clone: opens it in an editor and trusts
the workspace, runs `npm install` or its scripts, or deploys its metadata to an org. The command's
help says so.

Every git command runs the same guarded way:

- Without a shell, with `--` before the URL, and with `GIT_TERMINAL_PROMPT=0`, so a missing
  credential fails that row at once instead of waiting for input nobody can see. For the same
  reason ssh runs with `-o BatchMode=yes`, so an unknown host key or a key passphrase fails the row
  rather than prompting behind the spinner (or hanging CI). That's skipped when the developer has
  set `GIT_SSH_COMMAND`, `GIT_SSH`, or `core.sshCommand`.
- With `protocol.ext.allow=never`, because `ext::` URLs run arbitrary commands.
- With `submodule.recurse=false` and `fetch.recurseSubmodules=false`. These override the
  developer's own git config, which could otherwise turn submodules on for the `checkout`,
  `fetch`, and `merge` that `--update` runs. Most of git's own clone-time vulnerabilities, such as
  CVE-2024-32002, go through submodules.

The config is checked before it's used. A `ref` must be a valid git ref name that doesn't start
with `-`, so it can't be read as an option. A `path` must be relative and stay inside the
repository. A `url` can't carry credentials (above). Folder names taken from URLs are reduced to
safe characters.

**Whose URLs are used.** A Salesforce package build needs the project to list its whole dependency
hierarchy, so the root project's `dependencies` already name every transitive package, and the
root's map can give each of them a repository. The root's entry is therefore always used first,
however the dependency's project names the package: the root's map is looked up through the root's
`packageAliases`, through the ID the dependency's own `packageAliases` give, and through the
dependency's aliases themselves. A dependency's own project file supplies a URL only for a package the root doesn't map. That URL is
someone else's input, so:

- Only `https://`, `ssh://`, and scp-like `git@host:path` URLs are followed from it. A local path,
  `file://`, `http://`, or `git://` URL makes that row `Failed`, naming the project file it came
  from. git also runs that repository's commands with only the `https` and `ssh` protocols
  allowed, which covers redirects.
- The run prints a line naming the package and the project file the URL came from, and suggests
  adding the package to the root's map to choose its repository there.

**Branches move.** Leaving `ref` out (the remote's default branch) or naming a branch is the usual
case, and it's fine for review, but a later `--update` brings in whatever is newest. After a run,
one informational line lists the clones that are on a branch and says that a tag as `ref` keeps
them on one version. It's a note, not a warning, because following the default branch is expected.
A tag is the normal way to pin. A commit SHA works too, but nothing asks for one.

### Matching a dependency to an entry

`dependencies manage` rewrites a dependency's `package` value from one version alias to the next
(`fflib-apex-common@3.0.0-1` → `fflib-apex-common@3.1.0-2`). An entry keyed by the exact value would
stop matching after that rewrite, so lookup goes in this order:

| Order | The dependency's `package` value…              | …matches the key                                                   |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------ |
| 1     | exactly                                        | `fflib@3.0.0-1`                                                    |
| 2     | up to its first `@` (the version-alias prefix) | `fflib`                                                            |
| 3     | resolved through `packageAliases` to an ID     | `0Ho…` or `04t…`, or any other alias (or alias prefix) for that ID |

Steps 1 and 2 cover every alias that `sf package version create` and `dependencies manage` write.
Step 3 is for projects whose dependencies are bare IDs: a dependency written as `04t…` still
matches a `my-core` key when `packageAliases` maps `my-core@1.8.0-3` to that ID.

A dependency with no matching entry is reported as `No repository` and skipped. That's normal for
managed packages from AppExchange, whose source isn't available. It isn't an error. A dependency
listed in `plugins.simply.dependencies.ignore` is skipped too, which matches how `manage` treats
that list.

### Command

```
sf simply package dependencies clone [--output-dir <dir>] [--recursive] [--depth <n>]
                                     [--update] [--dry-run] [--json]
```

| Flag           | Default                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--output-dir` | `..` (the project's parent) | Directory, relative to the project root, that receives one clone per repository, at `<output-dir>/<repo>`. `<repo>` is the last segment of the URL without `.git`, so `fflib-apex-common.git` clones to `../fflib-apex-common`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--recursive`  | off                         | Also clone the dependencies of each dependency, following each clone's `sfdx-project.json`. Without it, only this project's direct dependencies are cloned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--depth`      | full history                | Passed to `git clone --depth`. `1` gives a fast, shallow review copy. A shallow clone can't check out a SHA that isn't the tip of a branch, so a shallow clone with a SHA `ref` falls back to a full clone of that repository and prints a warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--update`     | off                         | For a repository that's already cloned, run `git fetch` and bring it to `ref`: a fast-forward when it's on the `ref` branch, or a fresh checkout when HEAD is detached (as it is after cloning a tag or SHA). Without this flag, an existing clone is left as it is (`Already cloned`). A clone with uncommitted changes is never touched (`Dirty, skipped`), and neither is one on some other branch (`On other branch, skipped`, naming the branch), because a sibling folder may be the developer's own working copy. The exception is a clone still on the remote's default branch with no commits of its own, as one made before `ref` was set is: it moves to `ref`, whether that names a branch, a tag, or a SHA. |
| `--dry-run`    | off                         | Resolve and print the plan, but don't run `git`. A folder that already exists is reported as `Already cloned` without checking its remote. With `--recursive`, the plan follows only folders already on disk, because the other dependencies' project files aren't there yet.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Clones go **next to** the project, not inside it, so they stay out of the project's git status,
editor searches, linters, and test runners, and need no `.gitignore` entry. This also matches the
usual layout of a multi-repo workspace. If the developer already has a dependency checked out there
from the same remote, the command reuses that checkout (`Already cloned`) rather than cloning again.

### Recursion and conflicts

By default only direct dependencies are cloned. The deduplication and conflict rules below still
apply then, because two package directories in one project can depend on the same repository.

- With `--recursive`, the command walks breadth-first from the root project. Each clone's
  `<clone>/<path>/sfdx-project.json` is read for its own `dependencies` and `plugins.simply.packages` map.
  When a clone has no project file, it's a leaf, and an unreadable or invalid one is a warning,
  not an error. The root project's map comes first, and a dependency's own map fills in for
  packages the root doesn't map (see [Security](#security)).
- **A repository is deduplicated by normalized URL** (lowercased host, with `.git` and any
  trailing `/` removed, and `git@host:x` treated the same as `ssh://git@host/x`). A diamond
  dependency is cloned once. A different package whose entry names the same repository (another
  package directory of a monorepo, with its own `path`) still gets its own row, with the first
  row's status, and with `--recursive` its own `path` is followed.
- **The root project's own repository** counts as visited from the start (its `origin`, read with
  git, so not under `--dry-run`). A dependency that maps a package back to it gets an
  `Already cloned` row naming the project's folder, and the project is never cloned beside itself,
  fetched, or merged.
- **The same repository reached with two different refs** is cloned once, at the ref found nearest
  the root (breadth-first order makes that deterministic). The conflict is printed as a warning that
  names both paths. One working tree per repository keeps the parent folder readable.
- **Two different repositories with the same folder name** (`github.com/a/core` and
  `gitlab.example.internal/b/core`) are both cloned. The second folder is prefixed with the URL's group or owner (`../b-core`),
  and a warning is printed. A URL with no group segment gets `<repo>-2` instead. If that name
  is taken too, a numeric suffix (`../b-core~2`) is the last resort.
- Cycles end naturally, because a URL that's already been visited is never queued again.

### Output

A table with one row per dependency, in the order they were visited. A row with no ref or no directory leaves that cell empty:

```
KEY                 REF      STATUS          VIA                    DIRECTORY
fflib-apex-common   v3.0.0   Cloned          my-app                 ../fflib-apex-common
my-core             main     Already cloned  my-app                 ../my-core
at4dx               master   Cloned          my-core                ../at4dx              (--recursive)
SomeAppExchange…             No repository   my-app
```

The possible statuses are `Cloned`, `Updated`, `Already cloned`, `Dirty, skipped`, `On other branch, skipped`,
`No repository`, `Ignored`, `Failed` (with the git error), and `Would clone` (with `--dry-run`).
`--json` returns the same rows as an array. The command exits non-zero only if a row is `Failed`.

### Errors

| Condition                                                   | Result                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `git` isn't on `PATH`                                       | Error before any work is done: `GitNotFoundError`.                                                       |
| A `repository` is missing `url`, or has a non-string field  | Error before any work is done, naming the key: `InvalidRepositoryConfigError`.                           |
| A `ref` isn't a valid ref name, or a `path` leaves the repo | The same `InvalidRepositoryConfigError`, or for a dependency's file, a warning and no recursion into it. |
| A dependency's file gives a URL that isn't `https` or `ssh` | That row is `Failed`, naming the file, and the run continues.                                            |
| A `url` contains credentials                                | Error before any work is done, naming the key: `CredentialsInUrlError`.                                  |
| A clone or checkout fails (auth, network, unknown ref)      | That row is `Failed`, the run continues, and the exit code is non-zero.                                  |
| `<output-dir>/<repo>` exists but isn't a clone of that URL  | That row is `Failed` with "directory exists and is not a clone of …". Nothing is overwritten.            |

## Alternatives considered

**A `repository` field on each dependency entry.** This was the first proposal, and it reads most
naturally:

```json
{ "package": "fflib-apex-common@3.0.0-1", "repository": { "url": "https://github.com/…" } }
```

Salesforce's schema accepts it. `@salesforce/core`'s `PackageDirDependencySchema` is
`.catchall(z.unknown())`, so VS Code and `SfProject` don't complain. The catch is in
`sf package version create`. In `@salesforce/packaging` (4.27.8),
`resolveSubscriberPackageVersionId()` deletes only `package`, `packageId`, `versionNumber`, and
`branch` from each dependency before the descriptor goes to the server, and
`cleanPackageDescriptorJson()` strips client-only keys at the top level of the package directory
only. So a `repository` key would be uploaded inside every `package2-descriptor.json`. The fact
that the library keeps a list of client-only props to strip suggests the server rejects keys it
doesn't recognize. Nobody has tested it, but breaking every package build in exchange for a
convenience field is a bad trade. The `plugins` block is the place Salesforce reserves for this
kind of data (`"CLI Plugins custom settings"`, `additionalProperties: {}`), and this repo already
keeps `plugins.simply.dependencies.ignore` there.

If a scratch-org test shows the server ignores unknown dependency keys, inline entries could be
accepted as well, ahead of the map in the lookup order. That would be a backward-compatible
addition.

**A feature-keyed map, `plugins.simply.dependencies.repositories`.** This was the first version
of this design: a map from package alias straight to repository, next to the existing
`plugins.simply.dependencies.ignore`. In review it was changed to `plugins.simply.packages`,
keyed by package with `repository` as one setting. A package-keyed map gives each package one
place for everything simply knows about it, so a later per-package setting adds a key to an
existing entry instead of a second map keyed by the same aliases. `ignore` stays where it is,
because `dependencies manage` already reads it and it's a list, not per-package settings.

**A host allow-list for URLs from dependencies' files** (for example
`plugins.simply.dependencies.allowedHosts`). Because the root project already lists every
transitive dependency, it can map every one of them itself, which is a stronger control than a
host list. Limiting those URLs to `https` and `ssh` and naming where each came from covers the rest
without more configuration. A host list can still be added later without breaking anything.

**Requiring a commit SHA, like a lockfile's integrity hash.** Tags and the default branch are
how Salesforce teams refer to versions, and a review copy doesn't need byte-for-byte
reproducibility. So the command notes branches, and doesn't push anyone toward SHAs.

**Discovering the repository with no configuration.** Package2 records carry no source URL, and
neither do AppExchange listings in any reliable form. Guessing from naming conventions
(`github.com/<org>/<alias>`) would clone the wrong repository silently.

**A separate file such as `.sfdx-dependencies.json`.** It's one more file to keep in sync with
`sfdx-project.json`, and recursion would have to look for two files in every clone. Keeping the
mapping in the project file means a dependency that adopts this convention brings its own
dependencies' map along, which is what makes recursion work.

**Using the GitHub and GitLab APIs instead of `git`.** That needs a token per host type, a client
per host type, and on-prem base-URL configuration, and it only works for those two hosts. Plain
`git` handles every host and reuses credentials the developer already has.

**Cloning recursively by default.** It gives the fullest picture, but one command could fan out
into many repositories, some on hosts the developer can't reach, each with its own credential
prompt. Cloning only direct dependencies by default is predictable. `--recursive` is one flag away.

**Cloning into a folder inside the project (`.sfdx-dependencies/`).** It would keep everything in one
tree, but every developer would need a `.gitignore` entry. Editor search, ESLint, Jest, and Prettier
would also scan the clones unless each tool was configured to skip them. And a dependency the
developer already has checked out nearby would be cloned a second time.

**A `git worktree` per conflicting ref** (`../core@v2`, `../core@v3`). It reflects every version
depended on exactly, but it multiplies folders for a case that's expected to be rare, and the
warning already names both refs.

**Git submodules.** Submodules would bind dependency versions into the consuming repository's
history, and every developer would pay for them on every clone. This feature is meant for
occasional, on-demand review, so its clones belong in an ignored directory.

**Naming it `dependencies install --source`.** "Install" already means installing into an org in
this plugin. Overloading the word would make `--target-org` and the other install flags meaningless
for one mode of the same command.

## Implementation plan

In `simply-plugins-core`:

1. `packages/simply-package-core/src/schemas/sfdx-project/dependencyRepositories.ts`: a zod
   `DependencyRepositorySchema` (`url`, optional `ref` and `path`), `PackageConfigSchema` (an
   entry, with an optional `repository`), `PackagesConfigSchema` (the map), and the URL
   credential check.
2. `packages/simply-package-core/src/dependencyRepositoryResolver.ts`: the lookup order above, as a
   pure function over the parsed project. It reads the map with `simply-core`'s `getPluginConfig`.
3. `packages/simply-package-core/src/packageDependenciesClone.ts`:
   `clonePackageDependencies({ projectDir, outputDir = '..', recursive = false, depth, update, dryRun, git?, progress? })`
   returns `DependencyCloneResult[]`. `git` is an injectable runner (the default spawns `git` with
   `execFile`, never a shell) so unit tests don't touch the network. The `progress` callback follows
   the `installPackageDependencies` pattern from 0036.
4. Export these from `src/index.ts`, write the README section, and add the guide page
   `site/src/content/docs/guides/simply-package-core.md`.

In `simply-plugins`, after that is published:

5. `packages/simply-package/src/commands/simply/package/dependencies/clone.ts` and
   `messages/simply.package.dependencies.clone.md`.
6. Document `plugins.simply.packages` in the README's `plugins.simply` table, then
   run `pnpm run readme` and `pnpm run build` (for the command snapshot), and regenerate
   `packages/simply`'s README.
7. Bump `@simplysf/simply-package-core` in `packages/simply-package/package.json` to the release
   that ships steps 1–4. Until then, this half compiles only against a local build of that package.

## Testing

- **Resolver unit tests:** exact match, `@`-prefix match, alias-to-ID match, no match, an ignored
  dependency, and a key matched by more than one step (exact wins).
- **Schema unit tests:** a missing `url`, credentials in `https` and `ssh` URLs, and unknown keys
  inside an entry (allowed, for forward compatibility).
- **Clone engine unit tests, with a fake `git` runner:** fresh clone, already cloned, `--update`, a
  dirty tree, a directory that's a clone of a different URL, a failed clone continuing the run,
  URL normalization for deduplication, a ref conflict where the nearest ref wins, a folder-name collision
  producing the group-prefixed name, `--update` on another branch being skipped, reuse of an existing sibling checkout, recursion off by default, a cycle, and a shallow clone with a SHA ref falling back to a full clone.
  Also: two packages in one repository at different `path`s each getting a row and being followed,
  a dependency mapped back to the root's own repository being left alone, a branch or tag named
  like a SHA being cloned as one, and `--update` moving a clean default-branch clone to a tag set
  later (but skipping it once it has commits of its own).
- **Security tests:** the root's entry winning over a dependency's (also when the dependency
  names the package by a bare ID or another alias), ssh running in batch mode unless the user set
  their own ssh command, a local or `http` URL from a
  dependency's file failing its row, an `https` URL from one being cloned with only `https` and
  `ssh` allowed and its source named, the submodule settings on every git command, a ref starting
  with `-` and a `path` with `..` being rejected, and the branch note listing only clones on a
  branch.
- **Integration test against real `git`:** build three throwaway bare repositories on disk (A
  depends on B, B depends on C, and A depends on C at a different tag), point their `url`s at local
  paths, and assert the directory layout, the checked-out refs, and the warning. No network is
  needed.
- **Command NUT:** `--json` output shape and exit codes.

## Open questions

- **Templated refs.** It would be useful to derive `ref` from the dependency's version (for example
  `"ref": "v{MAJOR}.{MINOR}.{PATCH}"` with the same placeholders as `versionTagFormat` in 0040),
  so the clone matches the version actually depended on rather than a hand-maintained tag. A
  `versionNumber` (0Ho dependency) can supply that version without a Dev Hub. A pinned 04t alias
  can only supply it by parsing the `@x.y.z-b` alias text. This is deferred to a follow-up, and
  the literal `ref` stays the v1 contract.

- **A `plugins.simply.packages` JSON Schema fragment** for editor completion. It
  depends on whether we publish schemas at all.
