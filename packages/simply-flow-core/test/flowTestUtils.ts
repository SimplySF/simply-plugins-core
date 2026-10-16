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

import type { Connection } from '@salesforce/core';
import type { SinonSandbox, SinonStub } from 'sinon';

/**
 * `autoFetchQuery`'s real return type is generic over a jsforce `Schema` the mocked `Connection` here
 * has no concrete instance of, so a query-shaped mock can't structurally satisfy it without a cast —
 * this is that cast, applied once instead of at every `.resolves()` call.
 */
type OrgQueryResult = Awaited<ReturnType<Connection['autoFetchQuery']>>;

export function queryResult(records: Array<Record<string, unknown>>): OrgQueryResult {
  return { records, done: true, totalSize: records.length } as unknown as OrgQueryResult;
}

export type ToolingStubs = { update: SinonStub; destroy: SinonStub };

/**
 * Replaces `connection.tooling.sobject(...)` with one fake whose `update` (used on `FlowDefinition`)
 * and `destroy` (used on `Flow`) are sinon stubs the test configures.
 */
export function stubToolingSobject(sandbox: SinonSandbox, connection: Connection): ToolingStubs {
  const stubs: ToolingStubs = { update: sandbox.stub(), destroy: sandbox.stub() };
  sandbox.stub(connection.tooling, 'sobject').returns(stubs as never);
  return stubs;
}
