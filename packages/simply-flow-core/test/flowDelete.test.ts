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
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import sinon from 'sinon';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteFlows } from '../src/flowDelete.js';
import type { FlowDeleteStage } from '../src/flowTypes.js';
import { queryResult, stubToolingSobject, type ToolingStubs } from './flowTestUtils.js';

const DEFINITION_QUERY = 'SELECT Definition.Id';
const VERSION_QUERY = 'SELECT Id, Definition.DeveloperName';

describe('deleteFlows', () => {
  const $$ = new TestContext({ sinon });
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let tooling: ToolingStubs;

  beforeAll(async () => {
    await $$.stubAuths(testOrg);
  });

  beforeEach(async () => {
    connection = await testOrg.getConnection();
    tooling = stubToolingSobject($$.SANDBOX, connection);
  });

  afterEach(() => {
    $$.restore();
  });

  /** Answers the definition query and the version query with the given records. */
  function stubQueries(
    definitions: Array<{ Id: string; DeveloperName: string }>,
    versions: Array<{ Id: string; DeveloperName: string }>,
  ): sinon.SinonStub {
    return $$.SANDBOX.stub(connection, 'autoFetchQuery').callsFake(async (soql: string) => {
      if (soql.startsWith(DEFINITION_QUERY)) {
        return queryResult(definitions.map((definition) => ({ Definition: definition })));
      }
      if (soql.startsWith(VERSION_QUERY)) {
        return queryResult(versions.map(({ Id, DeveloperName }) => ({ Id, Definition: { DeveloperName } })));
      }
      throw new Error(`Unexpected query: ${soql}`);
    });
  }

  it('returns an empty result without querying when given no names', async () => {
    const autoFetchQuery = $$.SANDBOX.stub(connection, 'autoFetchQuery');
    const onStage = sinon.stub();

    const result = await deleteFlows(connection, [], { onStage });

    expect(result).toStrictEqual({ deactivated: [], deleted: [], failures: [] });
    expect(autoFetchQuery.called).toBe(false);
    expect(onStage.called).toBe(false);
  });

  it('deactivates a definition once even when the flow has two versions, then deletes both', async () => {
    const autoFetchQuery = stubQueries(
      [
        { Id: '300000000000001AAA', DeveloperName: 'Flow_A' },
        { Id: '300000000000001AAA', DeveloperName: 'Flow_A' },
      ],
      [
        { Id: '301000000000001AAA', DeveloperName: 'Flow_A' },
        { Id: '301000000000002AAA', DeveloperName: 'Flow_A' },
      ],
    );
    tooling.update.resolves({ id: '300000000000001AAA', success: true, errors: [] });
    tooling.destroy.callsFake(async (id: string) => ({ id, success: true, errors: [] }));

    const result = await deleteFlows(connection, ['Flow_A']);

    expect(tooling.update.callCount).toBe(1);
    expect(tooling.update.firstCall.args[0]).toStrictEqual({
      Id: '300000000000001AAA',
      Metadata: { activeVersionNumber: 0 },
    });
    expect(tooling.destroy.args.map((args) => args[0] as string)).toStrictEqual([
      '301000000000001AAA',
      '301000000000002AAA',
    ]);
    expect(result).toStrictEqual({ deactivated: ['Flow_A'], deleted: ['Flow_A', 'Flow_A'], failures: [] });
    expect(autoFetchQuery.alwaysCalledWithMatch(sinon.match.string, { tooling: true })).toBe(true);
  });

  it('records a deactivation failure but still deletes every version, for both flows', async () => {
    stubQueries(
      [
        { Id: '300000000000001AAA', DeveloperName: 'Flow_A' },
        { Id: '300000000000002AAA', DeveloperName: 'Flow_B' },
      ],
      [
        { Id: '301000000000001AAA', DeveloperName: 'Flow_A' },
        { Id: '301000000000002AAA', DeveloperName: 'Flow_B' },
      ],
    );
    tooling.update.callsFake(async ({ Id }: { Id: string }) =>
      Id === '300000000000001AAA'
        ? { success: false, errors: [{ message: 'Cannot deactivate' }] }
        : { id: Id, success: true, errors: [] },
    );
    tooling.destroy.callsFake(async (id: string) => ({ id, success: true, errors: [] }));

    const result = await deleteFlows(connection, ['Flow_A', 'Flow_B']);

    expect(result).toStrictEqual({
      deactivated: ['Flow_B'],
      deleted: ['Flow_A', 'Flow_B'],
      failures: [{ developerName: 'Flow_A', stage: 'deactivate', message: 'Cannot deactivate' }],
    });
  });

  it('records a thrown deactivation error the same way, and still deletes the version', async () => {
    stubQueries(
      [{ Id: '300000000000001AAA', DeveloperName: 'Flow_A' }],
      [{ Id: '301000000000001AAA', DeveloperName: 'Flow_A' }],
    );
    tooling.update.rejects(new Error('INSUFFICIENT_ACCESS'));
    tooling.destroy.resolves({ id: '301000000000001AAA', success: true, errors: [] });

    const result = await deleteFlows(connection, ['Flow_A']);

    expect(result).toStrictEqual({
      deactivated: [],
      deleted: ['Flow_A'],
      failures: [{ developerName: 'Flow_A', stage: 'deactivate', message: 'INSUFFICIENT_ACCESS' }],
    });
  });

  it('records destroy failures (returned or thrown) per version and continues with the rest', async () => {
    stubQueries(
      [{ Id: '300000000000001AAA', DeveloperName: 'Flow_A' }],
      [
        { Id: '301000000000001AAA', DeveloperName: 'Flow_A' },
        { Id: '301000000000002AAA', DeveloperName: 'Flow_A' },
        { Id: '301000000000003AAA', DeveloperName: 'Flow_A' },
      ],
    );
    tooling.update.resolves({ id: '300000000000001AAA', success: true, errors: [] });
    tooling.destroy.callsFake(async (id: string) => {
      if (id === '301000000000001AAA') {
        return { success: false, errors: [{ message: 'In use' }, { message: 'Locked' }] };
      }
      if (id === '301000000000002AAA') {
        throw new Error('Network down');
      }
      return { id, success: true, errors: [] };
    });

    const result = await deleteFlows(connection, ['Flow_A']);

    expect(tooling.destroy.callCount).toBe(3);
    expect(result).toStrictEqual({
      deactivated: ['Flow_A'],
      deleted: ['Flow_A'],
      failures: [
        { developerName: 'Flow_A', stage: 'delete', message: 'In use, Locked' },
        { developerName: 'Flow_A', stage: 'delete', message: 'Network down' },
      ],
    });
  });

  it('calls onStage with deactivate then delete, once each', async () => {
    stubQueries([], []);
    const stages: FlowDeleteStage[] = [];

    await deleteFlows(connection, ['Flow_A'], { onStage: (stage) => stages.push(stage) });

    expect(stages).toStrictEqual(['deactivate', 'delete']);
  });

  it('splits more than FLOW_QUERY_CHUNK_SIZE names across several queries per stage', async () => {
    const autoFetchQuery = stubQueries([], []);
    const flowNames = Array.from({ length: 201 }, (_, i) => `Flow_${i}`);

    await deleteFlows(connection, flowNames);

    const queries = autoFetchQuery.args.map((args) => args[0] as string);
    expect(queries.filter((soql) => soql.startsWith(DEFINITION_QUERY))).toHaveLength(2);
    expect(queries.filter((soql) => soql.startsWith(VERSION_QUERY))).toHaveLength(2);
  });

  it('rejects when a query fails', async () => {
    $$.SANDBOX.stub(connection, 'autoFetchQuery').rejects(new Error('INVALID_SESSION_ID'));

    await expect(deleteFlows(connection, ['Flow_A'])).rejects.toThrow('INVALID_SESSION_ID');
  });
});
