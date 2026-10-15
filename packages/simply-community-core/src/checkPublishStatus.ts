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

import { Duration } from '@salesforce/kit';
import { Logger, SfError, type Connection, type StatusResult } from '@salesforce/core';
import { boundedQuery } from './boundedRequest.js';
import { DEFAULT_PUBLISH_REQUEST_TIMEOUT } from './requestTimeout.js';

/** The `BackgroundOperation` fields this needs, out of the full standard-object schema. */
type BackgroundOperationRecord = {
  Id: string;
  Status: string | null;
  FinishedAt: string | null;
  Error: string | null;
};

/**
 * Builds a `PollingClient`-compatible `poll()` function for a community publish job.
 *
 * `BackgroundOperation.FinishedAt` (populated once the job reaches a terminal state) is used as
 * the completion signal rather than matching specific `Status` picklist values, since that's a
 * reliable signal regardless of exact status wording. `Error` (populated on failure) determines
 * success vs. failure once finished.
 *
 * @param connection - The org connection to poll against.
 * @param jobId - The `jobId` returned by `POST /connect/communities/{id}/publish`.
 * @param requestTimeout - Bounds each status-check attempt. Defaults to `DEFAULT_PUBLISH_REQUEST_TIMEOUT`; overridable mainly so tests don't have to wait out the real default.
 * @param onPollError - Called with the error whenever a status check fails, so the caller can surface it (the poll itself still reports "not finished yet").
 * @returns A `poll()` function for `PollingClient.create({ poll, ... })`.
 * @throws {SfError} `CommunityPublishFailedError` if the job reaches a terminal failure state.
 */
export function checkPublishStatus(
  connection: Connection,
  jobId: string,
  requestTimeout: Duration = DEFAULT_PUBLISH_REQUEST_TIMEOUT,
  onPollError?: (error: unknown) => void,
): () => Promise<StatusResult> {
  return async (): Promise<StatusResult> => {
    let result;
    try {
      result = await boundedQuery<BackgroundOperationRecord>(
        connection,
        `SELECT Id, Status, FinishedAt, Error FROM BackgroundOperation WHERE Id = '${jobId}'`,
        requestTimeout,
      );
    } catch (err) {
      // A stalled or failed status check isn't a publish failure — treat it the same as "not
      // finished yet" below and let PollingClient's own timeout/frequency decide when to give up.
      // But don't swallow it: a failure that repeats every poll (e.g. the user can't query
      // BackgroundOperation) would otherwise only show up as a timeout once --wait runs out.
      Logger.childFromRoot('checkPublishStatus').debug(`Status check for publish job ${jobId} failed: ${String(err)}`);
      onPollError?.(err);
      return { completed: false };
    }

    const operation = result.records[0] as BackgroundOperationRecord | undefined;

    // The BackgroundOperation record may not be queryable in the instant right after the publish
    // request is submitted — treat "not found yet" the same as "still running", not as a failure.
    if (!operation?.FinishedAt) {
      return { completed: false };
    }

    if (operation.Error) {
      throw new SfError(
        `Community publish failed (status: ${operation.Status ?? 'unknown'}): ${operation.Error}`,
        'CommunityPublishFailedError',
      );
    }

    return { completed: true, payload: { status: operation.Status } };
  };
}
