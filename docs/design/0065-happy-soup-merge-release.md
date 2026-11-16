# 0065 — Merging the release merge request after the production close-out

**Status:** In progress (`simply-plugins-core` done; the `simply-plugins` command is next)
**Package:** `packages/simply-core` (VCS provider methods) and `packages/simply-cicd-core` (the
operation and the deploy stage); `packages/simply-cicd` (the command, in `simply-plugins`)
**Date:** 2026-11-16

## Problem

[0063](0063-happy-soup-release-branches.md) has `release create` cut `release/<date>` and open a
draft merge request from it into the production branch. The release pipeline then deploys that
branch tier by tier. On the production tier, `deployment-close-out` archives the deployment config
onto the release branch with a `[skip ci]` commit, and `tag-deployment` tags it.

After that, someone still has to find the merge request, mark it ready, and merge it by hand. Until
they do, the production branch doesn't match what's in the production org, and the next release is
cut from a stale base. The pipeline already knows exactly when that merge is safe, which is right
after the production close-out succeeds.

## Decision

Add a happy-soup deploy stage, **`merge-release`**. The pipeline runs it after the production
`deployment-close-out` job (`needs: [prod-deployment-close-out]`). It finds the release branch's
merge request into the production branch, checks that it contains only what was deployed plus the
close-out commits, marks it ready if it's a draft, and merges it.

It is a stage of its own, not a flag on `deployment-close-out`, for these reasons:

- **Retries.** If the merge fails, for example because an approval is missing, the job can be
  retried without archiving the config again. `deployment-close-out` can't be re-run safely: on a
  second run nothing changes, so `git commit` fails, and the fallback path then _removes_
  `config/deploy.json`. That is a separate bug, listed under open questions.
- **Gating.** "Only after production" is decided by CI `rules:` and `needs:`, the same way every
  other stage is gated per tier (see the GitLab pipeline guide). The library never has to know
  which tier is production.
- **Credentials.** Merging needs an API-scoped token. Close-out only needs write access to the
  repository, and pipelines that don't merge shouldn't have to grant more than that.

## Behavior

### `sf simply cicd deploy happy-soup merge-release`

```bash
sf simply cicd deploy happy-soup merge-release \
  --ci-commit-ref-name "$CI_COMMIT_REF_NAME" --ci-commit-sha "$CI_COMMIT_SHA" \
  --ci-project-path "$CI_PROJECT_PATH" --project-access-token "$PROJECT_ACCESS_TOKEN"
```

| Flag                           | Default                        | Meaning                                                                                          |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `--ci-commit-ref-name`         | required                       | The release branch, which is the merge request's source.                                         |
| `--ci-commit-sha`              | required                       | The commit this pipeline deployed. The merge request may hold only this plus close-out commits.  |
| `--ci-project-path`            | required                       | Addresses the project in the API (`group/project` or `owner/repo`).                              |
| `--project-access-token`       | required                       | Needs `api` scope on GitLab, or `pull_requests: write` and `contents: write` on GitHub.          |
| `--target-branch`              | `productionBranch`             | The merge request's target. The default comes from `config/release.json`.                        |
| `--merge-request-iid`          | found by branches              | Merge this merge request instead of looking one up by source and target branch.                  |
| `--squash`                     | `false`                        | Squash on merge.                                                                                 |
| `--remove-source-branch`       | `false`                        | Delete the release branch after merging (GitLab only). It's kept by default, as 0063 creates it. |
| `--wait`                       | `10` (minutes)                 | How long to wait for the platform to finish computing whether the merge request can merge.       |
| `--vcs-provider`, `--vcs-host` | as the other happy-soup stages | Which platform and instance to talk to.                                                          |
| `--dry-run`                    | `false`                        | Resolve and check everything, then report what would be merged.                                  |

Every flag is also backed by a `SIMPLY_CICD_*` variable, as the other stages' flags are.

Steps, in order:

1. **Find the merge request.** If `--merge-request-iid` is given, fetch it, and fail if its source
   or target branch isn't the expected one. Otherwise, look for the open merge request from
   `--ci-commit-ref-name` into the target branch. If there is no open one but a merged one exists,
   report `Already merged` and exit 0, so a retry after a merge that succeeded is harmless. If
   there is neither, fail.
2. **Check what will merge.** Read the merge request's head SHA and compare it with
   `--ci-commit-sha` through `compareRefs`. Every commit between the two must be one written by
   `deployment-close-out` (`Archiving deploy.json [skip ci]` or
   `Removing obsolete config/deploy.json [skip ci]`). If anything else was pushed to the release
   branch while the pipeline ran, it never reached production, so the stage fails without merging
   and names the unexpected commits. If the head isn't a descendant of the deployed commit at all,
   it fails the same way.
