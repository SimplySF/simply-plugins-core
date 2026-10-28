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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { addGitRemote } from '../../src/git.js';
import { logger } from '../../src/logger.js';
import { createFallbackTag } from '../../src/build/createFallbackTag.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});
vi.mock('../../src/git.js', () => ({ addGitRemote: vi.fn() }));
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

const baseOptions = {
  ciCommitRefName: 'main',
  ciProjectPath: 'bems/my-project',
  projectAccessToken: 'secret-token',
  ciPipelineId: '999',
  out: 'subscriberPackageVersionId.env',
  vcsHost: 'gitlab.com',
  vcsProvider: 'gitlab' as const,
};

describe('createFallbackTag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addGitRemote).mockResolvedValue('origin-alias');
    vi.mocked(readSfdxProject).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  it('should successfully create and push a fallback tag incrementing the suffix and writing the output env', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.1.0\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v1.1.0   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(result).toEqual({ created: true, tag: 'v1.1.0-1', packageId: '04t123456789012' });
    expect(addGitRemote).toHaveBeenCalledWith('999', 'secret-token', 'bems/my-project', expect.anything());
    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.1.0-1', '-m', '04t123456789012']);
    expect(execa).toHaveBeenCalledWith('git', ['push', 'origin-alias', 'v1.1.0-1']);
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'subscriberPackageVersionId.env',
      'SUBSCRIBER_PACKAGE_VERSION_ID=04t123456789012\n',
      'utf-8',
    );
  });

  it('should increment an existing suffix tag correctly (v1.1.0-1 -> v1.1.0-2)', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.1.0-1\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v1.1.0-1   04t123456789012345\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(result.tag).toBe('v1.1.0-2');
    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v1.1.0-2', '-m', '04t123456789012345']);
  });

  it('should correctly handle four-dot standard tag formats used by sf cli (v6.30.1.5 -> v6.30.1.5-1)', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v6.30.1.5\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v6.30.1.5   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v6.30.1.5-1', '-m', '04t123456789012']);
    expect(result.tag).toBe('v6.30.1.5-1');
  });

  it('should correctly increment fallback suffixes on four-dot tag formats (v6.30.1.5-1 -> v6.30.1.5-2)', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v6.30.1.5-1\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v6.30.1.5-1   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v6.30.1.5-2', '-m', '04t123456789012']);
    expect(result.tag).toBe('v6.30.1.5-2');
  });

  it('should filter tags by major.minor.patch version prefix from sfdx-project.json', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [{ path: 'force-app', default: true, versionNumber: '6.50.0.NEXT' }],
    });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') {
        expect(args).toContain('v6.50.0.*');
        return { stdout: 'v6.50.0.4\n' };
      }
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v6.50.0.4   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(execa).toHaveBeenCalledWith('git', ['tag', '-a', 'v6.50.0.4-1', '-m', '04t123456789012']);
    expect(result.tag).toBe('v6.50.0.4-1');
  });

  it('should soft no-op when create-package-version already tagged HEAD earlier in the same job', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--points-at') {
        expect(args).toEqual(['tag', '--points-at', 'HEAD', '--list', 'v*']);
        return { stdout: 'v1.2.0.3\n' };
      }
      // Without the guard, describe would find the fresh tag and create v1.2.0.3-1 on top of it.
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.2.0.3\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v1.2.0.3   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(result).toEqual({ created: false });
    expect(logger.info).toHaveBeenCalledWith('HEAD is already tagged (v1.2.0.3). No fallback tag needed.');
    expect(addGitRemote).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalledWith('git', expect.arrayContaining(['-a']));
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });

  it('should warn and soft no-op when no valid package ID is found in the annotated tag', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.1.0\n' };
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v1.1.0   no-package-id-here\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag(baseOptions);

    expect(result).toEqual({ created: false });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find a valid 04t package ID'));
    expect(addGitRemote).not.toHaveBeenCalled();
  });

  it('should warn and soft no-op (not throw) when git describe finds no tags at all, fixing a bug where this crashed the whole job', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('fatal: No names found, cannot describe anything.'));

    await expect(createFallbackTag(baseOptions)).resolves.toEqual({ created: false });

    expect(logger.warn).toHaveBeenCalledWith('No previous tag found to increment.');
    expect(addGitRemote).not.toHaveBeenCalled();
  });

  it('should use an explicit --last-tag without calling git describe', async () => {
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') throw new Error('should not be called');
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: 'v2.0.0   04t123456789012\n' };
      return { stdout: '' };
    }) as never);

    const result = await createFallbackTag({ ...baseOptions, lastTag: 'v2.0.0' });

    expect(result.tag).toBe('v2.0.0-1');
  });

  describe('with a configured version tag format', () => {
    function mockFormat(versionTagFormat: string, versionNumber = '1.2.3.NEXT'): void {
      vi.mocked(readSfdxProject).mockResolvedValue({
        packageDirectories: [{ path: 'force-app', default: true, versionNumber }],
        plugins: { simply: { versionTagFormat } },
      });
    }

    function mockLastTag(lastTag: string): void {
      vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
        if (cmd === 'git' && args[0] === 'describe') return { stdout: `${lastTag}\n` };
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: `${lastTag}   04t123456789012\n` };
        return { stdout: '' };
      }) as never);
    }

    it.each([
      ['v{MAJOR}.{MINOR}.{PATCH}-{BUILD}', 'v1.2.3-4', 'v1.2.3-4-1'],
      ['v{MAJOR}.{MINOR}.{PATCH}-{BUILD}', 'v1.2.3-4-1', 'v1.2.3-4-2'],
      ['v{MAJOR}.{MINOR}.{PATCH}-{BUILD}', 'v1.2.3-4-beta', 'v1.2.3-4-beta-1'],
      ['v{MAJOR}.{MINOR}.{PATCH}-{BUILD}', 'v1.2.3-4-beta-2', 'v1.2.3-4-beta-3'],
      ['{MAJOR}.{MINOR}.{PATCH}+{BUILD}', '1.2.3+4', '1.2.3+4-1'],
      ['{MAJOR}.{MINOR}.{PATCH}+{BUILD}', '1.2.3+4-7', '1.2.3+4-8'],
    ])('should only count a counter after the rendered version (%s: %s -> %s)', async (format, lastTag, nextTag) => {
      mockFormat(format);
      mockLastTag(lastTag);

      const result = await createFallbackTag(baseOptions);

      expect(result.tag).toBe(nextTag);
    });

    it("should search for tags in the project's format", async () => {
      mockFormat('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');
      mockLastTag('1.2.3+4');

      await createFallbackTag(baseOptions);

      expect(execa).toHaveBeenCalledWith('git', ['tag', '--points-at', 'HEAD', '--list', '1.2.3+*']);
      expect(execa).toHaveBeenCalledWith('git', ['describe', '--tags', '--abbrev=0', '--match', '1.2.3+*']);
    });

    it('should throw rather than fall back when the declared format is invalid', async () => {
      mockFormat('v{MAJOR}.{MINOR}.{PATCH}.{BUILDD}');

      await expect(createFallbackTag(baseOptions)).rejects.toThrow('unknown placeholder "{BUILDD}"');
      expect(execa).not.toHaveBeenCalled();
    });
  });

  describe('with SIMPLY_CICD_VERSION_TAG_FORMAT set', () => {
    beforeEach(() => {
      vi.stubEnv('SIMPLY_CICD_VERSION_TAG_FORMAT', '{MAJOR}.{MINOR}.{PATCH}+{BUILD}');
      vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
        if (cmd === 'git' && args[0] === 'describe') return { stdout: '1.2.3+4\n' };
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '-l') return { stdout: '1.2.3+4   04t123456789012\n' };
        return { stdout: '' };
      }) as never);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should override the project's format", async () => {
      vi.mocked(readSfdxProject).mockResolvedValue({
        packageDirectories: [{ path: 'force-app', default: true, versionNumber: '1.2.3.NEXT' }],
        plugins: { simply: { versionTagFormat: 'v{MAJOR}.{MINOR}.{PATCH}-{BUILD}' } },
      });

      const result = await createFallbackTag(baseOptions);

      expect(execa).toHaveBeenCalledWith('git', ['describe', '--tags', '--abbrev=0', '--match', '1.2.3+*']);
      expect(result.tag).toBe('1.2.3+4-1');
    });

    it('should still apply when sfdx-project.json is unreadable', async () => {
      await createFallbackTag(baseOptions);

      expect(execa).toHaveBeenCalledWith('git', ['describe', '--tags', '--abbrev=0', '--match', '*']);
    });
  });
});
