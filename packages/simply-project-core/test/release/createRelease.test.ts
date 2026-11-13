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

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProvider } from '@simplysf/simply-core';
import { createRelease, type CreateReleaseVcs } from '../../src/release/createRelease.js';

// These run real git against a bare remote, as rollForward's tests do. A git hook exports variables
// like GIT_DIR, which would point these commands at the repo being pushed, so they're cleared here.
for (const key of Object.keys(process.env).filter((name) => name.startsWith('GIT_'))) {
  delete process.env[key];
}

let root: string;
let lead: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const project = (version: string, indent: number | string = 2): string =>
  `${JSON.stringify(
    {
      packageDirectories: [
        {
          path: 'force-app',
          package: 'Core',
          versionName: `Core v${version}`,
          versionNumber: `${version}.NEXT`,
          default: true,
        },
      ],
      packageAliases: { Core: '0Ho' },
    },
    undefined,
    indent,
  )}\n`;

/** `project(version)` with `plugins.simply.release.increments` set. */
const projectWithIncrements = (version: string, increments: Record<string, unknown>): string => {
  const parsed = JSON.parse(project(version)) as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, plugins: { simply: { release: { increments } } } }, undefined, 2)}
`;
};

function commit(cwd: string, file: string, content: string, message = file): void {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
}

/** Installs a git hook in `cwd`'s repository. */
function installHook(cwd: string, name: string, body: string): void {
  const hook = path.join(cwd, '.git', 'hooks', name);
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** A pre-commit hook that reformats sfdx-project.json as compact JSON and doesn't restage it, like a bare `prettier --write`. */
const REFORMAT_HOOK =
  "node -e \"const fs=require('fs');const f='sfdx-project.json';fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')))+'\\n')\"";

type Project = { packageDirectories: Array<Record<string, unknown>> };
const remoteProject = (branch: string): Project =>
  JSON.parse(git(remote, 'show', `${branch}:sfdx-project.json`)) as Project;
const remoteBranches = (): string[] => git(remote, 'branch', '--format=%(refname:short)').split(/\r?\n/);

/** A provider with only the platform-step methods, each a spy. */
function fakeVcs(): CreateReleaseVcs & {
  spies: {
    findRelease: ReturnType<typeof vi.fn>;
    createRelease: ReturnType<typeof vi.fn>;
    setDefaultBranch: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    findRelease: vi.fn().mockResolvedValue(undefined),
    createRelease: vi
      .fn()
      .mockImplementation((_project: unknown, release: { tagName: string; name: string }) =>
        Promise.resolve({ ...release, webUrl: `https://example.com/releases/${release.tagName}`, raw: {} }),
      ),
    setDefaultBranch: vi.fn().mockResolvedValue(undefined),
  };
  return { provider: { kind: 'gitlab', ...spies } as unknown as VcsProvider, project: '123', spies };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'create-release-test-'));
  remote = path.join(root, 'remote.git');
  lead = path.join(root, 'lead');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'release/v1.2.0', lead);
  git(lead, 'config', 'user.email', 'lead@example.com');
  git(lead, 'config', 'user.name', 'Lead');
  git(lead, 'config', 'commit.gpgsign', 'false');
  git(lead, 'config', 'tag.gpgsign', 'false');
  git(lead, 'remote', 'add', 'origin', remote);
  commit(lead, 'sfdx-project.json', project('1.2.0'), 'base');
  for (const tag of ['v1.2.0.9', 'v1.2.0.10', 'v1.2.0.11-fallback']) {
    git(lead, 'tag', '-a', tag, '-m', '04t');
  }
  git(lead, 'push', '-q', 'origin', '--all', '--follow-tags');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('createRelease', () => {
  it('cuts the next branch from the remote, with the version bumped, and goes back to the start branch', async () => {
    const remoteTip = git(remote, 'rev-parse', 'release/v1.2.0');
    commit(lead, 'unpushed.txt', 'local only');

    const result = await createRelease({ type: 'minor', cwd: lead });

    expect(result).toMatchObject({
      status: 'Created',
      branch: 'release/v1.3.0',
      version: '1.3.0',
      bumpedPackages: ['Core'],
    });
    expect(git(remote, 'rev-parse', 'release/v1.3.0^')).toBe(remoteTip);
    expect(git(remote, 'rev-parse', 'release/v1.3.0')).toBe(result.commit);
    expect(git(remote, 'log', '-1', '--format=%s', 'release/v1.3.0')).toBe('chore: bump version to 1.3.0');
    expect(git(remote, 'ls-tree', '--name-only', 'release/v1.3.0')).not.toContain('unpushed.txt');
    expect(remoteProject('release/v1.3.0').packageDirectories[0]).toMatchObject({
      versionNumber: '1.3.0.NEXT',
      versionName: 'Core v1.3.0',
    });
    expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.2.0');
    expect(git(lead, 'rev-parse', '--abbrev-ref', 'release/v1.3.0@{upstream}')).toBe('origin/release/v1.3.0');
  });

  it.each([
    ['patch', 'release/v1.2.1', '1.2.1.NEXT'],
    ['major', 'release/v2.0.0', '2.0.0.NEXT'],
  ] as const)('cuts a %s release', async (type, branch, versionNumber) => {
    await createRelease({ type, cwd: lead });

    expect(remoteProject(branch).packageDirectories[0].versionNumber).toBe(versionNumber);
  });

  it('cuts from --source, and keeps the file indentation', async () => {
    git(lead, 'switch', '-qc', 'release/v2.0.0');
    commit(lead, 'sfdx-project.json', project('2.0.0', 4), 'v2');
    git(lead, 'push', '-q', 'origin', 'release/v2.0.0');
    git(lead, 'switch', '-q', 'release/v1.2.0');

    await createRelease({ type: 'minor', source: 'release/v2.0.0', cwd: lead });

    expect(git(remote, 'show', 'release/v2.1.0:sfdx-project.json')).toBe(project('2.1.0', 4).trim());
  });

  describe('increments', () => {
    it("moves by the source branch's plugins.simply.release.increments, and carries the setting forward", async () => {
      commit(lead, 'sfdx-project.json', projectWithIncrements('1.2.0', { minor: 10, patch: 1 }), 'increments');
      git(lead, 'push', '-q', 'origin', 'release/v1.2.0');

      const result = await createRelease({ type: 'minor', cwd: lead });

      expect(result).toMatchObject({ branch: 'release/v1.12.0', version: '1.12.0' });
      const cut = remoteProject('release/v1.12.0') as Project & { plugins: unknown };
      expect(cut.packageDirectories[0].versionNumber).toBe('1.12.0.NEXT');
      expect(cut.plugins).toEqual({ simply: { release: { increments: { minor: 10, patch: 1 } } } });
    });

    it('uses only the chosen type, defaulting the others to 1', async () => {
      commit(lead, 'sfdx-project.json', projectWithIncrements('1.2.0', { minor: 10 }), 'increments');
      git(lead, 'push', '-q', 'origin', 'release/v1.2.0');

      await expect(createRelease({ type: 'patch', cwd: lead })).resolves.toMatchObject({ branch: 'release/v1.2.1' });
    });

    it("lets the increment option beat the project's setting", async () => {
      commit(lead, 'sfdx-project.json', projectWithIncrements('1.2.0', { major: 5 }), 'increments');
      git(lead, 'push', '-q', 'origin', 'release/v1.2.0');

      await expect(createRelease({ type: 'major', increment: 2, cwd: lead })).resolves.toMatchObject({
        branch: 'release/v3.0.0',
      });
    });

    it("reads the remote source's sfdx-project.json, not unpushed local commits", async () => {
      commit(lead, 'sfdx-project.json', projectWithIncrements('1.2.0', { minor: 10 }), 'local only');

      await expect(createRelease({ type: 'minor', dryRun: true, cwd: lead })).resolves.toMatchObject({
        branch: 'release/v1.3.0',
      });
    });

    it('refuses an invalid increment before changing anything', async () => {
      await expect(createRelease({ type: 'minor', increment: 0, cwd: lead })).rejects.toThrow(
        'Invalid minor increment 0',
      );

      commit(lead, 'sfdx-project.json', projectWithIncrements('1.2.0', { minor: 'ten' }), 'bad increments');
      git(lead, 'push', '-q', 'origin', 'release/v1.2.0');
      await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow(
        `plugins.simply.release.increments.minor in origin/release/v1.2.0's sfdx-project.json must be a whole number of at least 1, not "ten".`,
      );
      expect(remoteBranches()).toEqual(['release/v1.2.0']);
    });
  });

  it('allows a patch on an older line while a newer release exists', async () => {
    git(lead, 'push', '-q', 'origin', 'release/v1.2.0:refs/heads/release/v1.3.0');

    await expect(createRelease({ type: 'patch', cwd: lead })).resolves.toMatchObject({ status: 'Created' });
  });

  it('refuses a version that already has a branch, under any label shape', async () => {
    git(lead, 'push', '-q', 'origin', 'release/v1.2.0:refs/heads/release/1.3');

    await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow('release/1.3 already exists on origin');
  });

  it('refuses a branch that is not a release branch, or whose version disagrees with its name', async () => {
    git(lead, 'switch', '-qc', 'feature/x');
    await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow("isn't a release branch");

    git(lead, 'switch', '-qc', 'release/v5.0.0');
    git(lead, 'push', '-q', 'origin', 'release/v5.0.0');
    await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow("which doesn't match its name");
  });

  it('changes nothing on a dry run or a declined confirmation', async () => {
    const before = remoteBranches();

    await expect(createRelease({ type: 'minor', dryRun: true, cwd: lead })).resolves.toMatchObject({
      status: 'Would create',
    });
    const confirm = vi.fn().mockResolvedValue(false);
    await expect(createRelease({ type: 'minor', confirm, cwd: lead })).resolves.toMatchObject({ status: 'Declined' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ branch: 'release/v1.3.0', status: 'Would create' }));
    expect(remoteBranches()).toEqual(before);
    expect(git(lead, 'branch', '--list', 'release/v1.3.0')).toBe('');
  });

  it('stops without pushing when a hook rejects the commit, and finishes on a re-run', async () => {
    const hook = path.join(lead, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(hook, '#!/bin/sh\ngrep -q "PROJ-" "$1" || { echo "needs a ticket"; exit 1; }\n', { mode: 0o755 });

    const rejected = await createRelease({ type: 'minor', cwd: lead });

    expect(rejected.status).toBe('Commit rejected');
    expect(rejected.commitError).toContain('needs a ticket');
    expect(remoteBranches()).not.toContain('release/v1.3.0');

    git(lead, 'commit', '-qm', 'chore: PROJ-1 bump version to 1.3.0');
    await expect(createRelease({ type: 'patch', cwd: lead })).rejects.toThrow('was cut from release/v1.2.0');
    await expect(createRelease({ type: 'minor', cwd: lead })).resolves.toMatchObject({ status: 'Created' });
    expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.3.0');
    expect(git(remote, 'log', '-1', '--format=%s', 'release/v1.3.0')).toBe('chore: PROJ-1 bump version to 1.3.0');
  });

  describe('pre-commit hooks', () => {
    it("amends a reformatting hook's changes into the one bump commit, then goes back to the start branch", async () => {
      installHook(lead, 'pre-commit', REFORMAT_HOOK);
      const remoteTip = git(remote, 'rev-parse', 'release/v1.2.0');

      const result = await createRelease({ type: 'minor', cwd: lead });

      expect(result.status).toBe('Created');
      expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.2.0');
      expect(git(lead, 'status', '--porcelain')).toBe('');
      expect(git(remote, 'rev-parse', 'release/v1.3.0^')).toBe(remoteTip);
      expect(git(remote, 'rev-parse', 'release/v1.3.0')).toBe(result.commit);
      const pushed = git(remote, 'show', 'release/v1.3.0:sfdx-project.json');
      expect(pushed.split('\n')).toHaveLength(1);
      expect(JSON.parse(pushed)).toMatchObject({ packageDirectories: [{ versionNumber: '1.3.0.NEXT' }] });
    });

    it('stops before pushing when a hook changes files on every commit', async () => {
      commit(lead, 'stamp.txt', '0');
      git(lead, 'push', '-q', 'origin', 'release/v1.2.0');
      installHook(lead, 'pre-commit', 'date +%s%N >> stamp.txt');

      await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow(
        'keeps changing stamp.txt after every commit, so nothing was pushed',
      );
      expect(remoteBranches()).not.toContain('release/v1.3.0');
    });

    it('stops before pushing when a hook takes the new version back out', async () => {
      installHook(lead, 'pre-commit', "sed -i 's/1.3.0/1.2.0/g' sfdx-project.json");

      await expect(createRelease({ type: 'minor', cwd: lead })).rejects.toThrow(
        'no longer declares 1.3.0, so nothing was pushed',
      );
      expect(remoteBranches()).not.toContain('release/v1.3.0');
    });

    it('reports Created, and warns, when switching back fails after the push', async () => {
      // A pre-push hook that dirties the bumped file leaves nothing to fix before the push, only after it.
      installHook(lead, 'pre-push', 'echo " " >> sfdx-project.json');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await createRelease({ type: 'minor', cwd: lead });

      expect(result.status).toBe('Created');
      expect(remoteBranches()).toContain('release/v1.3.0');
      expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.3.0');
      expect(warn.mock.calls.flat().join(' ')).toContain('git switch release/v1.2.0');
      warn.mockRestore();
    });
  });

  it('keeps CRLF line endings in sfdx-project.json', async () => {
    git(lead, 'config', 'core.autocrlf', 'false');
    commit(lead, 'sfdx-project.json', project('1.2.0').replaceAll('\n', '\r\n'), 'crlf');
    git(lead, 'push', '-q', 'origin', 'release/v1.2.0');

    await createRelease({ type: 'minor', cwd: lead });

    const pushed = execFileSync('git', ['show', 'release/v1.3.0:sfdx-project.json'], { cwd: remote, encoding: 'utf8' });
    expect(pushed).toBe(project('1.3.0').replaceAll('\n', '\r\n'));
  });

  it('refuses a stale local branch with the new name before changing anything', async () => {
    git(lead, 'branch', 'release/v1.3.0');
    const vcs = fakeVcs();

    await expect(createRelease({ type: 'minor', createRelease: true, vcs, cwd: lead })).rejects.toThrow(
      'git branch -D release/v1.3.0',
    );
    expect(vcs.spies.createRelease).not.toHaveBeenCalled();
  });

  it('refuses a blank message or an unknown placeholder', async () => {
    await expect(createRelease({ type: 'minor', message: ' ', cwd: lead })).rejects.toThrow('empty');
    await expect(createRelease({ type: 'minor', message: 'chore: {VERISON}', cwd: lead })).rejects.toThrow(
      'unknown placeholders: {VERISON}',
    );
  });

  describe('platform steps', () => {
    it('publishes the release from the highest pushed build tag, skipping fallback and local tags', async () => {
      git(lead, 'tag', '-a', 'v1.2.0.12', '-m', 'local only');
      const vcs = fakeVcs();

      const result = await createRelease({ type: 'minor', createRelease: true, vcs, cwd: lead });

      expect(vcs.spies.createRelease).toHaveBeenCalledWith('123', { tagName: 'v1.2.0.10', name: 'v1.2.0' });
      expect(result.release).toMatchObject({ tagName: 'v1.2.0.10', status: 'Created' });
    });

    it('reports a release that already exists, without creating another', async () => {
      const vcs = fakeVcs();
      vcs.spies.findRelease.mockResolvedValue({ tagName: 'v1.2.0.10', name: 'v1.2.0', raw: {} });

      const result = await createRelease({ type: 'minor', createRelease: true, vcs, cwd: lead });

      expect(result.release?.status).toBe('Already exists');
      expect(vcs.spies.createRelease).not.toHaveBeenCalled();
    });

    it('treats --release-tag as asking for a release, and refuses a tag missing from the remote', async () => {
      const vcs = fakeVcs();
      await createRelease({ type: 'minor', releaseTag: 'v1.2.0.9', vcs, dryRun: true, cwd: lead }).then((result) =>
        expect(result.release).toMatchObject({ tagName: 'v1.2.0.9', status: 'Would create' }),
      );

      await expect(createRelease({ type: 'minor', releaseTag: 'v9.9.9.9', vcs, cwd: lead })).rejects.toThrow(
        "Tag v9.9.9.9 doesn't exist on origin",
      );
    });

    it('sets the new branch as the default after pushing', async () => {
      const vcs = fakeVcs();

      const result = await createRelease({ type: 'minor', setDefault: true, vcs, cwd: lead });

      expect(vcs.spies.setDefaultBranch).toHaveBeenCalledWith('123', 'release/v1.3.0');
      expect(result.defaultBranch).toEqual({ status: 'Set' });
    });

    it('fails before anything runs without a provider, or with one lacking the methods', async () => {
      await expect(createRelease({ type: 'minor', setDefault: true, cwd: lead })).rejects.toThrow(
        'needs a VCS provider',
      );
      const bare = { provider: { kind: 'gitlab' } as unknown as VcsProvider, project: '123' };
      await expect(createRelease({ type: 'minor', createRelease: true, vcs: bare, cwd: lead })).rejects.toThrow(
        "doesn't support creating releases",
      );
      expect(remoteBranches()).not.toContain('release/v1.3.0');
    });
  });
});
