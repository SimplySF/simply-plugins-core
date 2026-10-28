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

import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProvider } from '../src/index.js';
import { addGitRemote, toDependencyRef } from '../src/git.js';
import { VersionTagFormat } from '../src/build/versionTagFormat.js';

vi.mock('execa');

const REMOTE_URL = 'https://oauth2:secret-token@gitlab.com/group/project.git';
const vcsProvider = { buildAuthenticatedRemoteUrl: vi.fn(() => REMOTE_URL) } as unknown as VcsProvider;

function mockExistingRemotes(stdout: string): void {
  vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
    if (cmd === 'git' && args.length === 1 && args[0] === 'remote') return { stdout };
    return { stdout: '' };
  }) as never);
}

describe('addGitRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds the remote when it does not exist yet', async () => {
    mockExistingRemotes('origin');

    const alias = await addGitRemote('999', 'secret-token', 'group/project', vcsProvider);

    expect(alias).toBe('GITREMOTE999');
    expect(execa).toHaveBeenCalledWith('git', ['remote', 'add', 'GITREMOTE999', REMOTE_URL]);
  });

  it('overwrites the URL when a retried or reused job already added the remote', async () => {
    mockExistingRemotes('GITREMOTE999\r\norigin');

    const alias = await addGitRemote('999', 'secret-token', 'group/project', vcsProvider);

    expect(alias).toBe('GITREMOTE999');
    expect(execa).toHaveBeenCalledWith('git', ['remote', 'set-url', 'GITREMOTE999', REMOTE_URL]);
    expect(execa).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']));
  });

  it('does not mistake a remote whose name merely contains the alias for a match', async () => {
    mockExistingRemotes('GITREMOTE9990\norigin');

    await addGitRemote('999', 'secret-token', 'group/project', vcsProvider);

    expect(execa).toHaveBeenCalledWith('git', ['remote', 'add', 'GITREMOTE999', REMOTE_URL]);
  });

  it('throws when no access token is provided', async () => {
    await expect(addGitRemote('999', '', 'group/project', vcsProvider)).rejects.toThrow('accessToken is required');
    expect(execa).not.toHaveBeenCalled();
  });
});

describe('toDependencyRef', () => {
  const defaultFormat = VersionTagFormat.parse('v{MAJOR}.{MINOR}.{PATCH}.{BUILD}');
  const semverFormat = VersionTagFormat.parse('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');

  it.each([
    ['1.2.3-4', defaultFormat, 'v1.2.3.4'],
    ['1.2.3.4', defaultFormat, 'v1.2.3.4'],
    ['1.2.3-4', semverFormat, '1.2.3+4'],
    ['1.2.3.4', semverFormat, '1.2.3+4'],
  ])('should render a %s pin through the format', (pin, format, ref) => {
    expect(toDependencyRef(pin, format)).toBe(ref);
  });

  it('should keep the v<pin> reading for a pin that is not a full version', () => {
    expect(toDependencyRef('1.2.3-LATEST', semverFormat)).toBe('v1.2.3-LATEST');
  });
});
