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
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../../src/logger.js';
import { deployProjectSource } from '../../src/sfDeploy.js';
import { ensureScratchOrgSession } from '../../src/build/scratchOrgAuth.js';
import { pushToScratch } from '../../src/build/pushScratch.js';

vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn() } };
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
vi.mock('../../src/build/scratchOrgAuth.js', () => ({ ensureScratchOrgSession: vi.fn() }));
vi.mock('../../src/sfDeploy.js', () => ({ deployProjectSource: vi.fn() }));

const mockScratchOrgInfo = { authFields: { username: 'test', clientId: 'id', instanceUrl: 'url' } };

/** The options pushToScratch hands to deployProjectSource. */
function deployOptions(): { sourceDirs: string[]; ignoreWarnings: boolean; wait: { minutes: number } } {
  return vi.mocked(deployProjectSource).mock.calls[0][0] as never;
}

describe('pushToScratch', () => {
  let projectDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'push-scratch-'));
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockScratchOrgInfo));
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });
    vi.mocked(deployProjectSource).mockResolvedValue({ status: 'Succeeded', componentCount: 3 } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should authenticate and push the tracked local changes to the scratch org', async () => {
    await pushToScratch({ jwtKeyFile: 'key.file' });

    expect(ensureScratchOrgSession).toHaveBeenCalledWith(mockScratchOrgInfo.authFields, {
      jwtKeyFile: 'key.file',
      setDefault: true,
      debug: undefined,
    });
    expect(deployOptions()).toMatchObject({ sourceDirs: [], ignoreWarnings: false });
    expect(deployOptions().wait.minutes).toBe(120);
    expect(logger.success).toHaveBeenCalledWith('Source pushed to scratch org.');
  });

  it('should delete External Client App metadata anywhere in the project, and nothing else', async () => {
    const write = async (relative: string): Promise<string> => {
      const file = path.join(projectDir, relative);
      await fsPromises.mkdir(path.dirname(file), { recursive: true });
      await fsPromises.writeFile(file, '<xml/>');
      return file;
    };
    const eca = await write('force-app/main/default/externalClientApps/App.eca-meta.xml');
    const ecaOauth = await write('force-app/main/default/extlClntAppOauthSettings/App.ecaOauth-meta.xml');
    const kept = await write('force-app/main/default/classes/Foo.cls-meta.xml');
    const vendored = await write('node_modules/pkg/App.eca-meta.xml');

    await pushToScratch({ jwtKeyFile: 'key.file' });

    await expect(fsPromises.access(eca)).rejects.toThrow();
    await expect(fsPromises.access(ecaOauth)).rejects.toThrow();
    await expect(fsPromises.access(kept)).resolves.toBeUndefined();
    await expect(fsPromises.access(vendored)).resolves.toBeUndefined();
  });

  it('should pass --ignore-warnings through when requested', async () => {
    await pushToScratch({ jwtKeyFile: 'key.file', ignoreWarnings: true });

    expect(deployOptions().ignoreWarnings).toBe(true);
  });

  it('should push scratchOrgSourceDir and the default package directory seedMetadata path, when declared', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [{ default: true, seedMetadata: { path: 'seed-app' } }],
    });

    await pushToScratch({ jwtKeyFile: 'key.file', scratchOrgSourceDir: 'force-app' });

    expect(deployOptions().sourceDirs).toEqual(['force-app', 'seed-app']);
  });

  it('should not add a seedMetadata source dir when none is declared', async () => {
    await pushToScratch({ jwtKeyFile: 'key.file', scratchOrgSourceDir: 'force-app' });

    expect(deployOptions().sourceDirs).toEqual(['force-app']);
  });

  it('should fail the push when the deploy does not fully succeed', async () => {
    vi.mocked(deployProjectSource).mockRejectedValue(
      new Error('Deploy 0Af finished with status Failed (2 component failures).'),
    );

    await expect(pushToScratch({ jwtKeyFile: 'key.file' })).rejects.toThrow('finished with status Failed');
    expect(logger.success).not.toHaveBeenCalled();
  });
});
