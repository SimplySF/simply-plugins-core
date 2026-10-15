# 0044 — Send the community publish POST, and cancel (not abandon) stalled requests

**Status:** In progress
**Package:** `simply-community-core`
**Date:** 2026-10-15

## Problem

[0040](0040-community-publish-request-timeouts.md) bounded every Salesforce API call in the
community-publish path with `retryWithBackoff`'s `attemptTimeout`, to stop `simply community
publish` hanging forever in GitLab CI. It doesn't actually stop the hang, for three reasons.

**The publish request is never sent.** `publishCommunity` POSTs to the Connect API with no `body`.
jsforce sends every POST/PUT/PATCH body as a stream (`request.js`, `body: input`), and only ends that
stream when the request has a `body` (`request-helper.js`, `createHttpRequestHandlerStreams`).
undici writes nothing — not even the request headers — until the body yields its first chunk or
ends, so a bodyless POST sits on an open connection sending zero bytes until jsforce's 30-minute
fetch timeout aborts it. Verified:

- Against local HTTP and TLS servers, with every jsforce/undici combination installed here (jsforce
  3.10.23–3.10.27, undici 6.28–8.11.2): the server receives 0 bytes.
- Against a live org, through `@salesforce/core`'s `Connection.request()` from the installed
  `@simplysf/simply` 2.22.1: a bodyless POST hung for the full 20s probe timeout; the same POST with
  `body: ''` got Salesforce's response in ~300ms.

This doesn't depend on the CI environment at all, so it explains the hang directly. (The original
report says the command works from a desktop terminal; that couldn't be reproduced with the current
dependencies, and is worth re-checking against whatever version that desktop has installed.)

**The process outlives the timeout.** `attemptTimeout` races the call against a timer; the request
itself is left running. 0040 accepted that on the assumption that "the command has already reported
failure and exited by then" — but nothing exits the process. The plugin's `bin/run.js` just awaits
oclif's `execute()`, so Node exits only when its event loop drains, and the abandoned request keeps
it alive: jsforce's own fetch timeout defaults to **30 minutes** (`request.js`, "jsforce consumers
can't set this when calling `Connection` methods"). Reproduced against a local TCP server that
accepts connections and never replies: `publishCommunity({ requestTimeout: 2s })` rejects with
`RetryAttemptTimeoutError` after 2s, then the process sits there indefinitely. In CI that is
indistinguishable from the original hang.

**A failing status poll is silent.** `checkPublishStatus` swallows every error from the
`BackgroundOperation` query as `{ completed: false }`. A transient network blip is fine to retry,
but a deterministic failure — e.g. a CI integration user that can't query `BackgroundOperation` —
turns into 15 minutes (the default `--wait`) of polling with no output, then a generic
`CommunityPublishTimeoutError` that hides the real cause.

## Decision

**Send a body.** The publish POST sends `body: '{}'`. The endpoint takes no input; `'{}'` rather than
`''` because `@salesforce/core` sends `content-type: application/json` on every request, and an empty
string isn't valid JSON.

**Cancel the request itself.** jsforce _does_ honour a per-request `timeout` — passed as the second
argument to `Connection.request()`, it reaches the undici fetch wrapper and calls
`AbortController.abort()`, tearing down the socket. Only `Connection.request()` forwards it;
`Connection.query()`/`singleRecordQuery()` don't. So every call in the publish path goes through
`Connection.request()` with `{ timeout: requestTimeout.milliseconds }`:

- The publish `POST /connect/communities/{id}/publish` — already a `request()`; add the option.
- The `BackgroundOperation` status query — `GET /query?q=…` via `request()` instead of `query()`.
- The `Network` lookup — new export `queryNetworkByName(connection, name, requestTimeout?)`, so the
  plugin's two call sites (`publish.ts`, `url/set.ts`) share one bounded, cancellable query instead
  of each hand-rolling one. It throws the same `SingleRecordQuery_NoRecords` /
  `SingleRecordQuery_MultipleRecords` error names `singleRecordQuery` does, so the commands' error
  output doesn't change.

`retryWithBackoff`'s `attemptTimeout` stays, at the same value, as a backstop that guarantees the
attempt settles with a recognisable `RetryAttemptTimeoutError` even if a future jsforce stops
honouring the option. jsforce's timeout is set 1s later than it: if the two fire together, jsforce's
`AbortError` can win the race, and its message wrongly claims "timeout of 30 minutes". The jsforce
timeout is what guarantees the socket goes away.

**Surface poll errors.** `checkPublishStatus` gains an optional `onPollError(error)` callback (and
`publishCommunity` an `onPollError` option it forwards). A failed poll is still treated as "not
finished yet" — that's the right call for a transient failure, and `PollingClient`'s `--wait` still
bounds the whole thing — but the caller now hears about each one, so the CLI can print a warning
and the actual error reaches the CI log. Each failure is also written to the `@salesforce/core`
debug log (`SF_LOG_LEVEL=debug`).

## Behavior

- No flag or result-shape changes.
- The publish request actually reaches Salesforce.
- A stalled request now releases its socket about 1s after `DEFAULT_PUBLISH_REQUEST_TIMEOUT` (30s), so
  the process exits once the command finishes instead of staying alive for jsforce's 30-minute
  default. One known residual: when `--wait` runs out, `PollingClient` leaves its next poll's delay
  timer (up to the 15s poll frequency) pending, so the process can linger that long. Bounded, and
  inside `@salesforce/core`, so not worked around here.
- New public API (additive, minor bump): `queryNetworkByName`, `type NetworkRecord`,
  `checkPublishStatus`'s 4th parameter `onPollError`, `PublishCommunityOptions.onPollError`.

## Alternatives considered

- **`process.exit()` from the commands once `run()` finishes.** Makes the symptom go away, but only
  for the CLI — library consumers (editor tooling, CI scripts, per 0030) would still leak a socket
  per stalled call for 30 minutes. It also hides any other open-handle bug instead of exposing it.
  Fixing the request is the root cause; the CLI gets the fix for free.
- **`jsforce.setDispatcher()` with an undici `Agent` that has connect/headers/body timeouts.** Global
  — it would change the timeout of every request in every plugin loaded into the same `sf` process.
- **Fail fast on non-transient poll errors** (e.g. `INVALID_TYPE`, `INSUFFICIENT_ACCESS`) instead of
  polling until `--wait` runs out. Better UX in that one case, but needs a reliable
  transient-vs-permanent classifier for Salesforce API errors that nothing else in the repo has yet.
  Surfacing the error is the part that matters for diagnosing; revisit if it proves noisy.

## Implementation plan

1. `src/boundedRequest.ts` (internal): `boundedRequest(connection, request, timeout)` and
   `boundedQuery(connection, soql, timeout)` — `Connection.request()` with `{ timeout }`, inside
   `retryWithBackoff({ retryAttempts: 0, attemptTimeout })`.
2. `publishCommunity.ts` / `checkPublishStatus.ts` — use them; add `onPollError`.
3. `src/queryNetworkByName.ts` — new export.
4. Tests: existing suites move from stubbing `query` to stubbing `request`; new cases for
   `onPollError`, `queryNetworkByName`'s 0/1/many-record cases, and that the jsforce `timeout`
   option is passed on every call.
5. Manual: the stalled-server repro above exits promptly after the command finishes.

## Testing

- Unit tests per the plan, including that the publish POST carries a `body` (a stub-based test can't
  observe the real hang: `fakeConnectionRequest` replaces jsforce's transport entirely).
- Manual, against the built `lib/` with a local server: a never-responding server → rejects with
  `RetryAttemptTimeoutError` at the timeout and the process exits ~1s later (before: never exits); a
  server that answers the POST but stalls every status query → the POST arrives, `onPollError` fires
  per poll, `CommunityPublishTimeoutError` at `--wait`, process exits.

## Open questions

- `body: '{}'` hasn't been exercised against a real publish yet (only the bodyless-vs-`''` probe
  above). Verify with one real publish in a sandbox before release.
