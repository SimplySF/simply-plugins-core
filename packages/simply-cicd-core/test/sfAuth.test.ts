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
import { logger } from '../src/logger.js';
import { authenticateOrg } from '../src/sfAuth.js';

const authInfoCreateMock = vi.hoisted(() => vi.fn());
const parseSfdxAuthUrlMock = vi.hoisted(() => vi.fn());
const identifyPossibleScratchOrgsMock = vi.hoisted(() => vi.fn());
const removeAuthMock = vi.hoisted(() => vi.fn());
const projectResolveMock = vi.hoisted(() => vi.fn());

vi.mock('@salesforce/core', async (importOriginal) => ({
  // SfdcUrl and SfError stay real, so the Lightning-domain check is exercised for real.
  ...(await importOriginal<typeof import('@salesforce/core')>()),
  AuthInfo: {
    create: authInfoCreateMock,
    parseSfdxAuthUrl: parseSfdxAuthUrlMock,
    identifyPossibleScratchOrgs: identifyPossibleScratchOrgsMock,
  },
  AuthRemover: { create: async () => ({ removeAuth: removeAuthMock }) },
  SfProject: { resolve: projectResolveMock },
}));
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));

const fields = {
  username: 'ci@example.com',
  orgId: '00D000000000001',
  instanceUrl: 'https://acme.my.salesforce.com',
  accessToken: 'SECRET-ACCESS-TOKEN',
};
const authInfo = {
  save: vi.fn(),
  handleAliasAndDefaultSettings: vi.fn(),
  getFields: vi.fn(() => ({ ...fields })),
};

const jwtOptions = {
  username: 'ci@example.com',
  clientId: 'client-id',
  jwtKeyFile: 'server.key',
  instanceUrl: 'https://acme.my.salesforce.com',
};

describe('authenticateOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authInfoCreateMock.mockResolvedValue(authInfo);
    projectResolveMock.mockRejectedValue(new Error('not in a project'));
  });

  describe('JWT', () => {
    it('logs in, saves, applies alias/defaults, and returns the auth fields', async () => {
      const result = await authenticateOrg({ ...jwtOptions, alias: 'hub', setDefaultDevHub: true });

      expect(authInfoCreateMock).toHaveBeenCalledWith({
        username: 'ci@example.com',
        oauth2Options: {
          clientId: 'client-id',
          privateKeyFile: 'server.key',
          loginUrl: 'https://acme.my.salesforce.com',
        },
      });
      expect(authInfo.save).toHaveBeenCalled();
      expect(authInfo.handleAliasAndDefaultSettings).toHaveBeenCalledWith({
        alias: 'hub',
        setDefault: false,
        setDefaultDevHub: true,
      });
      expect(authInfo.getFields).toHaveBeenCalledWith(true);
      expect(identifyPossibleScratchOrgsMock).toHaveBeenCalledWith(fields, authInfo);
      expect(result).toEqual({ success: true, username: 'ci@example.com', result: fields });
      expect(logger.success).toHaveBeenCalledWith('Successfully authenticated to org: hub');
    });

    it("falls back to the project's sfdcLoginUrl when no instance URL is given", async () => {
      projectResolveMock.mockResolvedValue({
        resolveProjectConfig: async () => ({ sfdcLoginUrl: 'https://test.salesforce.com' }),
      });

      await authenticateOrg({ ...jwtOptions, instanceUrl: undefined });

      expect(authInfoCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          oauth2Options: expect.objectContaining({ loginUrl: 'https://test.salesforce.com' }),
        }),
      );
    });

    it('falls back to production outside a project', async () => {
      await authenticateOrg({ ...jwtOptions, instanceUrl: '' });

      expect(authInfoCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          oauth2Options: expect.objectContaining({ loginUrl: 'https://login.salesforce.com' }),
        }),
      );
    });

    it('refuses a Lightning domain instance URL before attempting a login', async () => {
      await expect(
        authenticateOrg({ ...jwtOptions, instanceUrl: 'https://acme.lightning.force.com' }),
      ).rejects.toMatchObject({ name: 'LightningDomain' });
      expect(authInfoCreateMock).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Authentication failed for ci@example.com');
    });

    it('replaces an existing auth file for the same user, as sf org login jwt does', async () => {
      authInfoCreateMock
        .mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'AuthInfoOverwriteError' }))
        .mockResolvedValueOnce(authInfo);

      await authenticateOrg(jwtOptions);

      expect(removeAuthMock).toHaveBeenCalledWith('ci@example.com');
      expect(authInfoCreateMock).toHaveBeenCalledTimes(2);
      expect(authInfo.save).toHaveBeenCalled();
    });

    it('logs and rethrows any other login failure', async () => {
      authInfoCreateMock.mockRejectedValue(new Error("invalid_grant: user hasn't approved this consumer"));

      await expect(authenticateOrg(jwtOptions)).rejects.toThrow('invalid_grant');
      expect(removeAuthMock).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Authentication failed for ci@example.com');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('invalid_grant'));
    });
  });

  describe('SFDX auth URL', () => {
    it('logs in from the parsed URL with no temp file, blanking the client secret in the result', async () => {
      const oauth2Options = {
        clientId: 'PlatformCLI',
        refreshToken: 'refresh',
        loginUrl: 'https://acme.my.salesforce.com',
      };
      parseSfdxAuthUrlMock.mockReturnValue(oauth2Options);

      const result = await authenticateOrg({
        authUrl: 'force://PlatformCLI::refresh@acme.my.salesforce.com',
        alias: 'prod',
        setDefault: true,
      });

      expect(parseSfdxAuthUrlMock).toHaveBeenCalledWith('force://PlatformCLI::refresh@acme.my.salesforce.com');
      expect(authInfoCreateMock).toHaveBeenCalledWith({ oauth2Options });
      expect(authInfo.handleAliasAndDefaultSettings).toHaveBeenCalledWith({
        alias: 'prod',
        setDefault: true,
        setDefaultDevHub: false,
      });
      expect(result.result).toEqual({ clientSecret: '', ...fields });
    });
  });

  it('logs only identifying fields in debug mode, never tokens', async () => {
    await authenticateOrg({ ...jwtOptions, debug: true });

    expect(logger.debug).toHaveBeenCalledWith('Authenticated:', {
      username: 'ci@example.com',
      orgId: '00D000000000001',
      instanceUrl: 'https://acme.my.salesforce.com',
    });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('SECRET-ACCESS-TOKEN');
  });
});
