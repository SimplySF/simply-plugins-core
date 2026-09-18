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
import { Connection, SfError } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import sinon from 'sinon';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkPublishStatus } from '../src/checkPublishStatus.js';

describe('checkPublishStatus', () => {
  const $$ = new TestContext({ sinon });
  const testOrg = new MockTestOrgData();

  beforeAll(async () => {
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    $$.restore();
  });

  it('should report not completed while the job has not finished', async () => {
    const connection = await testOrg.getConnection();
    $$.SANDBOX.stub(Connection.prototype, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [{ Id: '08p000000000001', Status: 'InProgress', FinishedAt: null, Error: null }],
    });

    const poll = checkPublishStatus(connection, '08p000000000001');

    await expect(poll()).resolves.to.deep.equal({ completed: false });
  });

  it('should report not completed when the record is not yet queryable', async () => {
    const connection = await testOrg.getConnection();
    $$.SANDBOX.stub(Connection.prototype, 'query').resolves({ done: true, totalSize: 0, records: [] });

    const poll = checkPublishStatus(connection, '08p000000000001');

    await expect(poll()).resolves.to.deep.equal({ completed: false });
  });

  it('should report not completed, not hang forever, when the query never settles', async () => {
    const connection = await testOrg.getConnection();
    $$.SANDBOX.stub(Connection.prototype, 'query').returns(
      new Promise(() => {}) as unknown as ReturnType<Connection['query']>,
    );

    const poll = checkPublishStatus(connection, '08p000000000001', Duration.milliseconds(5));

    await expect(poll()).resolves.to.deep.equal({ completed: false });
  });

  it('should report completed once the job finishes successfully', async () => {
    const connection = await testOrg.getConnection();
    $$.SANDBOX.stub(Connection.prototype, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [
        { Id: '08p000000000001', Status: 'Completed', FinishedAt: '2026-08-19T00:00:00.000+0000', Error: null },
      ],
    });

    const poll = checkPublishStatus(connection, '08p000000000001');

    await expect(poll()).resolves.to.deep.equal({ completed: true, payload: { status: 'Completed' } });
  });

  it('should throw a CommunityPublishFailedError once the job finishes with an error', async () => {
    const connection = await testOrg.getConnection();
    $$.SANDBOX.stub(Connection.prototype, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [
        {
          Id: '08p000000000001',
          Status: 'Failed',
          FinishedAt: '2026-08-19T00:00:00.000+0000',
          Error: 'Something went wrong while publishing.',
        },
      ],
    });

    const poll = checkPublishStatus(connection, '08p000000000001');

    try {
      await poll();
      expect.fail('should have thrown CommunityPublishFailedError');
    } catch (err) {
      const error = err as SfError;
      expect(error.name).to.equal('CommunityPublishFailedError');
      expect(error.message).to.include('Something went wrong while publishing.');
    }
  });
});
