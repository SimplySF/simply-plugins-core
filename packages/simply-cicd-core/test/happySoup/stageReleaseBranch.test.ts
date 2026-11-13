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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listStagingBaseBranches, stageReleaseBranch } from '../../src/happySoup/stageReleaseBranch.js';

for (const key of Object.keys(process.env).filter((name) => name.startsWith('GIT_'))) {
  delete process.env[key];
}

let root: string;
let dev: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const head = (): string => git(dev, 'rev-parse', '--abbrev-ref', 'HEAD');

const stage = (
  overrides: Partial<Parameters<typeof stageReleaseBranch>[0]> = {},
): ReturnType<typeof stageReleaseBranch> =>
  stageReleaseBranch({
    team: 'platform',
    app: 'core',
    name: 'PROJ-1058',
    baseBranch: 'environment/production',
    cwd: dev,
    ...overrides,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-soup-stage-test-'));
  remote = path.join(root, 'remote.git');
  dev = path.join(root, 'dev');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'environment/production', dev);
  git(dev, 'config', 'user.email', 'dev@example.com');
  git(dev, 'config', 'user.name', 'Dev');
  git(dev, 'config', 'commit.gpgsign', 'false');
  git(dev, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dev, 'README.md'), 'base');
  git(dev, 'add', '-A');
  git(dev, 'commit', '-qm', 'base');
  for (const branch of ['environment/production', 'environment/uat', 'release/2026-10-19', 'feature/x']) {
    git(dev, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  }
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listStagingBaseBranches', () => {
  it('lists environment/* and release/* on the remote, production first', async () => {
    await expect(listStagingBaseBranches({ productionBranch: 'environment/production', cwd: dev })).resolves.toEqual([
      'environment/production',
      'environment/uat',
      'release/2026-10-19',
    ]);
  });
});

describe('stageReleaseBranch', () => {
  it("creates <team>/<app>/<name> from the remote's base, checks it out, and doesn't push", async () => {
    fs.writeFileSync(path.join(dev, 'local.txt'), 'x');
    git(dev, 'add', '-A');
    git(dev, 'commit', '-qm', 'unpushed');

    const result = await stage({ baseBranch: 'release/2026-10-19' });

    expect(result).toEqual({
      branch: 'platform/core/PROJ-1058',
      base: 'release/2026-10-19',
      status: 'Created',
      warnings: [],
    });
    expect(head()).toBe('platform/core/PROJ-1058');
    expect(git(dev, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'release/2026-10-19'));
    expect(git(remote, 'branch', '--list', 'platform/*')).toBe('');
  });

  it('changes nothing on a dry run', async () => {
    await expect(stage({ dryRun: true })).resolves.toMatchObject({ status: 'Would create' });
    expect(head()).toBe('environment/production');
  });

  it('switches back to a staging branch that exists only locally', async () => {
    await stage();
    git(dev, 'switch', '-q', 'environment/production');

    await expect(stage()).resolves.toMatchObject({ status: 'Already exists' });
    expect(head()).toBe('platform/core/PROJ-1058');
  });

  it('checks out a staging branch someone else pushed', async () => {
    git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/platform/core/PROJ-1058');

    await expect(stage()).resolves.toMatchObject({ status: 'Already exists', warnings: [] });
    expect(git(dev, 'rev-parse', '--abbrev-ref', 'platform/core/PROJ-1058@{upstream}')).toBe(
      'origin/platform/core/PROJ-1058',
    );
  });

  it.each([
    [{ team: '' }, 'The team "" can\'t be used'],
    [{ app: 'core/api' }, 'The application "core/api" can\'t be used'],
    [{ name: 'has space' }, 'The release name "has space" isn\'t a valid git branch name.'],
    [{ name: 'a..b' }, 'The release name "a..b" isn\'t a valid git branch name.'],
    [{ baseBranch: 'environment/missing' }, "The base branch environment/missing doesn't exist on origin."],
  ])('refuses %j before changing anything', async (overrides, message) => {
    await expect(stage(overrides)).rejects.toThrow(message);
    expect(head()).toBe('environment/production');
  });

  it('refuses a dirty working tree', async () => {
    fs.writeFileSync(path.join(dev, 'README.md'), 'edited');

    await expect(stage()).rejects.toThrow('uncommitted changes');
  });
});
