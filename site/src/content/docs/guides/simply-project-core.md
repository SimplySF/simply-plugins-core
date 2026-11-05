---
title: simply-project-core
description: Usage examples for @simplysf/simply-project-core.
---

Logic for maintaining a Salesforce DX project's repository, run by a person from a local clone
rather than by a pipeline. Its first module rolls release branches forward. Full signatures and types
are in the [API reference](/api/simply-project-core/readme/).

```sh
npm install @simplysf/simply-project-core
```

It runs `git`, so `git` must be on the `PATH`.

## Rolling release branches forward

`rollForward` merges each release branch into the next higher one, such as `release/v1.1.0` into
`release/v1.2.0`. Each merge is a real merge commit with the target as its first parent, so the
source's version tags, like `v1.1.0.13`, stay reachable from the target. The target keeps its own
`versionNumber`, `versionName`, `ancestorVersion`, and `ancestorId` in `sfdx-project.json`, and
`packageAliases` becomes the union of both sides.

```ts
import { rollForward } from '@simplysf/simply-project-core';

const plan = await rollForward({ dryRun: true });
for (const hop of plan.hops) {
  console.log(`${hop.source} -> ${hop.target}: ${hop.status}`, hop.tags);
}
```

Without `dryRun`, it merges and pushes each hop in order. Pass `confirm` to ask once before anything
changes:

```ts
const result = await rollForward({
  message: 'chore: PROJ-123 roll {SOURCE} into {TARGET}',
  confirm: async (hops) => {
    console.log(`About to roll ${hops.length} branches.`);
    return true;
  },
});
```

## When it stops

A hop with status `Conflict` or `Commit rejected` stops the chain, with the merge still in progress
on a `roll-forward/<source>-to-<target>` branch. `conflictedFiles` or `commitError` says why. Resolve
the merge and run `git commit`, then call `rollForward` again: it picks up the finished merge,
verifies it, and carries on.

The function never force-pushes or pushes tags, and always runs the repository's commit hooks. If a
push is rejected because the target moved, it throws, and calling it again makes the merge afresh.

`noPush: true` stops after the first merge and leaves it on the roll branch, for teams that merge
through a merge request. Merge that request with a merge commit, because a squash or rebase loses
the tag history.
