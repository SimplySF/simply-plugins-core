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
import type { VcsProvider } from '../../src/vcs/index.js';
import {
  assertReleaseDate,
  createReleaseBranch,
  resolveHappySoupVcs,
  type HappySoupReleaseVcs,
} from '../../src/happySoup/createReleaseBranch.js';

// These run real git against a bare remote. A git hook exports variables like GIT_DIR, which would
// point these commands at the repo being pushed, so they're cleared here.
for (const key of Object.keys(process.env).filter((name) => name.startsWith('GIT_'))) {
  delete process.env[key];
}

let root: string;
let dev: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function commit(cwd: string, file: string, content: string, message = file): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
}

const remoteBranches = (): string[] => git(remote, 'branch', '--format=%(refname:short)').split(/\r?\n/);
const head = (): string => git(dev, 'rev-parse', '--abbrev-ref', 'HEAD');

/** A provider with only the merge request methods, each a spy. */
function fakeVcs(existing?: { iid: number; title: string; webUrl: string }): HappySoupReleaseVcs & {
  spies: { findOpenMergeRequest: ReturnType<typeof vi.fn>; createMergeRequest: ReturnType<typeof vi.fn> };
} {
  const spies = {
    findOpenMergeRequest: vi.fn().mockResolvedValue(existing),
    createMergeRequest: vi.fn().mockImplementation((_project: unknown, source: string, target: string, title: string) =>
      Promise.resolve({
        id: 1,
        iid: 42,
        title,
        sourceBranch: source,
        targetBranch: target,
        webUrl: 'https://example.com/mr/42',
        raw: {},
      }),
    ),
  };
  return { provider: { kind: 'gitlab', ...spies } as unknown as VcsProvider, project: '123', spies };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-soup-release-test-'));
  remote = path.join(root, 'remote.git');
  dev = path.join(root, 'dev');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'environment/production', dev);
  git(dev, 'config', 'user.email', 'dev@example.com');
  git(dev, 'config', 'user.name', 'Dev');
  git(dev, 'config', 'commit.gpgsign', 'false');
  git(dev, 'remote', 'add', 'origin', remote);
  commit(dev, 'xdocs/deployment-steps-template.md', '# Deployment steps\n', 'steps template');
  commit(dev, 'xdocs/deployment-configs-template.json', '{ "deployments": [] }\n', 'configs template');
  git(dev, 'push', '-q', 'origin', 'environment/production');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('assertReleaseDate', () => {
  it.each(['2026-10-19', '2028-02-29'])('accepts %s', (date) => {
    expect(() => assertReleaseDate(date)).not.toThrow();
  });

  it.each(['2026-1-9', '2026-02-30', '2027-02-29', '2026-13-01', '19-10-2026', ''])('refuses %j', (date) => {
    expect(() => assertReleaseDate(date)).toThrow('Invalid release date');
  });
});

describe('resolveHappySoupVcs', () => {
  it('builds the provider from explicit values', () => {
    const vcs = resolveHappySoupVcs({ provider: 'github', projectId: 'org/repo', token: 't', cwd: root, env: {} });

    expect(vcs.project).toBe('org/repo');
    expect(vcs.provider.kind).toBe('github');
  });

  it('reads the project ID from SIMPLY_VCS_PROJECT_ID', () => {
    expect(resolveHappySoupVcs({ token: 't', cwd: root, env: { SIMPLY_VCS_PROJECT_ID: '99' } }).project).toBe('99');
  });

  it('names every way to supply a missing project ID or token, and the opt-out', () => {
    expect(() => resolveHappySoupVcs({ token: 't', cwd: root, env: {} })).toThrow(
      /--vcs-project-id.*SIMPLY_VCS_PROJECT_ID.*vcs\.projectId.*--no-merge-request/,
    );
    expect(() => resolveHappySoupVcs({ projectId: '1', cwd: root, env: {} })).toThrow(
      /--vcs-token or set SIMPLY_VCS_TOKEN.*--no-merge-request/,
    );
  });
});