3. **Mark it ready.** If the merge request is a draft, mark it ready: GitLab drops the `Draft:`
   title prefix, and GitHub uses the `markPullRequestReadyForReview` GraphQL mutation, since GitHub
   has no REST endpoint for it.
4. **Wait until the platform can tell if it's mergeable.** Both platforms work this out in the
   background after a push. Poll every 10 seconds for up to `--wait` minutes. On GitLab, poll until
   `detailed_merge_status` stops being `checking`, `unchecked`, `preparing`, `approvals_syncing`, or
   `ci_still_running`; the stage asks with `with_merge_status_recheck=true` so the status isn't
   stale. On GitHub, poll until `mergeable` stops being `null`. Right after a draft is marked ready,
   a `draft` status counts as still checking, because the platform can report the draft it just
   cleared.
5. **Merge,** passing the head SHA checked in step 2 (GitLab `sha`, GitHub `sha`). If the branch
   moves in between, the platform refuses the merge instead of merging unchecked commits.
6. **Report:**
   `{ mergeRequest: { iid, webUrl, title }, status, headSha, mergeCommitSha?, closeOutCommits[], warnings[] }`,
   where `status` is `Merged`, `Would merge`, or `Already merged`.

If the merge request can't be merged, the error gives the platform's reason in plain words, along
with what to fix:

| Platform reason                                 | Message points at                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GitLab `not_approved`, GitHub review required   | The approvals still missing. The stage does not approve its own merge request.             |
| GitLab `ci_must_pass`, GitHub required checks   | The close-out commit is `[skip ci]`, so it has no pipeline. See below.                     |
| GitLab `conflict`/`need_rebase`, GitHub `dirty` | Production moved since the release was cut. Merge it into the release branch and redeploy. |
| GitLab `discussions_not_resolved`               | Unresolved threads on the merge request.                                                   |
| Anything else                                   | The raw status, plus the merge request's URL.                                              |

### The `[skip ci]` close-out commit and required pipelines

The merge request's head is the close-out's `[skip ci]` commit, and that commit never runs a
pipeline. With GitLab's **Pipelines must succeed** setting turned on, the merge then needs
**Skipped pipelines are considered successful** as well. On GitHub, branch protection that requires
status checks on the production branch will block it in the same way. The stage doesn't work around
this, for example by retrying the merge with different settings. It fails with a message naming the
setting, and the pipeline guide covers it.

### Pipeline wiring (GitLab example, for the guide)

```yaml
prod-merge-release:
  stage: close-out
  needs: [prod-deployment-close-out]
  rules:
    - if: '$CI_COMMIT_BRANCH =~ /^release\// && $CI_PIPELINE_SOURCE == "push"'
  script:
    - sf simply cicd deploy happy-soup merge-release
      --ci-commit-ref-name "${CI_COMMIT_REF_NAME}" --ci-commit-sha "${CI_COMMIT_SHA}"
      --ci-project-path "${CI_PROJECT_PATH}" --project-access-token "${PROJECT_ACCESS_TOKEN}"
```

`needs:` is what guarantees "only after close-out succeeded". GitLab doesn't start a job whose
`needs` failed.

## API changes

### `simply-core`: `VcsProvider`

New members are **optional**, following the convention 0061 set up, so third-party providers still
compile. The stage checks for each one first and fails with
`The <kind> provider does not support merging merge requests.`

```ts
type VcsMergeRequest = {
  // ...existing fields
  state?: 'open' | 'merged' | 'closed';
  draft?: boolean;
  headSha?: string;
};

// `detail` is the platform's own status string, for messages.
type VcsMergeability =
  | { state: 'checking'; detail: string }
  | { state: 'mergeable'; detail: string }
  | { state: 'blocked'; reason: VcsMergeBlockReason; detail: string };

// GitHub's `blocked` covers both missing reviews and missing required checks, so it maps to `other`.
type VcsMergeBlockReason = 'approvals' | 'checks' | 'conflict' | 'discussions' | 'draft' | 'other';

type VcsMergeOptions = { sha?: string; squash?: boolean; removeSourceBranch?: boolean };
type VcsMergeResult = { mergeCommitSha?: string; raw: unknown };

interface VcsProvider {
  // ...existing members
  getMergeRequest?(project: VcsProjectRef, iid: number): Promise<VcsMergeRequest>;
  findMergeRequests?(
    project: VcsProjectRef,
    sourceBranch: string,
    targetBranch: string,
    state: 'open' | 'merged',
  ): Promise<VcsMergeRequest[]>;
  getMergeability?(project: VcsProjectRef, mergeRequest: VcsMergeRequest): Promise<VcsMergeability>;
  markMergeRequestReady?(project: VcsProjectRef, mergeRequest: VcsMergeRequest): Promise<VcsMergeRequest>;
  mergeMergeRequest?(
    project: VcsProjectRef,
    mergeRequest: VcsMergeRequest,
    options?: VcsMergeOptions,
  ): Promise<VcsMergeResult>;
}
```

