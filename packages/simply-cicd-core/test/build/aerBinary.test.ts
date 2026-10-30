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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { aerPluginBinaryPath, readAerVersion, resolveAerBinary } from '../../src/build/aerBinary.js';

vi.mock('execa');
vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() },
}));

const BINARY = process.platform === 'win32' ? 'aer.exe' : 'aer';

let root: string;

/** Write an executable stand-in for the aer binary. */
async function fakeBinary(file: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '#!/bin/sh\n');
  await fs.chmod(file, 0o755);
  return file;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aer-binary-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('aerPluginBinaryPath', () => {
  it("mirrors the aer sf plugin's storage directory per platform", () => {
    expect(aerPluginBinaryPath({ LOCALAPPDATA: 'C:\\Local' }, 'win32', 'C:\\Users\\me')).toBe(
      path.join('C:\\Local', 'aer-sf-plugin', 'aer-bin', 'aer.exe'),
    );
    expect(aerPluginBinaryPath({}, 'darwin', '/Users/me')).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'aer-sf-plugin', 'aer-bin', 'aer'),
    );
    expect(aerPluginBinaryPath({ XDG_DATA_HOME: '/data' }, 'linux', '/home/me')).toBe(
      path.join('/data', 'aer-sf-plugin', 'aer-bin', 'aer'),
    );
    expect(aerPluginBinaryPath({}, 'linux', '/home/me')).toBe(
      path.join('/home/me', '.local', 'share', 'aer-sf-plugin', 'aer-bin', 'aer'),
    );
  });
});

describe('resolveAerBinary', () => {
  /** An environment where only what a test adds can be found. */
  function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { PATH: '', LOCALAPPDATA: path.join(root, 'local'), XDG_DATA_HOME: path.join(root, 'local'), ...extra };
  }

  const resolve = (options: Parameters<typeof resolveAerBinary>[0]): Promise<string> =>
    resolveAerBinary({ platform: process.platform === 'win32' ? 'win32' : 'linux', homeDir: root, ...options });

  it('prefers --aer-path, and fails when it does not exist', async () => {
    const explicit = await fakeBinary(path.join(root, 'explicit', BINARY));
    const fromEnv = await fakeBinary(path.join(root, 'env', BINARY));

    expect(await resolve({ aerPath: explicit, env: isolatedEnv({ AER_BIN: fromEnv }) })).toBe(explicit);
    await expect(resolve({ aerPath: path.join(root, 'nope'), env: isolatedEnv() })).rejects.toThrow(/--aer-path/);
  });

  it('uses AER_BIN next, and warns and falls back when it is wrong', async () => {
    const fromEnv = await fakeBinary(path.join(root, 'env', BINARY));
    expect(await resolve({ env: isolatedEnv({ AER_BIN: fromEnv }) })).toBe(fromEnv);

    const onPath = await fakeBinary(path.join(root, 'bin', BINARY));
    expect(await resolve({ env: isolatedEnv({ AER_BIN: path.join(root, 'gone'), PATH: path.dirname(onPath) }) })).toBe(
      onPath,
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AER_BIN'));
  });

  it("uses the aer sf plugin's download before PATH", async () => {
    const platform = process.platform === 'win32' ? 'win32' : 'linux';
    const env = isolatedEnv();
    const downloaded = await fakeBinary(aerPluginBinaryPath(env, platform, root));
    const onPath = await fakeBinary(path.join(root, 'bin', BINARY));

    expect(await resolve({ env: { ...env, PATH: path.dirname(onPath) } })).toBe(downloaded);
  });

  it('finds aer on PATH last', async () => {
    const onPath = await fakeBinary(path.join(root, 'bin', BINARY));
    expect(
      await resolve({
        env: isolatedEnv({ PATH: ['', path.join(root, 'empty'), path.dirname(onPath)].join(path.delimiter) }),
      }),
    ).toBe(onPath);
  });

  it('fails with an install hint when aer is nowhere', async () => {
    await expect(resolve({ env: isolatedEnv() })).rejects.toThrow(/octoberswimmer\/aer-dist.*AER_BIN/);
  });
});

describe('readAerVersion', () => {
  it('reads the version aer reports, with auto-update off', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'aer version v1.4.45\n' } as never);

    expect(await readAerVersion('/bin/aer')).toBe('v1.4.45');
    expect(execa).toHaveBeenCalledWith('/bin/aer', ['--version'], { env: { AER_AUTOUPDATE_DISABLED: '1' } });
  });

  it('never fails the run', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('boom'));
    expect(await readAerVersion('/bin/aer')).toBeUndefined();

    vi.mocked(execa).mockResolvedValue({ stdout: 'something else' } as never);
    expect(await readAerVersion('/bin/aer')).toBeUndefined();
  });
});
