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
import type { VcsProvider } from '../../src/index.js';
import { getRemoteCommitStories } from '../../src/notify/getRemoteCommitStories.js';

function stubProvider(compareRefs: VcsProvider['compareRefs']): VcsProvider {
  return { compareRefs } as unknown as VcsProvider;
}

describe('getRemoteCommitStories', () => {
  it('returns N/A without calling the provider when a ref is missing', async () => {
    const compareRefs = vi.fn();
    await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', undefined, 'v1.1.0', 'ABC');

    expect(compareRefs).not.toHaveBeenCalled();
  });

  it('returns N/A without calling the provider when the refs are equal', async () => {
    const compareRefs = vi.fn();
    await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', 'v1.0.0', 'v1.0.0', 'ABC');

    expect(compareRefs).not.toHaveBeenCalled();
  });

  it('extracts and renders issue references from the compared commits', async () => {
    const compareRefs = vi.fn().mockResolvedValue([
      { sha: 'a', message: 'fix: ABC-123 broken thing', raw: {} },
      { sha: 'b', message: 'chore: bump deps', raw: {} },
    ]);

    const result = await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', 'v1.0.0', 'v1.1.0', 'ABC', {
      almBaseUrl: 'https://jira.example.com/browse',
    });

    expect(result.stories).toBe('ABC-123');
    expect(result.storiesWithUrl).toBe("<a href='https://jira.example.com/browse/ABC-123'>ABC-123</a>");
    expect(compareRefs).toHaveBeenCalledWith('group/project', 'v1.0.0', 'v1.1.0');
  });

  it('returns N/A when there are no commits', async () => {
    const compareRefs = vi.fn().mockResolvedValue([]);

    const result = await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', 'v1.0.0', 'v1.1.0', 'ABC');

    expect(result.stories).toBe('N/A');
  });

  it('returns N/A when no issue references are found in the commits', async () => {
    const compareRefs = vi.fn().mockResolvedValue([{ sha: 'a', message: 'chore: bump deps', raw: {} }]);

    const result = await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', 'v1.0.0', 'v1.1.0', 'ABC');

    expect(result.stories).toBe('N/A');
  });

  it('returns N/A and swallows errors from the provider', async () => {
    const compareRefs = vi.fn().mockRejectedValue(new Error('GitLab API error: 403 Forbidden'));

    const result = await getRemoteCommitStories(stubProvider(compareRefs), 'group/project', 'v1.0.0', 'v1.1.0', 'ABC');

    expect(result.stories).toBe('N/A');
  });
});
