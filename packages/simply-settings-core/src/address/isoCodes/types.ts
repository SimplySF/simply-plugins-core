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
import type { Dispatcher } from 'undici';

/** The ISO 3166-2 sources state definitions can be fetched from. */
export type IsoCodesSourceId = 'debian';

/** One ISO 3166-2 subdivision, as a source reports it. */
export type IsoCodesSubdivision = {
  /** The full ISO 3166-2 code, e.g. `FR-ARA`. */
  code: string;
  name: string;
  /** The full code of the subdivision this one is nested under, e.g. `FR-ARA` for `FR-01`. */
  parent?: string;
};

export type IsoCodesFetchOptions = {
  /** Bounds each HTTP request. Defaults to 30 seconds. */
  requestTimeoutMs?: number;
  /** Retries after a transport failure (timeout, reset, 5xx). Defaults to 2. */
  retryAttempts?: number;
  /** Delay before the first retry, doubling after that. Defaults to 2 seconds. */
  initialRetryDelay?: Duration;
  /**
   * The `undici` dispatcher for every request. Defaults to an `EnvHttpProxyAgent`, so
   * `HTTPS_PROXY`/`NO_PROXY` are honored. For tests: a `MockAgent`.
   */
  dispatcher?: Dispatcher;
};

/**
 * Where ISO 3166-2 data comes from. An adapter only finds a version and downloads that version's
 * subdivisions; the level filter and validation every source shares live in
 * `fetchIsoCodesStateDefinitions`.
 */
export type IsoCodesSource = {
  id: IsoCodesSourceId;
  /** For messages and attribution, e.g. `Debian iso-codes`. */
  label: string;
  /** The source's home page. */
  homepage: string;
  /**
   * The version used when none is given.
   *
   * @throws SfError (`IsoCodesDownloadError`) when no version can be determined.
   */
  resolveLatestVersion(options: IsoCodesFetchOptions): Promise<string>;
  /**
   * Downloads one version's subdivisions.
   *
   * @throws SfError (`IsoCodesVersionNotFoundError`) for a version the source doesn't have,
   * (`IsoCodesDownloadError`) when the download fails, or (`InvalidIsoCodesDataError`) when the
   * data isn't in the expected shape.
   */
  fetchSubdivisions(
    version: string,
    options: IsoCodesFetchOptions,
  ): Promise<{ url: string; subdivisions: IsoCodesSubdivision[] }>;
};
