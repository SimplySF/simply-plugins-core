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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthInfo, resolveOrg } from '../src/resolveOrg.js';

const orgCreateMock = vi.hoisted(() => vi.fn());
const authInfoCreateMock = vi.hoisted(() => vi.fn());
const reloadMock = vi.hoisted(() => vi.fn());
const savedAliases = vi.hoisted((): Record<string, string> => ({ 'my-org': 'me@example.com' }));

vi.mock('@salesforce/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@salesforce/core')>()),
  Org: { create: orgCreateMock },
  AuthInfo: { create: authInfoCreateMock },
  ConfigAggregator: { create: async () => ({ reload: reloadMock }) },
  StateAggregator: {
    getInstance: async () => ({
      aliases: { resolveUsername: (aliasOrUsername: string) => savedAliases[aliasOrUsername] ?? aliasOrUsername },
    }),
  },
}));

const freshAggregator = { fresh: true };

describe('resolveOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgCreateMock.mockResolvedValue({ org: true });
    reloadMock.mockResolvedValue(freshAggregator);
  });

  it.each(['my-org', 'me@example.com'])(
    'hands an alias or username (%s) to Org.create, which resolves aliases',
    async (aliasOrUsername) => {
      expect(await resolveOrg(aliasOrUsername)).toEqual({ org: true });
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername, isDevHub: undefined });
      expect(reloadMock).not.toHaveBeenCalled();
    },
  );

  it('trims surrounding whitespace, as a CI variable may carry it', async () => {
    await resolveOrg(' my-org\n', { isDevHub: true });
    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'my-org', isDevHub: true });
  });

  it.each([undefined, '', '  '])(
    'uses the default org for %j, re-reading config so a default set earlier in this process is seen',
    async (aliasOrUsername) => {
      await resolveOrg(aliasOrUsername);
      expect(reloadMock).toHaveBeenCalledOnce();
      expect(orgCreateMock).toHaveBeenCalledWith({ aggregator: freshAggregator, isDevHub: undefined });
    },
  );

  it('uses the default Dev Hub for a blank value with isDevHub', async () => {
    await resolveOrg('', { isDevHub: true });
    expect(orgCreateMock).toHaveBeenCalledWith({ aggregator: freshAggregator, isDevHub: true });
  });
});

describe('resolveAuthInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves an alias to its username, since AuthInfo.create only takes a username', async () => {
    await resolveAuthInfo('my-org');
    expect(authInfoCreateMock).toHaveBeenCalledWith({ username: 'me@example.com' });
  });

  it('passes a username through unchanged', async () => {
    await resolveAuthInfo('other@example.com');
    expect(authInfoCreateMock).toHaveBeenCalledWith({ username: 'other@example.com' });
  });
});
