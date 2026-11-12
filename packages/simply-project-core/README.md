# @simplysf/simply-project-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-project-core?label=@simplysf/simply-project-core)](https://npmjs.com/@simplysf/simply-project-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-project-core.svg)](https://npmjs.com/@simplysf/simply-project-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Logic for maintaining a Salesforce DX project's repository, run by a person from a local clone
rather than by a pipeline. It backs the `sf simply project` commands in
[`@simplysf/simply-project`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-project).

It has two release-branch modules:

- **`rollForward`** merges each release branch into the next higher one, such as `release/v1.1.0`
  into `release/v1.2.0`, with a real merge commit, so the source's version tags stay in the target's
  history while the target keeps its own package identity in `sfdx-project.json`. See
  [design doc 0057](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0057-project-release-roll-forward.md).
- **`createRelease`** cuts the next release branch, such as `release/v1.3.0` from `release/v1.2.0`,
  with its version bumped in `sfdx-project.json`. It can also publish a GitLab or GitHub release for
  the version being closed out, and make the new branch the project's default. See
  [design doc 0061](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0061-project-release-create.md).

## Install

```bash
npm install @simplysf/simply-project-core
```

Requires Node.js `>=22`, `git` on the `PATH`, and either `"type": "module"` or a dynamic `import()` —
this package ships ESM only.

## Rolling release branches forward

```ts
import { rollForward } from '@simplysf/simply-project-core';

// Show the plan, and the tags each merge would bring in, without changing anything.
const plan = await rollForward({ dryRun: true });

// Roll the whole chain, asking once before anything changes.
const result = await rollForward({
  message: 'chore: PROJ-123 roll {SOURCE} into {TARGET}',
  confirm: async (hops) => hops.length < 3,
});

for (const hop of result.hops) {
  console.log(hop.source, '->', hop.target, hop.status, hop.tags);
}
```

| Option                       | Default                                 | Meaning                                                                  |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `source`                     | lowest branch with work to roll         | Oldest release branch to roll from.                                      |
| `target`                     | highest release branch                  | Newest release branch to roll into.                                      |
| `packageReleaseBranchPrefix` | `release/`                              | Prefix identifying release branches, named `[v]MAJOR.MINOR[.PATCH]`.     |
| `remote`                     | `origin`                                | Remote holding the release branches. Must be a configured remote.        |
| `dryRun`                     | `false`                                 | Plan only.                                                               |
| `noPush`                     | `false`                                 | Stop after the first merge, leaving it on its `roll-forward/...` branch. |
| `message`                    | `Merge branch '{SOURCE}' into {TARGET}` | Commit message template.                                                 |
| `confirm`                    | none                                    | Called once with the pending hops; returning `false` changes nothing.    |
| `cwd`                        | `process.cwd()`                         | Any directory inside the repository.                                     |

Each hop in the result has a `status` of `Rolled`, `Up to date`, `Conflict`, `Commit rejected`,
`Merged, not pushed`, `Would roll`, or `Not started`. A `Conflict` or `Commit rejected` hop leaves the
merge in progress on its roll branch; resolve or commit it by hand, then call `rollForward` again to
continue. The function never force-pushes or pushes tags, and always runs the repository's commit
hooks.

## Cutting a release branch

```ts
import { createRelease, resolveReleaseVcs } from '@simplysf/simply-project-core';

// Cut release/v1.3.0 from the current release branch, as the remote has it.
const result = await createRelease({ type: 'minor' });

// Also publish a release for v1.2.0 and make the new branch the default. The project ID and host
// come from SIMPLY_VCS_* or .sfdevrc.json's `vcs` section.
await createRelease({
  type: 'minor',
  source: 'release/v1.2.0',
  createRelease: true,
  setDefault: true,
  vcs: resolveReleaseVcs({ token: process.env.SIMPLY_VCS_TOKEN }),
  confirm: async (plan) => plan.branch === 'release/v1.3.0',
});
```

| Option                       | Default                            | Meaning                                                                 |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `type`                       | required                           | `major`, `minor`, or `patch`.                                           |
| `increment`                  | project setting, else `1`          | How far `type`'s part of the version moves. See below.                  |
| `source`                     | current branch                     | Release branch to cut from. Must exist on the remote.                   |
| `packageReleaseBranchPrefix` | `release/`                         | Prefix identifying release branches, named `[v]MAJOR.MINOR[.PATCH]`.    |
| `remote`                     | `origin`                           | Remote holding the release branches. Must be a configured remote.       |
| `message`                    | `chore: bump version to {VERSION}` | Commit message template.                                                |
| `createRelease`              | `false`                            | Publish a platform release for the source's version first. Needs `vcs`. |
| `releaseTag`                 | latest pushed build tag            | The tag to publish from. Implies `createRelease`.                       |
| `setDefault`                 | `false`                            | Make the new branch the project's default after pushing. Needs `vcs`.   |
| `vcs`                        | none                               | `{ provider, project }`, usually from `resolveReleaseVcs`.              |
| `dryRun`                     | `false`                            | Plan only.                                                              |
| `confirm`                    | none                               | Called once with the planned result; returning `false` changes nothing. |
| `cwd`                        | `process.cwd()`                    | Any directory inside the repository.                                    |

The new branch starts from the remote's source, never from local commits, and its `versionNumber`
becomes `<version>.NEXT` in every package directory on the source's version. The version inside each
`versionName` is replaced in place. The release is published from the highest `v<version>.<build>`
tag that is reachable from the source and on the remote, skipping fallback tags. The result's
`status` is `Created`, `Would create`, `Commit rejected`, or `Declined`. If a hook rejects the commit,
nothing is pushed: commit by hand on the new branch, then call `createRelease` again from there to
finish.

A project that numbers its releases in larger steps declares them in `sfdx-project.json`, read from
the remote's copy of the source branch (so each new branch carries the setting forward):

```json
{ "plugins": { "simply": { "release": { "increments": { "minor": 10 } } } } }
```

With that, a `minor` release of `release/v1.20.0` is `release/v1.30.0`. The parts below the bumped
one still reset to 0. The `increment` option overrides the setting, and `readReleasePluginConfig`
reads and validates it on its own. Each increment must be a whole number of at least 1.
