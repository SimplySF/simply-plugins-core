/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Duration } from '@salesforce/kit';
import type { Connection } from '@salesforce/core';
import { retryWithBackoff, type RetryWithBackoffOptions } from '@simplysf/simply-core';

type HttpRequest = Parameters<Connection['request']>[0];

/**
 * How long after `attemptTimeout` jsforce aborts the request. Small enough that the socket goes away
 * promptly; non-zero so the attempt reliably fails with `RetryAttemptTimeoutError` first, rather than
 * jsforce's `AbortError`, whose message wrongly claims a 30-minute timeout.
 */
const JSFORCE_ABORT_GRACE_MS = 1000;

/** The response shape of `GET /query?q=…`. */
export type QueryResponse<T> = { totalSize: number; done: boolean; records: T[] };

/**
 * `Connection.request()` bounded to `timeout`, with the request actually cancelled when it fires.
 *
 * jsforce aborts the underlying fetch (and releases its socket) once the per-request `timeout` option
 * elapses; without it a stalled request stays open for jsforce's 30-minute default, keeping the
 * process alive long after the caller has given up. Only `Connection.request()` forwards that option
 * — `query()`/`singleRecordQuery()` don't — hence {@link boundedQuery}. `retryWithBackoff`'s
 * `attemptTimeout` is set to the same value as a backstop, so the attempt still settles with a
 * `RetryAttemptTimeoutError` even if jsforce ever stops honouring the option. See
 * docs/design/0044-community-publish-cancel-stalled-requests.md.
 *
 * @param connection - The org connection.
 * @param request - The request to make, as accepted by `Connection.request()`.
 * @param timeout - Bounds each attempt.
 * @param retry - Retry settings; defaults to a single attempt.
 * @returns The parsed response body.
 */
export async function boundedRequest<T>(
  connection: Connection,
  request: HttpRequest,
  timeout: Duration,
  retry: Pick<RetryWithBackoffOptions, 'retryAttempts' | 'backoffFactor'> = { retryAttempts: 0, backoffFactor: 1 },
): Promise<T> {
  return retryWithBackoff(
    async () => connection.request<T>(request, { timeout: timeout.milliseconds + JSFORCE_ABORT_GRACE_MS }),
    { ...retry, attemptTimeout: timeout },
  );
}

/**
 * A SOQL query through {@link boundedRequest}, so it's cancelled rather than abandoned on timeout.
 * Returns only the first batch of records — fine for the single-record lookups this package makes.
 *
 * @param connection - The org connection.
 * @param soql - The query to run.
 * @param timeout - Bounds the request.
 * @returns The query response.
 */
export async function boundedQuery<T>(
  connection: Connection,
  soql: string,
  timeout: Duration,
): Promise<QueryResponse<T>> {
  return boundedRequest<QueryResponse<T>>(
    connection,
    { method: 'GET', url: `/query?q=${encodeURIComponent(soql)}` },
    timeout,
  );
}