`findOpenMergeRequest` is kept unchanged. The existing normalizers fill the new optional
`VcsMergeRequest` fields, which is additive.

### `simply-cicd-core`

- `src/happySoup/mergeReleaseMergeRequest.ts`: `mergeReleaseMergeRequest(options)`, which takes an
  injectable `{ provider, project }` (as `createReleaseBranch` does) and a `sleep`, so tests don't
  wait in real time. It returns the result above and prints nothing.
- `deployHappySoup`: a `merge-release` branch in `runHappySoupStage`, which logs the result through
  `logger` the way `tag-deployment` does.
- The close-out commit messages move to exported constants, so the check in step 2 and
  `archiveOrRemoveDeployConfig` can't drift apart.
- Exports from `index.ts`.

None of this breaks the existing API. `simply-plugins` needs the new command and a minor bump of
both libraries.

## Alternatives considered

- **A `--merge` flag on `deployment-close-out`:** fewer jobs to wire, but it's unsafe to retry
  (see Decision) and it would give every close-out an API-scoped token.
- **GitLab's "merge when pipeline succeeds" (auto-merge), set when the release is created:** it
  would fire after whichever pipeline passes first, not after the production deploy. It also can't
  express "only close-out commits on top of what was deployed."
- **Merging with no head check:** simpler, but a hotfix pushed to the release branch during the
  production deploy would reach production's branch without ever reaching the production org.
- **Matching the merge request by title (`Release <date>`):** titles get edited. Source and target
  branch are what 0063 already uses to avoid duplicates.
- **Having the stage approve the merge request:** it would defeat the approval rule. Missing
  approvals are an error.
- **Looking up `CI_MERGE_REQUEST_IID`:** it's only set in merge request pipelines, and the release
  deploy runs as a push pipeline. `--merge-request-iid` stays available for teams that do run the
  deploy as a merge request pipeline.

## Testing

- `simply-core` (mocked `fetch`), for both providers: the normalizers fill
  `state`/`draft`/`headSha`; `getMergeability` maps each platform status to the right reason;
  `markMergeRequestReady` sends GitLab's title update and GitHub's GraphQL mutation; and
  `mergeMergeRequest` sends `sha`, squash, and the source-branch option, and returns the merge SHA.
- `mergeReleaseMergeRequest.test.ts` (fake provider):
  - it merges when the head is the deployed SHA, or the deployed SHA plus close-out commits;
  - it refuses when there's a non-close-out commit or the head isn't a descendant, and doesn't merge;
  - a draft is marked ready before merging;
  - it polls while checking, and times out after `--wait`;
  - each blocked reason produces its message;
  - an explicit iid whose branches don't match fails;
  - an already-merged one reports `Already merged`, and having no merge request at all fails;
  - dry run makes no write calls;
  - a provider without the optional methods fails with the "does not support" error.
- `deployHappySoup.test.ts`: the `merge-release` stage dispatches and logs.

## Decided

- **A stage of its own**, not a `--merge` flag on `deployment-close-out`.
- **No guard on the target branch.** `--target-branch` defaults to `productionBranch`, and CI
  `rules:` decide which pipelines run the stage.
- **The merge commit message is the platform's default.** `commitMessage` was dropped from
  `VcsMergeOptions`.
- **`deployment-close-out` not being safe to re-run** (the second run removes `config/deploy.json`)
  is fixed separately, as a bug.

## Implementation notes

- The `VcsProjectRef` is `--ci-project-path`. GitLab accepts the URL-encoded path wherever it takes
  a numeric ID, and GitHub's key is `owner/repo`, so no project-ID flag is needed.
- "Contains the deployed commit" is checked with two `compareRefs` calls (deployed→head and
  head→deployed), because GitLab's compare doesn't report ancestry. The head contains the deployed
  commit exactly when the second call is empty.
- `--wait` reuses `DeployHappySoupOptions.wait` (minutes, as a string), which `install-packaged`
  already uses.
