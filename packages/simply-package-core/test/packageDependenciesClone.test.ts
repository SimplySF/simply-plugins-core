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
import {
  clonePackageDependencies,
  normalizeRepositoryUrl,
  type ClonePackageDependenciesOptions,
  type DependencyCloneResult,
  type GitRunner,
} from '../src/packageDependenciesClone.js';

// These tests run real git against throwaway repositories on local paths, so they exercise git's
// actual behavior (refs, detached HEADs, fast-forwards) without needing a network.

let tmp: string;
let sources: string;
let workspace: string;
let warnings: string[];

/** Run git synchronously for fixture setup, with an identity so commits work on any machine. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

type Dependency = { package: string };
type Repositories = Record<string, { url: string; ref?: string; path?: string }>;

/** @returns `plugins.simply.packages` with each of `repositories` as an entry's `repository`. */
function packagesFrom(repositories: Repositories): Record<string, { repository: Repositories[string] }> {
  return Object.fromEntries(Object.entries(repositories).map(([key, repository]) => [key, { repository }]));
}

/** @returns An `sfdx-project.json` body for package `name` with these dependencies and map. */
function projectJson(name: string, dependencies: Dependency[] = [], repositories?: Repositories): string {
  return JSON.stringify(
    {
      packageDirectories: [
        { path: 'force-app', default: true, package: name, versionNumber: '1.0.0.NEXT', dependencies },
      ],
      ...(repositories ? { plugins: { simply: { packages: packagesFrom(repositories) } } } : {}),
    },
    undefined,
    2,
  );
}

/**
 * Create a source repository on branch `main` with one commit holding `project` (if given), and tag
 * it with each of `tags`.
 *
 * @returns The repository's path, used as its clone URL.
 */
function sourceRepo(relativePath: string, project?: string, tags: string[] = []): string {
  const dir = path.join(sources, relativePath);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet', '--initial-branch', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), relativePath);
  if (project) fs.writeFileSync(path.join(dir, 'sfdx-project.json'), project);
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'initial');
  for (const tag of tags) git(dir, 'tag', tag);
  return dir;
}

/** Write the root project into `<workspace>/app` and return its directory. */
function rootProject(dependencies: Dependency[], repositories?: Repositories, extra: object = {}): string {
  const dir = path.join(workspace, 'app');
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.parse(projectJson('my-app', dependencies, repositories)) as Record<string, unknown>;
  fs.writeFileSync(path.join(dir, 'sfdx-project.json'), JSON.stringify({ ...json, ...extra }));
  return dir;
}

/** Clone with a warning collector attached. */
async function clone(options: Omit<ClonePackageDependenciesOptions, 'progress'>): Promise<DependencyCloneResult[]> {
  return clonePackageDependencies({ ...options, progress: { warn: (message) => warnings.push(message) } });
}

