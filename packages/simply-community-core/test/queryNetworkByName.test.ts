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
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { RetryAttemptTimeoutError } from '@simplysf/simply-core';
import sinon from 'sinon';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { queryNetworkByName } from '../src/queryNetworkByName.js';

const network = { attributes: { type: 'Network' }, Id: '0DB000000000001', Name: 'My Site' };

describe('queryNetworkByName', () => {
  const $$ = new TestContext({ sinon });
  const testOrg = new MockTestOrgData();

  beforeAll(async () => {
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    $$.restore();
  });

  it('returns the single matching Network, queried through a request jsforce cancels on timeout', async () => {
    const connection = await testOrg.getConnection();
    let seen: { request: unknown; options: unknown } | undefined;
    $$.fakeConnectionRequest = async (request, options) => {
      seen = { request, options };
      return { done: true, totalSize: 1, records: [network] };
    };

    await expect(queryNetworkByName(connection, "Bob's Site", Duration.seconds(30))).resolves.to.deep.equal({
      Id: '0DB000000000001',
      Name: 'My Site',
    });
    expect(seen?.request).to.deep.equal({
      method: 'GET',
      url: `/query?q=${encodeURIComponent("SELECT Id, Name FROM Network WHERE Name = 'Bob\\'s Site'")}`,
    });
    expect(seen?.options).to.deep.equal({ timeout: 31_000 });
  });

  it('throws SingleRecordQuery_NoRecords when nothing matches', async () => {
    const connection = await testOrg.getConnection();
    $$.fakeConnectionRequest = async () => ({ done: true, totalSize: 0, records: [] });

    await expect(queryNetworkByName(connection, 'Missing')).rejects.toMatchObject({
      name: 'SingleRecordQuery_NoRecords',
    });
  });

  it('throws SingleRecordQuery_MultipleRecords when more than one matches', async () => {
    const connection = await testOrg.getConnection();
    $$.fakeConnectionRequest = async () => ({ done: true, totalSize: 2, records: [network, network] });

    await expect(queryNetworkByName(connection, 'My Site')).rejects.toMatchObject({
      name: 'SingleRecordQuery_MultipleRecords',
    });
  });

  it('rejects instead of hanging forever when the query never settles', async () => {
    const connection = await testOrg.getConnection();
    $$.fakeConnectionRequest = async () => new Promise<never>(() => {});

    await expect(queryNetworkByName(connection, 'My Site', Duration.milliseconds(5))).rejects.toThrow(
      RetryAttemptTimeoutError,
    );
  });
});