describe('createReleaseBranch', () => {
  it("cuts release/<date> from the remote's production, commits the templates once, pushes, and opens a draft MR", async () => {
    const remoteTip = git(remote, 'rev-parse', 'environment/production');
    commit(dev, 'unpushed.txt', 'local only');
    const vcs = fakeVcs();

    const result = await createReleaseBranch({ date: '2026-10-19', vcs, cwd: dev });

    expect(result).toMatchObject({
      branch: 'release/2026-10-19',
      base: 'environment/production',
      status: 'Created',
      files: ['deployment-steps/2026-10-19.md', 'deployment-configs/2026-10-19.json'],
      skippedTemplates: [],
      pushed: true,
      mergeRequest: {
        status: 'Created',
        iid: 42,
        webUrl: 'https://example.com/mr/42',
        target: 'environment/production',
      },
    });
    expect(git(remote, 'rev-parse', 'release/2026-10-19^')).toBe(remoteTip);
    expect(git(remote, 'rev-parse', 'release/2026-10-19')).toBe(result.commit);
    expect(git(remote, 'log', '-1', '--format=%s', 'release/2026-10-19')).toBe('chore: set up release 2026-10-19');
    expect(git(remote, 'show', 'release/2026-10-19:deployment-steps/2026-10-19.md')).toBe('# Deployment steps');
    expect(git(remote, 'ls-tree', '--name-only', 'release/2026-10-19')).not.toContain('unpushed.txt');
    expect(head()).toBe('release/2026-10-19');
    expect(git(dev, 'rev-parse', '--abbrev-ref', 'release/2026-10-19@{upstream}')).toBe('origin/release/2026-10-19');
    expect(vcs.spies.createMergeRequest).toHaveBeenCalledWith(
      '123',
      'release/2026-10-19',
      'environment/production',
      'Release 2026-10-19',
      expect.stringContaining('deployment-configs/2026-10-19.json') as unknown,
      undefined,
      { draft: true, removeSourceBranch: false },
    );
  });

  it('uses the configured production branch, templates, and message', async () => {
    git(dev, 'switch', '-qc', 'main');
    commit(dev, 'docs/steps.md', 'steps\n');
    git(dev, 'push', '-q', 'origin', 'main');

    const result = await createReleaseBranch({
      date: '2026-10-19',
      config: {
        teams: [],
        applications: [],
        productionBranch: 'main',
        deploymentStepsTemplate: 'docs/steps.md',
        deploymentConfigsTemplate: 'docs/missing.json',
      },
      message: 'chore: PROJ-1 release {DATE}',
      mergeRequest: false,
      cwd: dev,
    });

    expect(result).toMatchObject({
      base: 'main',
      files: ['deployment-steps/2026-10-19.md'],
      skippedTemplates: ['docs/missing.json'],
    });
    expect(result.mergeRequest).toBeUndefined();
    expect(git(remote, 'log', '-1', '--format=%s', 'release/2026-10-19')).toBe('chore: PROJ-1 release 2026-10-19');
  });

  it('reads config/release.json from the repository when no config is given', async () => {
    commit(dev, 'config/release.json', JSON.stringify({ deploymentStepsTemplate: 'nope.md' }));
    git(dev, 'push', '-q', 'origin', 'environment/production');

    const result = await createReleaseBranch({ date: '2026-10-19', mergeRequest: false, dryRun: true, cwd: dev });

    expect(result.skippedTemplates).toEqual(['nope.md']);
  });

  it('leaves a deployment file that already exists on the base alone, with a warning', async () => {
    commit(dev, 'deployment-configs/2026-10-19.json', '{}\n');
    git(dev, 'push', '-q', 'origin', 'environment/production');

    const result = await createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev });

    expect(result.files).toEqual(['deployment-steps/2026-10-19.md']);
    expect(result.warnings).toEqual([
      'deployment-configs/2026-10-19.json already exists on environment/production, so it was left as it is.',
    ]);
  });

  it('creates and commits locally only with push: false, and opens no merge request', async () => {
    const vcs = fakeVcs();
    const result = await createReleaseBranch({ date: '2026-10-19', push: false, vcs, cwd: dev });

    expect(result).toMatchObject({ status: 'Created', pushed: false });
    expect(remoteBranches()).not.toContain('release/2026-10-19');
    expect(head()).toBe('release/2026-10-19');
    expect(vcs.spies.createMergeRequest).not.toHaveBeenCalled();
  });

  it('changes nothing on a dry run', async () => {
    const vcs = fakeVcs();
    const result = await createReleaseBranch({ date: '2026-10-19', vcs, dryRun: true, cwd: dev });

    expect(result).toMatchObject({
      status: 'Would create',
      files: ['deployment-steps/2026-10-19.md', 'deployment-configs/2026-10-19.json'],
      mergeRequest: { status: 'Would create', title: 'Release 2026-10-19' },
    });
    expect(head()).toBe('environment/production');
    expect(git(dev, 'branch', '--list', 'release/2026-10-19')).toBe('');
    expect(vcs.spies.findOpenMergeRequest).not.toHaveBeenCalled();
  });

  describe('when the branch is already on the remote', () => {
    beforeEach(async () => {
      await createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev });
      git(dev, 'switch', '-q', 'environment/production');
    });

    it('checks it out, and opens the merge request a failed run left out', async () => {
      git(dev, 'branch', '-D', 'release/2026-10-19');
      const vcs = fakeVcs();

      const result = await createReleaseBranch({ date: '2026-10-19', vcs, cwd: dev });

      expect(result).toMatchObject({ status: 'Already exists', files: [], mergeRequest: { status: 'Created' } });
      expect(head()).toBe('release/2026-10-19');
    });

    it('reports an open merge request instead of duplicating it', async () => {
      const vcs = fakeVcs({ iid: 7, title: 'Draft: Release 2026-10-19', webUrl: 'https://example.com/mr/7' });

      const result = await createReleaseBranch({ date: '2026-10-19', vcs, cwd: dev });

      expect(result.mergeRequest).toMatchObject({ status: 'Already open', iid: 7 });
      expect(vcs.spies.createMergeRequest).not.toHaveBeenCalled();
    });

    it('fast-forwards a local copy that is only behind', async () => {
      const other = path.join(root, 'other');
      git(root, 'clone', '-q', '-b', 'release/2026-10-19', remote, other);
      git(other, 'config', 'user.email', 'o@example.com');
      git(other, 'config', 'user.name', 'Other');
      git(other, 'config', 'commit.gpgsign', 'false');
      commit(other, 'more.txt', 'more');
      git(other, 'push', '-q', 'origin', 'release/2026-10-19');

      const result = await createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev });

      expect(result.warnings).toEqual([]);
      expect(git(dev, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'release/2026-10-19'));
    });

    it('leaves a diverged local copy alone, with a warning', async () => {
      const other = path.join(root, 'other');
      git(root, 'clone', '-q', '-b', 'release/2026-10-19', remote, other);
      git(other, 'config', 'user.email', 'o@example.com');
      git(other, 'config', 'user.name', 'Other');
      git(other, 'config', 'commit.gpgsign', 'false');
      commit(other, 'theirs.txt', 'theirs');
      git(other, 'push', '-q', 'origin', 'release/2026-10-19');
      git(dev, 'switch', '-q', 'release/2026-10-19');
      commit(dev, 'mine.txt', 'mine');
      const mine = git(dev, 'rev-parse', 'HEAD');
      git(dev, 'switch', '-q', 'environment/production');

      const result = await createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev });

      expect(result.warnings[0]).toContain('has diverged from origin/release/2026-10-19');
      expect(git(dev, 'rev-parse', 'HEAD')).toBe(mine);
    });
  });

  describe('refuses before changing anything', () => {
    it('a dirty working tree', async () => {
      fs.writeFileSync(path.join(dev, 'xdocs', 'deployment-steps-template.md'), 'edited');

      await expect(createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev })).rejects.toThrow(
        'uncommitted changes',
      );
      expect(git(dev, 'branch', '--list', 'release/2026-10-19')).toBe('');
    });

    it('a base branch that is not on the remote', async () => {
      await expect(
        createReleaseBranch({ date: '2026-10-19', baseBranch: 'environment/uat', mergeRequest: false, cwd: dev }),
      ).rejects.toThrow("The base branch environment/uat doesn't exist on origin.");
    });

    it('an unknown remote, an invalid date, or a bad message', async () => {
      await expect(
        createReleaseBranch({ date: '2026-10-19', remote: '--upload-pack=x', mergeRequest: false, cwd: dev }),
      ).rejects.toThrow('is not a configured remote');
      await expect(createReleaseBranch({ date: '2026-02-30', mergeRequest: false, cwd: dev })).rejects.toThrow(
        'Invalid release date',
      );
      await expect(
        createReleaseBranch({ date: '2026-10-19', message: 'chore: {VERSION}', mergeRequest: false, cwd: dev }),
      ).rejects.toThrow('unknown placeholders: {VERSION}');
    });

    it('a merge request without VCS settings', async () => {
      await expect(createReleaseBranch({ date: '2026-10-19', cwd: dev })).rejects.toThrow(
        'needs a VCS provider and project',
      );
    });

    it('a local-only branch with the same name', async () => {
      git(dev, 'branch', 'release/2026-10-19');

      await expect(createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev })).rejects.toThrow(
        "A local release/2026-10-19 already exists but isn't on origin.",
      );
    });
  });

  it('stops without pushing when a hook rejects the commit, and says how to finish', async () => {
    const hook = path.join(dev, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(hook, '#!/bin/sh\ngrep -q "PROJ-" "$1" || { echo "needs a ticket"; exit 1; }\n', { mode: 0o755 });

    await expect(createReleaseBranch({ date: '2026-10-19', mergeRequest: false, cwd: dev })).rejects.toThrow(
      /A hook rejected the commit on release\/2026-10-19[\s\S]*needs a ticket/,
    );
    expect(remoteBranches()).not.toContain('release/2026-10-19');
    expect(git(dev, 'diff', '--cached', '--name-only')).toContain('deployment-steps/2026-10-19.md');
  });
});
