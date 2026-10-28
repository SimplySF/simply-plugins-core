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

import { promises as fsPromises } from 'node:fs';
import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../../src/logger.js';
import { resolveDevHubs } from '../../src/build/devHubs.js';
import { getRemainingDailyScratchOrgs } from '../../src/sfOrg.js';
import { createScratchOrg } from '../../src/build/createScratchOrg.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});
vi.mock('../../src/logger.js', () => ({
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
vi.mock('../../src/build/devHubs.js', () => ({ resolveDevHubs: vi.fn() }));
vi.mock('../../src/sfOrg.js', () => ({ getRemainingDailyScratchOrgs: vi.fn() }));

const hubA = { alias: 'hub-a', username: 'a@hub.com', clientId: 'id-a', instanceUrl: 'https://a.com' };
const hubB = { alias: 'hub-b', username: 'b@hub.com', clientId: 'id-b', instanceUrl: 'https://b.com' };

function mockSfdxProjectJson(overrides: Record<string, unknown> = {}): void {
  vi.mocked(readSfdxProject).mockResolvedValue({
    packageDirectories: [{ default: true, definitionFile: 'config/project-scratch-def.json', ...overrides }],
  });
}

const createResult = { username: 'scratch@test', orgId: '00D...' };

describe('createScratchOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA, hubB]);
    vi.mocked(getRemainingDailyScratchOrgs).mockResolvedValue(5);
    mockSfdxProjectJson();
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'create' && args[2] === 'scratch') {
        return { stdout: JSON.stringify({ result: createResult }) };
      }
      if (cmd === 'sf' && args[0] === 'data' && args[1] === 'query') {
        return Promise.reject(new Error('no picklist'));
      }
      return { stdout: '' };
    }) as never);
  });

  it('should create a scratch org with the first Dev Hub that has capacity', async () => {
    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(resolveDevHubs).toHaveBeenCalledWith([hubA.alias, hubB.alias]);
    expect(result).toEqual(createResult);
    expect(execa).toHaveBeenCalledWith(
      'sf',
      expect.arrayContaining([
        'org',
        'create',
        'scratch',
        '--target-dev-hub',
        hubA.username,
        '--duration-days',
        '1',
        '--definition-file',
        'config/project-scratch-def.json',
      ]),
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith('SCRATCH_ORG_INFO.json', JSON.stringify(createResult, null, 2));
    expect(logger.success).toHaveBeenCalledWith(`Scratch org created successfully using Dev Hub ${hubA.alias}.`);
  });

  it('should skip a Dev Hub with no remaining daily capacity and try the next one', async () => {
    vi.mocked(getRemainingDailyScratchOrgs).mockImplementation(async (hub) => (hub === hubA.username ? 0 : 5));
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'create' && args[2] === 'scratch') {
        return { stdout: JSON.stringify({ result: createResult }) };
      }
      if (cmd === 'sf' && args[0] === 'data' && args[1] === 'query') {
        return Promise.reject(new Error('no picklist'));
      }
      return { stdout: '' };
    }) as never);

    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(result).toEqual(createResult);
    expect(logger.warn).toHaveBeenCalledWith(`Dev Hub ${hubA.alias} has no remaining scratch orgs. Skipping.`);
    expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--target-dev-hub', hubB.username]));
  });

  it('should try the next Dev Hub when creation fails with a scratch org limit error', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'create' && args[2] === 'scratch') {
        if (args.includes(hubA.username)) {
          const error = Object.assign(new Error('LIMIT_EXCEEDED'), {
            stdout: JSON.stringify({ message: 'LIMIT_EXCEEDED' }),
          });
          return Promise.reject(error);
        }
        return { stdout: JSON.stringify({ result: createResult }) };
      }
      if (cmd === 'sf' && args[0] === 'data' && args[1] === 'query') {
        return Promise.reject(new Error('no picklist'));
      }
      return { stdout: '' };
    }) as never);

    const result = await createScratchOrg({}, [hubA.alias, hubB.alias]);

    expect(result).toEqual(createResult);
    expect(logger.warn).toHaveBeenCalledWith(`Dev Hub ${hubA.alias} reached its daily limit. Trying next Dev Hub...`);
  });

  it('should throw immediately on a non-recoverable creation error, without trying the next Dev Hub', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'create' && args[2] === 'scratch') {
        return Promise.reject(new Error('unexpected failure'));
      }
      return { stdout: '' };
    }) as never);

    await expect(createScratchOrg({}, [hubA.alias, hubB.alias])).rejects.toThrow(
      `Scratch org creation failed with a non-recoverable error using Dev Hub ${hubA.alias}.`,
    );
    expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['--target-dev-hub', hubB.username]));
  });

  it('should throw once every Dev Hub has been exhausted', async () => {
    vi.mocked(getRemainingDailyScratchOrgs).mockResolvedValue(0);

    await expect(createScratchOrg({}, [hubA.alias, hubB.alias])).rejects.toThrow(
      'Scratch org creation failed for all available Dev Hubs.',
    );
  });

  it('should throw when no definitionFile is available anywhere', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });

    await expect(createScratchOrg({}, [hubA.alias])).rejects.toThrow(
      'You must specify a definitionFile in the default package directory in sfdx-project.json',
    );
  });

  it('should assign declared permission sets and permission set licenses after creation', async () => {
    mockSfdxProjectJson({
      packageMetadataAccess: { permissionSets: ['MyPermSet'], permissionSetLicenses: ['MyLicense'] },
    });
    vi.mocked(resolveDevHubs).mockResolvedValue([hubA]);
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'create' && args[2] === 'scratch') {
        return { stdout: JSON.stringify({ result: createResult }) };
      }
      if (cmd === 'sf' && args[0] === 'org' && args[1] === 'assign') {
        return { stdout: JSON.stringify({ status: 0 }) };
      }
      if (cmd === 'sf' && args[0] === 'data' && args[1] === 'query') {
        return Promise.reject(new Error('no picklist'));
      }
      return { stdout: '' };
    }) as never);

    await createScratchOrg({}, [hubA.alias]);

    expect(execa).toHaveBeenCalledWith('sf', ['org', 'assign', 'permset', '--json', '--name', 'MyPermSet']);
    expect(execa).toHaveBeenCalledWith('sf', ['org', 'assign', 'permset-license', '--json', '--name', 'MyLicense']);
  });
});
