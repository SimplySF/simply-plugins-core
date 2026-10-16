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
import type { FlowVersionPruneCandidate } from '../src/flowTypes.js';
import { deleteFlowVersions, findObsoleteFlowVersions, pruneObsoleteFlowVersions } from '../src/flowVersionPrune.js';
import { queryResult, stubToolingSobject, type ToolingStubs } from './flowTestUtils.js';

const OBSOLETE_RECORDS = [
  { Id: '301000000000001AAA', Definition: { DeveloperName: 'My_Flow' } },
  { Id: '301000000000002AAA', Definition: { DeveloperName: 'Other_Flow' } },
];

const CANDIDATES: FlowVersionPruneCandidate[] = [
  { id: '301000000000001AAA', developerName: 'My_Flow' },
  { id: '301000000000002AAA', developerName: 'Other_Flow' },
];

describe('obsolete Flow version pruning', () => {
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

  describe('findObsoleteFlowVersions', () => {
    it('queries only Status = Obsolete versions of the named flows, through the Tooling API', async () => {
      const autoFetchQuery = $$.SANDBOX.stub(connection, 'autoFetchQuery').resolves(queryResult(OBSOLETE_RECORDS));

      const candidates = await findObsoleteFlowVersions(connection, ['My_Flow', 'Other_Flow']);

      expect(candidates).toStrictEqual(CANDIDATES);
      expect(autoFetchQuery.callCount).toBe(1);
      const [soql, options] = autoFetchQuery.firstCall.args;
      expect(soql).toContain("Status = 'Obsolete'");
      expect(soql).toContain("Definition.DeveloperName IN ('My_Flow','Other_Flow')");
      expect(options).toStrictEqual({ tooling: true });
    });

    it('returns [] without querying when given no names', async () => {
      const autoFetchQuery = $$.SANDBOX.stub(connection, 'autoFetchQuery');

      expect(await findObsoleteFlowVersions(connection, [])).toStrictEqual([]);
      expect(autoFetchQuery.called).toBe(false);
    });
  });

  describe('deleteFlowVersions', () => {
    it('destroys each candidate in order and collects failures per version', async () => {
      tooling.destroy.callsFake(async (id: string) => {
        if (id === '301000000000001AAA') {
          return { success: false, errors: [{ message: 'In use' }] };
        }
        return { id, success: true, errors: [] };
      });

      const result = await deleteFlowVersions(connection, [
        ...CANDIDATES,
        { id: '301000000000003AAA', developerName: 'Third_Flow' },
      ]);

      expect(tooling.destroy.args.map((args) => args[0] as string)).toStrictEqual([
        '301000000000001AAA',
        '301000000000002AAA',
        '301000000000003AAA',
      ]);
      expect(result).toStrictEqual({
        deleted: ['Other_Flow', 'Third_Flow'],
        failures: [{ developerName: 'My_Flow', message: 'In use' }],
      });
    });

    it('records a thrown destroy error as a failure', async () => {
      tooling.destroy.rejects(new Error('Network down'));

      const result = await deleteFlowVersions(connection, [CANDIDATES[0]]);

      expect(result).toStrictEqual({ deleted: [], failures: [{ developerName: 'My_Flow', message: 'Network down' }] });
    });
  });

  describe('pruneObsoleteFlowVersions', () => {
    it('dryRun returns the candidates and never destroys anything', async () => {
      $$.SANDBOX.stub(connection, 'autoFetchQuery').resolves(queryResult(OBSOLETE_RECORDS));
      const stages: string[] = [];

      const result = await pruneObsoleteFlowVersions(connection, ['My_Flow', 'Other_Flow'], {
        dryRun: true,
        onStage: (stage) => stages.push(stage),
      });

      expect(result).toStrictEqual({ dryRun: true, candidates: CANDIDATES, deleted: [], failures: [] });
      expect(tooling.destroy.called).toBe(false);
      expect(stages).toStrictEqual(['query']);
    });

    it('destroys every candidate when not a dry run, collecting failures per version', async () => {
      $$.SANDBOX.stub(connection, 'autoFetchQuery').resolves(queryResult(OBSOLETE_RECORDS));
      tooling.destroy.callsFake(async (id: string) =>
        id === '301000000000002AAA'
          ? { success: false, errors: [{ message: 'Locked' }] }
          : { id, success: true, errors: [] },
      );
      const stages: string[] = [];

      const result = await pruneObsoleteFlowVersions(connection, ['My_Flow', 'Other_Flow'], {
        onStage: (stage) => stages.push(stage),
      });

      expect(tooling.destroy.callCount).toBe(2);
      expect(result).toStrictEqual({
        dryRun: false,
        candidates: CANDIDATES,
        deleted: ['My_Flow'],
        failures: [{ developerName: 'Other_Flow', message: 'Locked' }],
      });
      expect(stages).toStrictEqual(['query', 'delete']);
    });
  });
});
