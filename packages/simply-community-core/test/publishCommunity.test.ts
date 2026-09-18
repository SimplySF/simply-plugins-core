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
import { PollingClient } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { RetryAttemptTimeoutError } from '@simplysf/simply-core';
import sinon from 'sinon';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { publishCommunity } from '../src/publishCommunity.js';

const publishResponse = { id: '0DM000000000001', jobId: '08p000000000001', name: 'MySite', url: 'https://example.com' };

describe('publishCommunity', () => {
  const $$ = new TestContext({ sinon });
  const testOrg = new MockTestOrgData();

  beforeAll(async () => {
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    $$.restore();
  });

  it('requests a publish and returns the Connect API response once polling completes', async () => {
    const connection = await testOrg.getConnection();
    let requestCount = 0;
    $$.fakeConnectionRequest = async (request) => {
      requestCount++;
      expect(request).to.deep.include({ method: 'POST', url: '/connect/communities/0DM000000000001/publish' });
      return publishResponse;
    };
    $$.SANDBOX.stub(PollingClient, 'create').resolves({ subscribe: async () => undefined } as unknown as PollingClient);

    const result = await publishCommunity({ connection, networkId: '0DM000000000001', wait: 10 });

    expect(result).to.deep.equal(publishResponse);
    expect(requestCount).to.equal(1);
  });

  it('propagates a polling failure (e.g. CommunityPublishFailedError) from subscribe()', async () => {
    const connection = await testOrg.getConnection();
    $$.fakeConnectionRequest = async () => publishResponse;
    $$.SANDBOX.stub(PollingClient, 'create').resolves({
      subscribe: async () => {
        throw new Error('CommunityPublishFailedError');
      },
    } as unknown as PollingClient);

    await expect(publishCommunity({ connection, networkId: '0DM000000000001', wait: 10 })).rejects.toThrow(
      'CommunityPublishFailedError',
    );
  });

  it('retries the initial publish request when retryAttempts is set', async () => {
    const connection = await testOrg.getConnection();
    let requestCount = 0;
    $$.fakeConnectionRequest = async () => {
      requestCount++;
      if (requestCount === 1) {
        throw new Error('transient failure');
      }
      return publishResponse;
    };
    $$.SANDBOX.stub(PollingClient, 'create').resolves({ subscribe: async () => undefined } as unknown as PollingClient);

    const result = await publishCommunity({
      connection,
      networkId: '0DM000000000001',
      wait: 10,
      retryAttempts: 1,
      retryBackoff: 1,
    });

    expect(result).to.deep.equal(publishResponse);
    expect(requestCount).to.equal(2);
  });

  it('rejects instead of hanging forever when the publish request never settles', async () => {
    const connection = await testOrg.getConnection();
    $$.fakeConnectionRequest = async () => new Promise<never>(() => {});

    await expect(
      publishCommunity({
        connection,
        networkId: '0DM000000000001',
        wait: 10,
        requestTimeout: Duration.milliseconds(5),
      }),
    ).rejects.toThrow(RetryAttemptTimeoutError);
  });
});
