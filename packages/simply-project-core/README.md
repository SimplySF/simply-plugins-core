# @simplysf/simply-project-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-project-core?label=@simplysf/simply-project-core)](https://npmjs.com/@simplysf/simply-project-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-project-core.svg)](https://npmjs.com/@simplysf/simply-project-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Logic for maintaining a Salesforce DX project's repository, run by a person from a local clone
rather than by a pipeline. It backs the `sf simply project` commands in
[`@simplysf/simply-project`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-project).

Its first module rolls release branches forward: it merges each release branch into the next higher
one, such as `release/v1.1.0` into `release/v1.2.0`, with a real merge commit, so the source's
version tags stay in the target's history while the target keeps its own package identity in
`sfdx-project.json`. See
[docs/design/0057-project-release-roll-forward.md](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0057-project-release-roll-forward.md)
for the reasoning.

## Install

```bash
npm install @simplysf/simply-project-core
```

Requires Node.js `>=22`, `git` on the `PATH`, and either `"type": "module"` or a dynamic `import()` —
this package ships ESM only.

## Usage

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
