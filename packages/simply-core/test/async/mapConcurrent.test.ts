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

import { describe, expect, it, vi } from 'vitest';
import { mapConcurrent } from '../../src/async/mapConcurrent.js';

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of source) {
    results.push(item);
  }
  return results;
}

async function* toAsyncIterable<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe('mapConcurrent', () => {
  it('processes every item from an async source exactly once', async () => {
    const results = await collect(mapConcurrent(toAsyncIterable([1, 2, 3, 4, 5]), 2, async (item) => item * 10));

    expect(results.sort((a, b) => a - b)).to.deep.equal([10, 20, 30, 40, 50]);
  });

  it('processes every item from a plain (sync) source exactly once', async () => {
    const results = await collect(mapConcurrent([1, 2, 3], 2, async (item) => item * 10));

    expect(results.sort((a, b) => a - b)).to.deep.equal([10, 20, 30]);
  });

  it('never runs more than `concurrency` mapper calls at once', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await collect(
      mapConcurrent(toAsyncIterable([1, 2, 3, 4, 5, 6, 7, 8]), 3, async (item) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        concurrent--;
        return item;
      }),
    );

    expect(maxConcurrent).to.equal(3);
  });

  it('starts the next item as soon as a slot frees, not after the whole batch finishes', async () => {
    const startOrder: number[] = [];
    const delays = [30, 5, 5];

    await collect(
      mapConcurrent(toAsyncIterable(delays), 2, async (delay) => {
        startOrder.push(delay);
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
        return delay;
      }),
    );

    // Item 0 (30ms) and item 1 (5ms) start together (pool size 2). Item 1 finishes first and frees
    // a slot immediately, so item 2 (5ms) starts well before item 0 (30ms) finishes — unlike
    // mapChunked, which would wait for the whole first pair before starting item 2.
    expect(startOrder).to.deep.equal([30, 5, 5]);
  });

  it('yields in completion order, not source order', async () => {
    // Fake timers keep this deterministic; real 10ms gaps are below Windows timer resolution.
    vi.useFakeTimers();
    try {
      const pending = collect(
        mapConcurrent(toAsyncIterable([30, 10, 20]), 3, async (delay) => {
          await new Promise((resolve) => {
            setTimeout(resolve, delay);
          });
          return delay;
        }),
      );
      await vi.advanceTimersByTimeAsync(30);

      expect(await pending).to.deep.equal([10, 20, 30]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('yields nothing for an empty source', async () => {
    expect(await collect(mapConcurrent(toAsyncIterable([]), 3, async (item) => item))).to.deep.equal([]);
  });

  it('handles a source smaller than the requested concurrency', async () => {
    const results = await collect(mapConcurrent(toAsyncIterable([1, 2]), 5, async (item) => item));

    expect(results.sort()).to.deep.equal([1, 2]);
  });

  it('propagates a mapper rejection instead of swallowing it', async () => {
    await expect(
      collect(
        mapConcurrent(toAsyncIterable([1, 2, 3]), 2, (item) =>
          item === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(item),
        ),
      ),
    ).rejects.toThrow('boom');
  });

  it('throws for a concurrency below 1', async () => {
    await expect(collect(mapConcurrent(toAsyncIterable([1]), 0, async (item) => item))).rejects.toThrow(
      'Concurrency must be a positive integer',
    );
  });

  it('throws for a non-integer concurrency', async () => {
    await expect(collect(mapConcurrent(toAsyncIterable([1]), 1.5, async (item) => item))).rejects.toThrow(
      'Concurrency must be a positive integer',
    );
  });
});
