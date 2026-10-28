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
import { SfError } from '@salesforce/core';
import { readSfdxProject } from '@simplysf/simply-core';
import { determinePackageChanges } from '../../src/build/determinePackageChanges.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});

describe('determinePackageChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write PACKAGE_CHANGED=TRUE if there are files changed in the default package directory', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: 'force-app', default: true }] });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '' };
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.0.0\n' };
      if (cmd === 'git' && args[0] === 'diff') return { stdout: 'force-app/main/default/classes/MyClass.cls\n' };
      return { stdout: '' };
    }) as never);

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'changes.env',
      'PACKAGE_CHANGED=TRUE\nLAST_TAG=v1.0.0\n',
      'utf-8',
    );
  });

  it('should write PACKAGE_CHANGED=FALSE if there are no files changed since the last tag', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: 'force-app', default: true }] });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '' };
      if (cmd === 'git' && args[0] === 'describe') return { stdout: 'v1.0.0\n' };
      if (cmd === 'git' && args[0] === 'diff') return { stdout: '' };
      return { stdout: '' };
    }) as never);

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'changes.env',
      'PACKAGE_CHANGED=FALSE\nLAST_TAG=v1.0.0\n',
      'utf-8',
    );
  });

  it('should write PACKAGE_CHANGED=TRUE if no last tag is found', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: 'force-app', default: true }] });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '' };
      if (cmd === 'git' && args[0] === 'describe') return Promise.reject(new Error('No tags found'));
      return { stdout: '' };
    }) as never);

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', 'PACKAGE_CHANGED=TRUE\nLAST_TAG=\n', 'utf-8');
  });

  it('should fallback to PACKAGE_CHANGED=TRUE if sfdx-project.json is corrupted or invalid', async () => {
    vi.mocked(readSfdxProject).mockRejectedValue(new SyntaxError('Unexpected token i in JSON at position 2'));

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', 'PACKAGE_CHANGED=TRUE\nLAST_TAG=\n', 'utf-8');
  });

  it('should fallback to PACKAGE_CHANGED=TRUE if packageDirectories is not an array', async () => {
    vi.mocked(readSfdxProject).mockRejectedValue(
      new SfError('Invalid or missing packageDirectories array in sfdx-project.json', 'InvalidSfdxProjectError'),
    );

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', 'PACKAGE_CHANGED=TRUE\nLAST_TAG=\n', 'utf-8');
  });

  it('should write PACKAGE_CHANGED=FALSE if no default package directory is found in sfdx-project.json', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: 'force-app' }] });

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', 'PACKAGE_CHANGED=FALSE\nLAST_TAG=\n', 'utf-8');
  });

  it('should write PACKAGE_CHANGED=FALSE if default package directory has no path', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', 'PACKAGE_CHANGED=FALSE\nLAST_TAG=\n', 'utf-8');
  });

  it('should filter tags by major.minor.patch version prefix from sfdx-project.json', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [{ path: 'force-app', default: true, versionNumber: '6.40.0.NEXT' }],
    });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '' };
      if (cmd === 'git' && args[0] === 'describe') {
        expect(args).toContain('v6.40.0.*');
        return { stdout: 'v6.40.0.12\n' };
      }
      if (cmd === 'git' && args[0] === 'diff') return { stdout: '' };
      return { stdout: '' };
    }) as never);

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'changes.env',
      'PACKAGE_CHANGED=FALSE\nLAST_TAG=v6.40.0.12\n',
      'utf-8',
    );
  });

  it('should default the output file to changes.env', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true }] });

    await determinePackageChanges({});

    expect(fsPromises.writeFile).toHaveBeenCalledWith('changes.env', expect.any(String), 'utf-8');
  });

  it("should search for the last tag in the project's version tag format", async () => {
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [{ path: 'force-app', default: true, versionNumber: '6.40.0.NEXT' }],
      plugins: { simply: { versionTagFormat: 'release/{MAJOR}.{MINOR}.{PATCH}+{BUILD}' } },
    });
    vi.mocked(execa).mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'git' && args[0] === 'describe') {
        expect(args).toContain('release/6.40.0+*');
        return { stdout: 'release/6.40.0+12\n' };
      }
      return { stdout: '' };
    }) as never);

    await determinePackageChanges({ out: 'changes.env' });

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      'changes.env',
      'PACKAGE_CHANGED=FALSE\nLAST_TAG=release/6.40.0+12\n',
      'utf-8',
    );
  });
});
