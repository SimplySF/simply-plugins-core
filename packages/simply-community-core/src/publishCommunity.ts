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
import type { Connection } from '@salesforce/core';
import { PollingClient } from '@salesforce/core';
import { retryWithBackoff } from '@simplysf/simply-core';
import { checkPublishStatus } from './checkPublishStatus.js';
import { DEFAULT_PUBLISH_REQUEST_TIMEOUT } from './requestTimeout.js';

export { DEFAULT_PUBLISH_REQUEST_TIMEOUT } from './requestTimeout.js';

/** The response shape of `POST /connect/communities/{id}/publish`. */
type CommunityPublishResponse = { id: string; jobId: string; name: string; url: string };

export type PublishCommunityOptions = {
  connection: Connection;
  /** The `Network.Id` to publish. */
  networkId: string;
  /** Minutes to wait for the publish job to reach a terminal state. */
  wait: number;
  /** Additional attempts to make if the initial publish request fails. Defaults to 0. */
  retryAttempts?: number;
  /** Factor the retry delay grows by after each failed attempt. Defaults to 2. */
  retryBackoff?: number;
  /**
   * Bounds each individual Connect/SOQL request this makes against the org. Defaults to
   * {@link DEFAULT_PUBLISH_REQUEST_TIMEOUT}; overridable mainly so tests don't have to wait out the
   * real default.
   */
  requestTimeout?: Duration;
};

/**
 * Trigger a community publish via the Connect REST API and poll until the job reaches a terminal
 * state, throwing if it fails.
 *
 * Shared by `simply community publish` and `simply community url set --publish` so the Connect
 * API call and the poll for completion exist in exactly one place.
 *
 * @param options - The connection, the `Network.Id` to publish, and wait/retry settings.
 * @returns The Connect API's publish response: id, jobId, name, and url.
 * @throws {SfError} `CommunityPublishFailedError` if the job reaches a terminal failure state.
 * @throws If the initial publish request fails and retries (if any) are exhausted.
 */
export async function publishCommunity(options: PublishCommunityOptions): Promise<CommunityPublishResponse> {
  const requestTimeout = options.requestTimeout ?? DEFAULT_PUBLISH_REQUEST_TIMEOUT;

  const publishResponse = await retryWithBackoff(
    async () =>
      options.connection.request<CommunityPublishResponse>({
        method: 'POST',
        url: `/connect/communities/${options.networkId}/publish`,
      }),
    {
      retryAttempts: options.retryAttempts ?? 0,
      backoffFactor: options.retryBackoff ?? 2,
      attemptTimeout: requestTimeout,
    },
  );

  const client = await PollingClient.create({
    poll: checkPublishStatus(options.connection, publishResponse.jobId, requestTimeout),
    frequency: Duration.seconds(15),
    timeout: Duration.minutes(options.wait),
    timeoutErrorName: 'CommunityPublishTimeoutError',
  });
  await client.subscribe();

  return publishResponse;
}
