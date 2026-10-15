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
import { SfError, type Connection } from '@salesforce/core';
import { escapeSoqlLiteral } from '@simplysf/simply-core';
import { boundedQuery } from './boundedRequest.js';
import { DEFAULT_PUBLISH_REQUEST_TIMEOUT } from './requestTimeout.js';

/** The `Network` fields needed to publish a community. */
export type NetworkRecord = { Id: string; Name: string };

/**
 * Looks up a `Network` (Experience Cloud site) by name, bounded by `requestTimeout` with the request
 * cancelled if it stalls. A drop-in for `connection.singleRecordQuery()`: it throws the same error
 * names (`SingleRecordQuery_NoRecords`, `SingleRecordQuery_MultipleRecords`), which
 * `@salesforce/core` doesn't export as values.
 *
 * @param connection - The org connection.
 * @param name - The `Network.Name` to find.
 * @param requestTimeout - Bounds the query. Defaults to {@link DEFAULT_PUBLISH_REQUEST_TIMEOUT}.
 * @returns The matching record's `Id` and `Name`.
 * @throws {SfError} `SingleRecordQuery_NoRecords` / `SingleRecordQuery_MultipleRecords` unless exactly one matches.
 */
export async function queryNetworkByName(
  connection: Connection,
  name: string,
  requestTimeout: Duration = DEFAULT_PUBLISH_REQUEST_TIMEOUT,
): Promise<NetworkRecord> {
  const soql = `SELECT Id, Name FROM Network WHERE Name = '${escapeSoqlLiteral(name)}'`;
  const result = await boundedQuery<NetworkRecord>(connection, soql, requestTimeout);

  if (result.totalSize === 0) {
    throw new SfError(`No record found for ${soql}`, 'SingleRecordQuery_NoRecords');
  }
  if (result.totalSize > 1) {
    throw new SfError('The query returned more than 1 record', 'SingleRecordQuery_MultipleRecords');
  }

  const { Id, Name } = result.records[0];
  return { Id, Name };
}
