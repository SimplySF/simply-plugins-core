# 0040 — Bounded per-attempt timeouts for community publish network calls

**Status:** Draft
**Package:** `simply-core`, `simply-community-core`
**Date:** 2026-09-17

## Problem

`sf simply community publish` (and `simply community url set --publish`) can hang forever instead
of failing or timing out. This was reported as: works fine from a desktop terminal, always hangs
indefinitely when run from a GitLab CI job.

Tracing the call chain, nothing in it has a per-request timeout:

- `publishCommunity()`'s initial `POST /connect/communities/{id}/publish` is wrapped in
  `retryWithBackoff`, but that helper only reacts to a **rejected** promise. An attempt that never
  settles — a stalled TCP/TLS handshake, a proxy or firewall that silently drops packets instead of
  refusing the connection — blocks on `await fn()` forever. `retryAttempts`/`retryBackoff` never get
  a chance to run, because there's no failure to retry.
- The `Network` lookup (`connection.singleRecordQuery`) that runs _before_ the publish request even
  starts has no bound at all, in either `simply community publish` or `simply community url set`.
- The status-poll query inside `checkPublishStatus` looked unbounded too, but `PollingClient`'s
  overall `timeout` option is implemented as a `Promise.race` against a hard timer
  (`ts-retry-promise`'s `timeout()`), so it does fire even if one `poll()` attempt never settles.
  That means this call is bounded by the command's `--wait` (default 15 minutes) — just not usefully
  bounded: a single stuck query attempt can silently consume the _entire_ wait budget in one
  non-retried call, instead of the intended "poll every 15s, tolerate a blip" behavior.

A GitLab CI runner's network path to the org (proxy required, restricted egress, DNS behavior) can
easily differ from a desktop's in a way that turns a normally-sub-second call into one that never
resolves. Nothing in this code can detect or recover from that today — it just waits.

## Decision

Add an optional `attemptTimeout: Duration` to `retryWithBackoff`'s options (`simply-core`), bounding
each individual attempt with `Promise.race` against a timer. A timed-out attempt is treated exactly
like a rejected one and flows through the existing retry/backoff/`shouldRetry` logic unchanged.

Apply it at every unbounded Salesforce API call in the community-publish path:

- `publishCommunity`'s initial publish `POST` — already wrapped in `retryWithBackoff`; just add the
  timeout.
- `checkPublishStatus`'s `BackgroundOperation` status query — wrapped in `retryWithBackoff` at 0
  retries purely to get the timeout behavior. A timed-out (or otherwise failed) attempt returns
  `{ completed: false }`, the same as the existing "record not queryable yet" case, since a stalled
  status check isn't a publish failure — `PollingClient`'s own cadence and overall timeout already
  decide when to give up.
- The `Network` lookups in the sibling `simply-plugins` repo's `simply-community` package
  (`publish.ts`, `url/set.ts`) — tracked in that repo's [0038](https://github.com/SimplySF/simply-plugins/blob/main/docs/design/0038-community-publish-request-timeouts.md).

Default: one exported constant, `DEFAULT_PUBLISH_REQUEST_TIMEOUT = Duration.seconds(30)`, from
`simply-community-core`. Not exposed as a flag — 30s is generous for any single Connect/SOQL call
against a live org, and a configuration knob nobody has asked for isn't warranted for a correctness
fix.

## Behavior

- No flag, output, or error-shape changes to any command.
- New behavior: a Salesforce API call that previously could hang forever now fails after
  `DEFAULT_PUBLISH_REQUEST_TIMEOUT`, subject to the command's existing `--retry-attempts`/
  `--retry-backoff` for the initial publish request, or is treated as "still polling" for the status
  check.
- `retryWithBackoff`'s new `attemptTimeout` is optional and defaults to `undefined` (no timeout) —
  every other existing caller is unaffected.

| Call site                                     | Before                           | After                                                              |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `publishCommunity` initial POST               | No bound; can hang forever       | Bounded to 30s per attempt, then follows `--retry-attempts`        |
| `checkPublishStatus` status query             | Bounded only by `--wait` overall | Bounded to 30s per attempt; a stuck attempt is retried like a miss |
| `Network` lookup (`publish.ts`, `url/set.ts`) | No bound; can hang forever       | Bounded to 30s, then rejects                                       |

## Alternatives considered

- **Wire an `AbortController` through `Connection.request`/`.query` so a timeout actually cancels
  the socket.** Rejected for this pass: `@salesforce/core`'s `Connection` methods don't accept a
  signal, so this would mean forking or patching the SDK's HTTP layer — far more than the bug
  warrants. `Promise.race` leaves the original request running in the background until it eventually
  settles (or the process exits); that's an acceptable cost since the command has already reported
  failure and exited by then.
- **Bound only the `PollingClient` path and leave the initial publish POST alone.** Rejected — the
  initial POST isn't behind `PollingClient` at all, and it's the call most likely to be the one
  actually hanging forever (the poll path already had _some_ bound). The fix needs to cover the
  pre-poll call too.
- **A separate `withTimeout()` utility instead of extending `retryWithBackoff`.** Considered, but
  every call site that needed bounding either already wanted `retryWithBackoff`'s retry/backoff
  semantics, or trivially wants "one bounded attempt, no retry," which `retryAttempts: 0` already
  expresses. A second, parallel timeout primitive would just be two ways to do the same thing.
- **Make the timeout configurable via a new flag.** Rejected — nobody has asked for control over
  this. The fix is about turning an infinite hang into a bounded, diagnosable failure, not about
  tuning it per environment.

## Implementation plan

1. `simply-core/src/async/retryWithBackoff.ts` — add `attemptTimeout?: Duration` to
   `RetryWithBackoffOptions`; add an internal helper that races `fn()` against a timer (clearing it
   in a `finally` either way); export a `RetryAttemptTimeoutError` so callers/tests can distinguish a
   timeout from the underlying request's own errors.
2. `simply-core/test/async/retryWithBackoff.test.ts` — new cases: an attempt that never resolves
   times out and is retried like any other failure; an attempt that resolves before the timeout is
   unaffected; omitting `attemptTimeout` behaves exactly as today.
3. `simply-community-core/src/publishCommunity.ts` — pass
   `attemptTimeout: DEFAULT_PUBLISH_REQUEST_TIMEOUT` into the existing `retryWithBackoff` call around
   the publish POST.
4. `simply-community-core/src/checkPublishStatus.ts` — wrap the `connection.query` call in
   `retryWithBackoff({ retryAttempts: 0, backoffFactor: 1, attemptTimeout: DEFAULT_PUBLISH_REQUEST_TIMEOUT })`;
   catch any error from that bounded attempt and return `{ completed: false }`.
5. `simply-community-core/src/index.ts` — export `DEFAULT_PUBLISH_REQUEST_TIMEOUT`.
6. `simply-community-core/test/publishCommunity.test.ts` / `checkPublishStatus.test.ts` — cover a
   hung request/query no longer hanging the test itself (fake a never-resolving stub, use a small
   `attemptTimeout` to keep the test fast).
7. `pnpm run build` so `command-snapshot.json` regenerates (no expected diff — no flags changed) and
   to catch any type errors from the new option.

## Testing

- Unit (`retryWithBackoff`): hung attempt times out and retries/exhausts per existing semantics;
  resolved-in-time attempt unaffected; default (`attemptTimeout` undefined) behavior unchanged.
- Unit (`checkPublishStatus`): a query that hangs past `attemptTimeout` resolves the poll as
  `{ completed: false }` rather than rejecting, so `PollingClient` keeps polling instead of aborting
  the whole `subscribe()`.
- Unit (`publishCommunity`): a hung initial POST is retried (when `retryAttempts > 0`) or rejected
  with the timeout error within `attemptTimeout`, instead of left pending indefinitely.
- No NUT coverage needed — this doesn't change any live-org-facing contract, only bounds an existing
  one.

## Open questions

- Is 30s the right default for every org/network — including geographically distant orgs, or ones
  behind a heavy Shield/Event Monitoring proxy? Can be tuned later from real-world reports; not
  blocking this fix.
- Should a timed-out-but-still-in-flight request's eventual (background) settlement be logged once it
  resolves, purely for diagnostics? Left out of this pass, pending evidence it matters.
