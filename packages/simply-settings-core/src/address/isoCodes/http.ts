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

import { SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { retryWithBackoff } from '@simplysf/simply-core';
import { fetch } from 'undici';
import type { IsoCodesFetchOptions } from './types.js';

/** A 5xx: worth retrying, unlike a response we can act on. */
class ServerError extends Error {
  public constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'ServerError';
  }
}

function isTransportError(error: unknown): boolean {
  if (error instanceof ServerError) return true;
  if (!(error instanceof Error)) return false;
  // undici's `fetch` rejects with `TypeError: fetch failed` for socket-level failures, and
  // `AbortSignal.timeout` with a `TimeoutError` DOMException.
  return (error instanceof TypeError && error.message === 'fetch failed') || error.name === 'TimeoutError';
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'the request timed out';
  if (error instanceof TypeError && error.cause instanceof Error) return error.cause.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * GETs a JSON document, retrying transport failures.
 *
 * @param url - What to fetch.
 * @param label - The source's label, for the error message.
 * @param options - Timeout, retry, and dispatcher settings.
 * @returns The parsed body for a 200, or `undefined` for a 404 — the caller knows what a missing
 * document means.
 * @throws SfError (`IsoCodesDownloadError`) for anything else, once retries are spent.
 */
export async function getJson(url: string, label: string, options: IsoCodesFetchOptions): Promise<unknown> {
  const downloadError = (reason: string): SfError =>
    new SfError(`Couldn't download ISO 3166-2 data from ${label} (${url}): ${reason}.`, 'IsoCodesDownloadError', [
      'Check your network connection and proxy settings (HTTPS_PROXY), or provide the state definitions as a file instead.',
    ]);

  let response: { status: number; body: string };
  try {
    response = await retryWithBackoff(
      async () => {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
          dispatcher: options.dispatcher,
        });
        const body = await res.text();
        if (res.status >= 500) throw new ServerError(res.status);
        return { status: res.status, body };
      },
      {
        retryAttempts: options.retryAttempts ?? 2,
        backoffFactor: 2,
        initialDelay: options.initialRetryDelay ?? Duration.seconds(2),
        shouldRetry: isTransportError,
      },
    );
  } catch (error) {
    throw downloadError(describeFailure(error));
  }

  if (response.status === 404) return undefined;
  if (response.status !== 200) throw downloadError(`HTTP ${response.status}`);

  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw downloadError('the response is not valid JSON');
  }
}
