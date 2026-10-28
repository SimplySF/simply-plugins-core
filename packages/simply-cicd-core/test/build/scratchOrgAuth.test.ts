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

import { SfError } from '@salesforce/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateOrg } from '../../src/sfAuth.js';
import { ensureScratchOrgSession } from '../../src/build/scratchOrgAuth.js';

const authInfoCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@salesforce/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@salesforce/core')>();
  return { ...actual, AuthInfo: { create: authInfoCreateMock } };
});
vi.mock('../../src/sfAuth.js', () => ({ authenticateOrg: vi.fn() }));

const baseAuthFields = { username: 'scratch@test', clientId: 'id', instanceUrl: 'https://scratch.my.salesforce.com' };

describe('ensureScratchOrgSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes via @salesforce/core directly when a refresh token is present, without shelling out', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const handleAliasMock = vi.fn().mockResolvedValue(undefined);
    authInfoCreateMock.mockResolvedValue({
      save: saveMock,
      handleAliasAndDefaultSettings: handleAliasMock,
    });

    await ensureScratchOrgSession(
      { ...baseAuthFields, refreshToken: 'refresh-token-value', clientSecret: 'secret' },
      { setDefault: true, debug: false },
    );

    expect(authInfoCreateMock).toHaveBeenCalledWith({
      oauth2Options: {
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'refresh-token-value',
        loginUrl: 'https://scratch.my.salesforce.com',
      },
    });
    expect(saveMock).toHaveBeenCalledOnce();
    expect(handleAliasMock).toHaveBeenCalledWith({ setDefault: true, setDefaultDevHub: false });
    expect(authenticateOrg).not.toHaveBeenCalled();
  });

  it('does not set alias/default when setDefault is not requested', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const handleAliasMock = vi.fn().mockResolvedValue(undefined);
    authInfoCreateMock.mockResolvedValue({
      save: saveMock,
      handleAliasAndDefaultSettings: handleAliasMock,
    });

    await ensureScratchOrgSession({ ...baseAuthFields, refreshToken: 'refresh-token-value' }, {});

    expect(handleAliasMock).not.toHaveBeenCalled();
  });

  it('falls back to the existing JWT shell-out when there is no refresh token', async () => {
    await ensureScratchOrgSession(baseAuthFields, { jwtKeyFile: 'server.key', setDefault: true, debug: true });

    expect(authInfoCreateMock).not.toHaveBeenCalled();
    expect(authenticateOrg).toHaveBeenCalledWith({
      username: 'scratch@test',
      clientId: 'id',
      instanceUrl: 'https://scratch.my.salesforce.com',
      jwtKeyFile: 'server.key',
      setDefault: true,
      debug: true,
    });
  });

  it('throws when there is no refresh token and no --jwt-key-file was given', async () => {
    await expect(ensureScratchOrgSession(baseAuthFields, {})).rejects.toThrow(SfError);
    expect(authInfoCreateMock).not.toHaveBeenCalled();
    expect(authenticateOrg).not.toHaveBeenCalled();
  });
});