/** @returns `[package, status]` pairs, the shape most assertions care about. */
function statuses(results: DependencyCloneResult[]): Array<[string, string]> {
  return results.map((row) => [row.package, row.status]);
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'simply-clone-')));
  sources = path.join(tmp, 'sources');
  workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  warnings = [];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('clonePackageDependencies', () => {
  it('clones only direct dependencies by default, next to the project', async () => {
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'leaf' }], { leaf: { url: leaf } }));
    const projectDir = rootProject([{ package: 'core@1.0.0-1' }], { core: { url: core } });

    const results = await clone({ projectDir });

    expect(statuses(results)).toStrictEqual([['core@1.0.0-1', 'Cloned']]);
    expect(results[0]).toMatchObject({ key: 'core', via: 'my-app', directory: path.join(workspace, 'core') });
    expect(fs.existsSync(path.join(workspace, 'core', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, 'leaf'))).toBe(false);
  });

  it('follows dependencies of dependencies with recursive', async () => {
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'leaf' }], { leaf: { url: leaf } }));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core } });

    const results = await clone({ projectDir, recursive: true });

    expect(results.map((row) => [row.package, row.status, row.via])).toStrictEqual([
      ['core', 'Cloned', 'my-app'],
      ['leaf', 'Cloned', 'core'],
    ]);
    expect(fs.existsSync(path.join(workspace, 'leaf', 'README.md'))).toBe(true);
  });

  it("uses the root's map for a dependency's dependencies that it doesn't map itself", async () => {
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'leaf' }]));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core }, leaf: { url: leaf } });

    expect(statuses(await clone({ projectDir, recursive: true }))).toStrictEqual([
      ['core', 'Cloned'],
      ['leaf', 'Cloned'],
    ]);
  });

  it('checks out a tag, and keeps the ref nearest the root when two refs conflict', async () => {
    const shared = sourceRepo('org/shared', undefined, ['v1']);
    fs.writeFileSync(path.join(shared, 'v2.txt'), 'v2');
    git(shared, 'add', '.');
    git(shared, 'commit', '--quiet', '-m', 'v2');
    git(shared, 'tag', 'v2');
    const core = sourceRepo(
      'org/core',
      projectJson('core', [{ package: 'shared' }], { shared: { url: `${shared}/`, ref: 'v2' } }),
    );
    const projectDir = rootProject([{ package: 'core' }, { package: 'shared' }], {
      core: { url: core },
      shared: { url: shared, ref: 'v1' },
    });

    const results = await clone({ projectDir, recursive: true });

    expect(statuses(results)).toStrictEqual([
      ['core', 'Cloned'],
      ['shared', 'Cloned'],
    ]);
    expect(fs.existsSync(path.join(workspace, 'shared', 'v2.txt'))).toBe(false);
    expect(warnings).toStrictEqual([expect.stringMatching(/shared is wanted at v2 by core.*Keeping v1/)]);
  });

  it('puts a second repository with the same name in a group-prefixed folder', async () => {
    const first = sourceRepo('alpha/core');
    const second = sourceRepo('beta/core');
    const projectDir = rootProject([{ package: 'a-core' }, { package: 'b-core' }], {
      'a-core': { url: first },
      'b-core': { url: second },
    });

    const results = await clone({ projectDir });

    expect(results.map((row) => row.directory)).toStrictEqual([
      path.join(workspace, 'core'),
      path.join(workspace, 'beta-core'),
    ]);
    expect(warnings).toStrictEqual([expect.stringContaining('"beta-core"')]);
  });

  it('reports dependencies without a repository, and ignored ones, once each', async () => {
    const projectDir = rootProject(
      [{ package: 'SomeAppExchangePackage@5.2' }, { package: 'skip-me@1.0.0-1' }],
      {},
      { plugins: { simply: { dependencies: { ignore: ['skip-me'] } } } },
    );

    expect(statuses(await clone({ projectDir }))).toStrictEqual([
      ['SomeAppExchangePackage@5.2', 'No repository'],
      ['skip-me@1.0.0-1', 'Ignored'],
    ]);
  });

  it('checks out a commit SHA with full history when a shallow clone was asked for', async () => {
    const repo = sourceRepo('org/pinned');
    const sha = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'later.txt'), 'later');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'later');
    const projectDir = rootProject([{ package: 'pinned' }], { pinned: { url: repo, ref: sha } });

    expect(statuses(await clone({ projectDir, depth: 1 }))).toStrictEqual([['pinned', 'Cloned']]);
    expect(git(path.join(workspace, 'pinned'), 'rev-parse', 'HEAD')).toBe(sha);
    expect(warnings).toStrictEqual([expect.stringContaining("can't check out commit")]);
  });

  describe('with an existing clone', () => {
    let repo: string;
    let projectDir: string;

    beforeEach(async () => {
      repo = sourceRepo('org/core');
      projectDir = rootProject([{ package: 'core' }], { core: { url: repo, ref: 'main' } });
      await clone({ projectDir });
      fs.writeFileSync(path.join(repo, 'new.txt'), 'new');
      git(repo, 'add', '.');
      git(repo, 'commit', '--quiet', '-m', 'new');
    });

    it('leaves it alone without update', async () => {
      expect(statuses(await clone({ projectDir }))).toStrictEqual([['core', 'Already cloned']]);
      expect(fs.existsSync(path.join(workspace, 'core', 'new.txt'))).toBe(false);
    });

    it('fast-forwards it with update', async () => {
      expect(statuses(await clone({ projectDir, update: true }))).toStrictEqual([['core', 'Updated']]);
      expect(fs.existsSync(path.join(workspace, 'core', 'new.txt'))).toBe(true);
    });

    it('skips it with update when it has uncommitted changes', async () => {
      fs.writeFileSync(path.join(workspace, 'core', 'README.md'), 'edited');
      expect(statuses(await clone({ projectDir, update: true }))).toStrictEqual([['core', 'Dirty, skipped']]);
    });

    it('skips it with update when it is on another branch', async () => {
      git(path.join(workspace, 'core'), 'switch', '--quiet', '-c', 'my-work');
      const [row] = await clone({ projectDir, update: true });
      expect(row).toMatchObject({ status: 'On other branch, skipped', message: 'on my-work, not main' });
    });

    it('fails, without touching it, when the folder is a clone of something else', async () => {
      const other = sourceRepo('elsewhere/core');
      fs.writeFileSync(
        path.join(projectDir, 'sfdx-project.json'),
        projectJson('my-app', [{ package: 'core' }], { core: { url: other } }),
      );
      const [row] = await clone({ projectDir });
      expect(row.status).toBe('Failed');
      expect(row.message).toContain('is a clone of');
    });
  });

  it('plans without running git in a dry run', async () => {
    const neverRun: GitRunner = () => Promise.reject(new Error('git should not run'));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: 'https://github.com/org/core.git' } });

    const results = await clonePackageDependencies({ projectDir, dryRun: true, git: neverRun });

    expect(statuses(results)).toStrictEqual([['core', 'Would clone']]);
  });

  it('fails up front when git cannot run', async () => {
    const missing: GitRunner = () => Promise.reject(new Error('spawn git ENOENT'));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: 'https://github.com/org/core.git' } });

    await expect(clonePackageDependencies({ projectDir, git: missing })).rejects.toMatchObject({
      name: 'GitNotFoundError',
    });
  });

  it('reports a failed clone and carries on', async () => {
    const good = sourceRepo('org/good');
    const projectDir = rootProject([{ package: 'gone' }, { package: 'good' }], {
      gone: { url: path.join(sources, 'does-not-exist') },
      good: { url: good },
    });

    expect(statuses(await clone({ projectDir }))).toStrictEqual([
      ['gone', 'Failed'],
      ['good', 'Cloned'],
    ]);
  });
});

describe('normalizeRepositoryUrl', () => {
  it('treats https, ssh, and scp-like forms of one repository as the same', () => {
    const forms = [
      'https://GitHub.com/org/repo.git',
      'https://github.com/org/repo/',
      'ssh://git@github.com/org/repo.git',
      'ssh://git@github.com:22/org/repo',
      'git@github.com:org/repo.git',
    ];
    expect(new Set(forms.map((url) => normalizeRepositoryUrl(url, '/')))).toStrictEqual(
      new Set(['github.com/org/repo']),
    );
  });

  it('trims many trailing slashes, and stays fast on slashes that are not trailing', () => {
    expect(normalizeRepositoryUrl(`https://github.com/org/repo${'/'.repeat(50)}`, '/')).toBe('github.com/org/repo');
    const started = performance.now();
    normalizeRepositoryUrl(`https://github.com/org/${'/'.repeat(100_000)}x`, '/');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('resolves a relative local path against the given directory', () => {
    expect(normalizeRepositoryUrl('../repo.git', path.join(path.sep, 'work', 'app'))).toBe(
      path.resolve(path.sep, 'work', 'repo'),
    );
  });
});
