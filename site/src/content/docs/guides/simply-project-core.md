---
title: simply-project-core
description: Usage examples for @simplysf/simply-project-core.
---

Logic for maintaining a Salesforce DX project's repository, run by a person from a local clone
rather than by a pipeline. It cuts release branches and rolls them forward. Full signatures and
types are in the [API reference](/api/simply-project-core/readme/).

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

## Cutting a release branch

`createRelease` creates the next release branch on the remote, such as `release/v1.3.0` from
`release/v1.2.0`. It starts from the remote's copy of the source, never from local commits, and
commits one version bump to `sfdx-project.json`: `versionNumber` becomes `1.3.0.NEXT`, and the
version inside `versionName` is replaced in place. The commit runs the repository's hooks, and the
push never forces.

```ts
import { createRelease } from '@simplysf/simply-project-core';

const plan = await createRelease({ type: 'minor', dryRun: true });
console.log(`${plan.source} -> ${plan.branch}`);

await createRelease({ type: 'minor', confirm: async () => true });
```

A version that already has a branch is refused, under either label shape (`release/1.3` or
`release/v1.3.0`). A `patch` on an older line is allowed while newer releases exist, for hotfixes.

### Publishing the release and setting the default branch

With `createRelease: true`, it first publishes a GitLab or GitHub release for the version being
closed out. The release is published from the highest `v1.2.0.<build>` tag that is reachable from the
source and on the remote, and fallback tags are skipped. `releaseTag` picks a tag instead. With
`setDefault: true`, the new branch becomes the project's default after the push. `resolveReleaseVcs`
builds the provider from flags, `SIMPLY_VCS_*`, and `.sfdevrc.json`, and throws on a missing project
ID or token before anything changes.

```ts
import { createRelease, resolveReleaseVcs } from '@simplysf/simply-project-core';

const result = await createRelease({
  type: 'minor',
  createRelease: true,
  setDefault: true,
  vcs: resolveReleaseVcs({ token: process.env.SIMPLY_VCS_TOKEN }),
});
console.log(result.release?.status, result.release?.webUrl); // 'Created' or 'Already exists'
```

### When a hook rejects the commit

Nothing is pushed. The result's status is `Commit rejected`, with the hook's output in `commitError`,
and the bump is left staged on the new local branch. Commit it with an accepted message, then call
`createRelease` again from that branch: it finds the branch it was cut from and finishes the push. A
release that was already published is reported as `Already exists`.
