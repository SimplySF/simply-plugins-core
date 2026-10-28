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

import type { AuthInfo } from '@salesforce/core';
import { SfError } from '@salesforce/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDevHubs } from '../../src/build/devHubs.js';

const authInfoCreateMock = vi.hoisted(() => vi.fn());
/** Aliases saved in the CLI's state, as `sf alias set` / `--alias` on a login would save them. */
const savedAliases = vi.hoisted((): Record<string, string> => ({}));

vi.mock('@salesforce/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@salesforce/core')>();
  return {
    ...actual,
    AuthInfo: { create: authInfoCreateMock },
    StateAggregator: {
      getInstance: async () => ({
        aliases: { resolveUsername: (aliasOrUsername: string) => savedAliases[aliasOrUsername] ?? aliasOrUsername },
      }),
    },
  };
});

function fakeAuthInfo(username: string, fields: Record<string, unknown>): AuthInfo {
  return { getUsername: () => username, getFields: () => fields } as unknown as AuthInfo;
}

describe('resolveDevHubs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves each alias via AuthInfo.create, mapping clientId/instanceUrl/privateKey', async () => {
    authInfoCreateMock.mockImplementation(async (options: { username?: string } = {}) => {
      const username = options.username as string;
      return fakeAuthInfo(username, {
        clientId: `${username}-client-id`,
        instanceUrl: `https://${username}.my.salesforce.com`,
        privateKey: `/keys/${username}.key`,
      });
    });

    const result = await resolveDevHubs(['main', 'backup']);

    expect(authInfoCreateMock).toHaveBeenCalledWith({ username: 'main' });
    expect(authInfoCreateMock).toHaveBeenCalledWith({ username: 'backup' });
    expect(result).toEqual([
      {
        alias: 'main',
        username: 'main',
        instanceUrl: 'https://main.my.salesforce.com',
        clientId: 'main-client-id',
        privateKeyFile: '/keys/main.key',
      },
      {
        alias: 'backup',
        username: 'backup',
        instanceUrl: 'https://backup.my.salesforce.com',
        clientId: 'backup-client-id',
        privateKeyFile: '/keys/backup.key',
      },
    ]);
  });

  it('omits privateKeyFile when the Dev Hub was not JWT-authenticated', async () => {
    authInfoCreateMock.mockResolvedValue(
      fakeAuthInfo('hub@example.com', { clientId: 'id', instanceUrl: 'https://hub.my.salesforce.com' }),
    );

    const [hub] = await resolveDevHubs(['hub']);

    expect(hub.privateKeyFile).toBeUndefined();
  });

  it("resolves an alias to its auth's username first, since AuthInfo.create only takes a username", async () => {
    savedAliases['my-hub'] = 'hub@example.com';
    authInfoCreateMock.mockImplementation(async ({ username }: { username: string }) =>
      fakeAuthInfo(username, { instanceUrl: 'https://hub.my.salesforce.com' }),
    );

    const [byAlias, byUsername] = await resolveDevHubs(['my-hub', 'hub@example.com']);

    expect(authInfoCreateMock).toHaveBeenCalledTimes(2);
    expect(authInfoCreateMock).toHaveBeenNthCalledWith(1, { username: 'hub@example.com' });
    expect(authInfoCreateMock).toHaveBeenNthCalledWith(2, { username: 'hub@example.com' });
    expect(byAlias).toMatchObject({ alias: 'my-hub', username: 'hub@example.com' });
    expect(byUsername).toMatchObject({ alias: 'hub@example.com', username: 'hub@example.com' });
  });

  it('returns an empty array for no aliases', async () => {
    expect(await resolveDevHubs([])).toEqual([]);
  });

  it('propagates a resolution failure (e.g. an unauthenticated alias)', async () => {
    authInfoCreateMock.mockRejectedValue(new SfError('No authorization', 'NamedOrgNotFoundError'));

    await expect(resolveDevHubs(['missing'])).rejects.toThrow('No authorization');
  });
});
