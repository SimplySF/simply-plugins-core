# 0055 — Checking a Dev Hub's active scratch org limit before a signup

**Status:** Implemented (PR #265)
**Package:** `packages/simply-cicd-core`
**Date:** 2026-10-28

## Problem

`createScratchOrg` (behind `simply cicd build create-scratch`) tries each `--dev-hub` in order and
skips one that can't take a signup. It only checked `DailyScratchOrgs`, the signups left today. A
Dev Hub also has `ActiveScratchOrgs`, the number of scratch orgs that may exist at once. A hub with
signups left today but every active slot taken passed the check, and the signup was then attempted
and refused by the Dev Hub.

That refusal was recovered from only by luck. It comes back as `LIMIT_EXCEEDED`, which
`isScratchOrgLimitError` treats as "try the next hub". So the run still moved on, but only after a
signup attempt it never needed to make, with an error logged that read like a failure, and a warning
that blamed the daily limit.

## Decision

Check both limits before attempting a signup, and skip a Dev Hub that has no room under either.

- `sfOrg.ts` gets `getScratchOrgCapacity(hubAliasOrUsername)`. It reads both limits from one REST
  `limits` call and returns `{ daily?: { max, remaining }, active?: { max, remaining } }`.
- `getRemainingDailyScratchOrgs` stays, delegating to it, marked `@deprecated`. Removing it would be
  a breaking change to the package's exports for no gain, and no `simply-plugins` command calls it.
- `createScratchOrg` takes a hub only when `daily.remaining > 0` **and** `active.remaining > 0`.
- A hub that doesn't report a limit is skipped, as one without `DailyScratchOrgs` already was. Only a
  Dev Hub reports these limits, so a missing one means the alias doesn't name a Dev Hub.
- The `LIMIT_EXCEEDED` fallback stays. Another pipeline can still take the last slot between the
  check and the signup, and that case should still move on to the next hub.

## Behavior

Log lines from `create-scratch`, per Dev Hub:

| Situation                         | Before                                                   | After                                                                                 |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Room under both limits            | `Attempting … with Dev Hub hub-a (37 remaining).`        | `Attempting … with Dev Hub hub-a (37 signups left today, 3 of 40 active slots free).` |
| No signups left today             | `Dev Hub hub-a has no remaining scratch orgs. Skipping.` | `Dev Hub hub-a has no scratch org signups left today (daily limit 200). Skipping.`    |
| Every active slot taken           | Signup attempted, refused, then the next hub tried       | `Dev Hub hub-a is at its active scratch org limit (40 active). Skipping.`             |
| A limit not reported              | Skipped with the "no remaining" message                  | `Dev Hub hub-a does not report its scratch org limits (is it a Dev Hub?). Skipping.`  |
| Signup refused (`LIMIT_EXCEEDED`) | `Dev Hub hub-a reached its daily limit. Trying next…`    | `Dev Hub hub-a reached a scratch org limit. Trying next Dev Hub...`                   |

When every hub is skipped or refused, the command still fails with `Scratch org creation failed for
all available Dev Hubs.` Flags and the result shape are unchanged.

## Alternatives considered

- **Count active scratch orgs with an `ActiveScratchOrg` query.** That's what the limit already
  reports, without a second request or needing to know the hub's maximum.
- **Treat a missing `ActiveScratchOrgs` limit as unlimited.** This is more permissive, but every Dev
  Hub reports the limit, so a missing one points at a wrong alias. Skipping it agrees with how a
  missing daily limit was already handled.
- **Rely on the `LIMIT_EXCEEDED` fallback alone.** It works, but costs a signup request per full hub
  and logs misleading errors. The check also lets the logs say which limit was hit.

## Implementation plan

One PR: `getScratchOrgCapacity` in `sfOrg.ts`, the two-limit check in `build/createScratchOrg.ts`,
tests, and the README export list. A follow-up in `simply-plugins` updates the `create-scratch`
help text and README, which say a hub is skipped once it "has hit its daily scratch org limit".

## Testing

- `sfOrg.test.ts`: `getScratchOrgCapacity` maps both limits from one `limits` call, and leaves out a
  limit the org doesn't report.
- `createScratchOrg.test.ts`:
  - a hub with no signups left today is skipped;
  - a hub at its active limit is skipped even with signups left today;
  - a hub reporting no limits, or only the daily one, is skipped;
  - the attempt log line shows both limits;
  - every hub exhausted (one by each limit) still fails.
- Checked against a real Dev Hub: the `limits` resource reports both `DailyScratchOrgs` and
  `ActiveScratchOrgs`, and `getScratchOrgCapacity` returned both.

## Open questions

None.
