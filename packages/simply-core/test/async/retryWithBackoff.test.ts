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
import { describe, expect, it } from 'vitest';
import { RetryAttemptTimeoutError, retryWithBackoff } from '../../src/async/retryWithBackoff.js';

/** A promise that never settles, to simulate a hung request. */
function hang<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe('retryWithBackoff', () => {
  it('should return the result on the first successful attempt without retrying', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        return 'ok';
      },
      { retryAttempts: 3, backoffFactor: 2, initialDelay: Duration.milliseconds(1) },
    );

    expect(result).to.equal('ok');
    expect(calls).to.equal(1);
  });

  it('should not retry when retryAttempts is 0', async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error('always fails');
        },
        { retryAttempts: 0, backoffFactor: 2, initialDelay: Duration.milliseconds(1) },
      ),
    ).rejects.toThrow('always fails');

    expect(calls).to.equal(1);
  });

  it('should retry until success within the configured attempts', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('transient failure');
        }
        return 'recovered';
      },
      { retryAttempts: 3, backoffFactor: 1, initialDelay: Duration.milliseconds(1) },
    );

    expect(result).to.equal('recovered');
    expect(calls).to.equal(3);
  });

  it('should throw the last error once retries are exhausted', async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error(`failure ${calls}`);
        },
        { retryAttempts: 2, backoffFactor: 1, initialDelay: Duration.milliseconds(1) },
      ),
    ).rejects.toThrow('failure 3');

    expect(calls).to.equal(3);
  });

  it('should not retry when shouldRetry returns false, even with attempts remaining', async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error('not retryable');
        },
        {
          retryAttempts: 3,
          backoffFactor: 1,
          initialDelay: Duration.milliseconds(1),
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow('not retryable');

    expect(calls).to.equal(1);
  });

  it('should call onRetry once per retry with the attempt number and delay, but not on the initial attempt', async () => {
    let calls = 0;
    const onRetryCalls: Array<{ attempt: number; delayMs: number }> = [];

    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('transient failure');
        }
        return 'recovered';
      },
      {
        retryAttempts: 3,
        backoffFactor: 2,
        initialDelay: Duration.milliseconds(1),
        onRetry: (_err, attempt, delay) => {
          onRetryCalls.push({ attempt, delayMs: delay.milliseconds });
        },
      },
    );

    expect(result).to.equal('recovered');
    expect(onRetryCalls).to.deep.equal([
      { attempt: 1, delayMs: 1 },
      { attempt: 2, delayMs: 2 },
    ]);
  });

  it('should not time out an attempt when attemptTimeout is not given', async () => {
    const result = await retryWithBackoff(async () => 'ok', {
      retryAttempts: 0,
      backoffFactor: 2,
      initialDelay: Duration.milliseconds(1),
    });

    expect(result).to.equal('ok');
  });

  it('should treat an attempt that never settles as a failure once attemptTimeout elapses', async () => {
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          return hang<string>();
        },
        {
          retryAttempts: 0,
          backoffFactor: 2,
          initialDelay: Duration.milliseconds(1),
          attemptTimeout: Duration.milliseconds(5),
        },
      ),
    ).rejects.toThrow(RetryAttemptTimeoutError);

    expect(calls).to.equal(1);
  });

  it('should retry a timed-out attempt like any other failure', async () => {
    let calls = 0;

    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          return hang<string>();
        }
        return 'recovered';
      },
      {
        retryAttempts: 1,
        backoffFactor: 1,
        initialDelay: Duration.milliseconds(1),
        attemptTimeout: Duration.milliseconds(5),
      },
    );

    expect(result).to.equal('recovered');
    expect(calls).to.equal(2);
  });

  it('should not time out an attempt that resolves before attemptTimeout elapses', async () => {
    const result = await retryWithBackoff(async () => 'fast', {
      retryAttempts: 0,
      backoffFactor: 2,
      initialDelay: Duration.milliseconds(1),
      attemptTimeout: Duration.seconds(30),
    });

    expect(result).to.equal('fast');
  });
});
