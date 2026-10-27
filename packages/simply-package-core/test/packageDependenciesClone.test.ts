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
  defaultGitRunner,
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
let infos: string[];

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

/** Clone with warning and info collectors attached. */
async function clone(options: Omit<ClonePackageDependenciesOptions, 'progress'>): Promise<DependencyCloneResult[]> {
  return clonePackageDependencies({
    ...options,
    progress: { warn: (message) => warnings.push(message), info: (message) => infos.push(message) },
  });
}

/**
 * A runner that serves `https` URLs from local repositories, so a URL from a dependency's project
 * file, which must be https or ssh, can be cloned without a network. It records each command as
 * the engine sent it, then drops the protocol settings that would refuse the local path.
 */
function servingGit(served: Record<string, string>, calls: string[][]): GitRunner {
  return (args, options) => {
    calls.push(args);
    const local = args.filter(
      (arg, i) => !arg.startsWith('protocol.') && !(arg === '-c' && args[i + 1]?.startsWith('protocol.')),
    );
    return defaultGitRunner(
      local.map((arg) => served[arg] ?? arg),
      options,
    );
  };
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
  infos = [];
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

  it("follows dependencies of dependencies with recursive, allowing only https and ssh for a dependency's URLs", async () => {
    const leafUrl = 'https://git.example.com/org/leaf.git';
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'leaf' }], { leaf: { url: leafUrl } }));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core } });
    const calls: string[][] = [];

    const results = await clone({ projectDir, recursive: true, git: servingGit({ [leafUrl]: leaf }, calls) });

    expect(results.map((row) => [row.package, row.status, row.via])).toStrictEqual([
      ['core', 'Cloned', 'my-app'],
      ['leaf', 'Cloned', 'core'],
    ]);
    expect(fs.existsSync(path.join(workspace, 'leaf', 'README.md'))).toBe(true);
    expect(calls.find((args) => args.includes(leafUrl))?.slice(0, 7)).toStrictEqual([
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'protocol.ssh.allow=always',
      'clone',
    ]);
    expect(calls.find((args) => args.includes(core))).not.toContain('protocol.allow=never');
    expect(infos).toContainEqual(expect.stringMatching(/^leaf's repository comes from core's sfdx-project\.json/));
  });

  it("uses the root's map for a dependency's dependencies, ahead of the dependency's own", async () => {
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo(
      'org/core',
      projectJson('core', [{ package: 'leaf' }], { leaf: { url: 'https://git.example.com/other/leaf.git' } }),
    );
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core }, leaf: { url: leaf } });

    const results = await clone({ projectDir, recursive: true });

    expect(statuses(results)).toStrictEqual([
      ['core', 'Cloned'],
      ['leaf', 'Cloned'],
    ]);
    expect(results[1].url).toBe(leaf);
    expect(infos.some((message) => message.includes('comes from'))).toBe(false);
  });

  it.each(['04t000000000001AAA', 'other-core@1.8.0-3'])(
    "uses the root's map for a dependency that names the package as %s",
    async (packageRef) => {
      const leaf = sourceRepo('org/my-core');
      const core = sourceRepo(
        'org/core',
        JSON.stringify({
          ...(JSON.parse(
            projectJson('core', [{ package: packageRef }], {
              'other-core': { url: 'https://git.example.com/other/core.git' },
            }),
          ) as object),
          packageAliases: { 'other-core@1.8.0-3': '04t000000000001AAA' },
        }),
      );
      const projectDir = rootProject(
        [{ package: 'core' }],
        { core: { url: core }, 'my-core': { url: leaf } },
        { packageAliases: { 'my-core@1.8.0-3': '04t000000000001AAA' } },
      );

      const results = await clone({ projectDir, recursive: true });

      expect(results.map((row) => [row.package, row.key, row.status])).toStrictEqual([
        ['core', 'core', 'Cloned'],
        [packageRef, 'my-core', 'Cloned'],
      ]);
      expect(results[1].url).toBe(leaf);
      expect(infos.some((message) => message.includes('comes from'))).toBe(false);
    },
  );

  it("gives each package from one repository its own row, and follows each one's path", async () => {
    const leafA = sourceRepo('org/leaf-a');
    const leafB = sourceRepo('org/leaf-b');
    const mono = sourceRepo('org/mono');
    fs.mkdirSync(path.join(mono, 'a'));
    fs.mkdirSync(path.join(mono, 'b'));
    fs.writeFileSync(path.join(mono, 'a', 'sfdx-project.json'), projectJson('pkg-a', [{ package: 'leaf-a' }]));
    fs.writeFileSync(path.join(mono, 'b', 'sfdx-project.json'), projectJson('pkg-b', [{ package: 'leaf-b' }]));
    git(mono, 'add', '.');
    git(mono, 'commit', '--quiet', '-m', 'packages');
    const projectDir = rootProject([{ package: 'pkg-a' }, { package: 'pkg-b' }], {
      'pkg-a': { url: mono, path: 'a' },
      'pkg-b': { url: mono, path: 'b' },
      'leaf-a': { url: leafA },
      'leaf-b': { url: leafB },
    });

    const results = await clone({ projectDir, recursive: true });

    expect(results.map((row) => [row.package, row.status, row.directory])).toStrictEqual([
      ['pkg-a', 'Cloned', path.join(workspace, 'mono')],
      ['pkg-b', 'Cloned', path.join(workspace, 'mono')],
      ['leaf-a', 'Cloned', path.join(workspace, 'leaf-a')],
      ['leaf-b', 'Cloned', path.join(workspace, 'leaf-b')],
    ]);
    expect(results[1].message).toBe('same repository as pkg-a');
  });

  it("reports a dependency that points back at the root project's repository, without touching it", async () => {
    const appUrl = 'https://git.example.com/org/app.git';
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'my-app' }], { 'my-app': { url: appUrl } }));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core } });
    git(projectDir, 'init', '--quiet', '--initial-branch', 'main');
    git(projectDir, 'remote', 'add', 'origin', appUrl);
    const calls: string[][] = [];

    const results = await clone({ projectDir, recursive: true, update: true, git: servingGit({}, calls) });

    expect(results.map((row) => [row.package, row.status, row.directory])).toStrictEqual([
      ['core', 'Cloned', path.join(workspace, 'core')],
      ['my-app', 'Already cloned', projectDir],
    ]);
    expect(results[1].message).toBe('the project itself');
    expect(fs.readdirSync(workspace).sort()).toStrictEqual(['app', 'core']);
    expect(calls.some((args) => args.includes(appUrl) && !args.includes('get-url'))).toBe(false);
    expect(warnings).toStrictEqual([]);
  });

  it("fails a dependency's URL that isn't https or ssh, naming where it came from", async () => {
    const leaf = sourceRepo('org/leaf');
    const core = sourceRepo('org/core', projectJson('core', [{ package: 'leaf' }], { leaf: { url: leaf } }));
    const projectDir = rootProject([{ package: 'core' }], { core: { url: core } });

    const results = await clone({ projectDir, recursive: true });

    expect(statuses(results)).toStrictEqual([
      ['core', 'Cloned'],
      ['leaf', 'Failed'],
    ]);
    expect(results[1].message).toMatch(/^core's sfdx-project\.json gives a URL that isn't https or ssh/);
    expect(fs.existsSync(path.join(workspace, 'leaf'))).toBe(false);
  });

  it('notes the clones left on a branch, but not those at a tag', async () => {
    const core = sourceRepo('org/core');
    const fflib = sourceRepo('org/fflib', undefined, ['v3.0.0']);
    const projectDir = rootProject([{ package: 'core' }, { package: 'fflib' }], {
      core: { url: core },
      fflib: { url: fflib, ref: 'v3.0.0' },
    });

    await clone({ projectDir });

    expect(infos).toStrictEqual([
      'core (main) is on a branch, so a later --update brings in newer commits. To stay on one version, set "ref" to a tag.',
    ]);
    expect(warnings).toStrictEqual([]);
  });

  it('checks out a tag, and keeps the ref found first when two refs conflict', async () => {
    const sharedUrl = 'https://git.example.com/org/shared.git';
    const shared = sourceRepo('org/shared', undefined, ['v1']);
    fs.writeFileSync(path.join(shared, 'v2.txt'), 'v2');
    git(shared, 'add', '.');
    git(shared, 'commit', '--quiet', '-m', 'v2');
    git(shared, 'tag', 'v2');
    const core = sourceRepo(
      'org/core',
      projectJson('core', [{ package: 'shared' }], { shared: { url: sharedUrl, ref: 'v1' } }),
    );
    const other = sourceRepo(
      'org/other',
      projectJson('other', [{ package: 'shared' }], { shared: { url: `${sharedUrl}/`, ref: 'v2' } }),
    );
    const projectDir = rootProject([{ package: 'core' }, { package: 'other' }], {
      core: { url: core },
      other: { url: other },
    });

    const results = await clone({ projectDir, recursive: true, git: servingGit({ [sharedUrl]: shared }, []) });

    expect(statuses(results)).toStrictEqual([
      ['core', 'Cloned'],
      ['other', 'Cloned'],
      ['shared', 'Cloned'],
    ]);
    expect(fs.existsSync(path.join(workspace, 'shared', 'v2.txt'))).toBe(false);
    expect(warnings).toStrictEqual([expect.stringMatching(/shared is wanted at v2 by other.*Keeping v1/)]);
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

  it('clones a branch or tag whose name looks like a SHA as a branch or tag', async () => {
    const repo = sourceRepo('org/hexed');
    const dated = sourceRepo('org/dated', undefined, ['20260101']);
    git(repo, 'switch', '--quiet', '-c', 'cafe123');
    fs.writeFileSync(path.join(repo, 'branch.txt'), 'branch');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'branch');
    git(repo, 'switch', '--quiet', 'main');
    const projectDir = rootProject([{ package: 'hexed' }, { package: 'tagged' }], {
      hexed: { url: repo, ref: 'cafe123' },
      tagged: { url: dated, ref: '20260101' },
    });

    const results = await clone({ projectDir, depth: 1 });

    expect(statuses(results)).toStrictEqual([
      ['hexed', 'Cloned'],
      ['tagged', 'Cloned'],
    ]);
    expect(git(path.join(workspace, 'hexed'), 'symbolic-ref', '--short', 'HEAD')).toBe('cafe123');
    expect(git(path.join(workspace, 'dated'), 'describe', '--tags', '--exact-match')).toBe('20260101');
    expect(warnings).toStrictEqual([]);
  });

  describe('with an existing clone', () => {
    let repo: string;
    let projectDir: string;

    /** Change the root's ref for core, as a user pinning a version after the first clone would. */
    function setRef(ref: string): void {
      fs.writeFileSync(
        path.join(projectDir, 'sfdx-project.json'),
        projectJson('my-app', [{ package: 'core' }], { core: { url: repo, ref } }),
      );
    }

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

    it('moves it from the default branch to a tag that is set later, with update', async () => {
      git(repo, 'tag', 'v3.0.0');
      setRef('v3.0.0');

      expect(statuses(await clone({ projectDir, update: true }))).toStrictEqual([['core', 'Updated']]);
      expect(git(path.join(workspace, 'core'), 'describe', '--tags', '--exact-match')).toBe('v3.0.0');
      expect(() => git(path.join(workspace, 'core'), 'symbolic-ref', '--quiet', 'HEAD')).toThrow();
    });

    it('skips it with update when the default branch has commits of its own, naming the tag', async () => {
      git(repo, 'tag', 'v3.0.0');
      setRef('v3.0.0');
      const clonePath = path.join(workspace, 'core');
      fs.writeFileSync(path.join(clonePath, 'mine.txt'), 'mine');
      git(clonePath, 'add', '.');
      git(clonePath, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'mine');

      const [row] = await clone({ projectDir, update: true });
      expect(row).toMatchObject({ status: 'On other branch, skipped', message: 'on main, not tag v3.0.0' });
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

describe('defaultGitRunner', () => {
  const savedEnv = ['GIT_CONFIG_GLOBAL', 'GIT_SSH_COMMAND', 'GIT_SSH', 'PATH'] as const;
  let originalEnv: Partial<Record<(typeof savedEnv)[number], string>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(savedEnv.map((name) => [name, process.env[name]]));
  });

  afterEach(() => {
    for (const name of savedEnv) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  /** Put an `ssh` on PATH that records its arguments and fails, and return where it records them. */
  function fakeSsh(): string {
    const bin = path.join(tmp, 'bin');
    const argsFile = path.join(tmp, 'ssh-args');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\necho "$@" > '${argsFile}'\nexit 255\n`, { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'empty-gitconfig');
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
    delete process.env.GIT_SSH;
    return argsFile;
  }

  it.skipIf(process.platform === 'win32')('runs ssh in batch mode, so it fails instead of prompting', async () => {
    const argsFile = fakeSsh();
    delete process.env.GIT_SSH_COMMAND;

    await expect(
      defaultGitRunner(['ls-remote', 'ssh://git@git.example.com/org/core.git'], { cwd: tmp }),
    ).rejects.toThrow();
    expect(fs.readFileSync(argsFile, 'utf-8')).toContain('-o BatchMode=yes');
  });

  it.skipIf(process.platform === 'win32')("leaves the user's own ssh command alone", async () => {
    const argsFile = fakeSsh();
    process.env.GIT_SSH_COMMAND = 'ssh -o ConnectTimeout=5';

    await expect(
      defaultGitRunner(['ls-remote', 'ssh://git@git.example.com/org/core.git'], { cwd: tmp }),
    ).rejects.toThrow();
    const args = fs.readFileSync(argsFile, 'utf-8');
    expect(args).toContain('ConnectTimeout=5');
    expect(args).not.toContain('BatchMode');
  });

  it("keeps submodules and the ext transport off, whatever the user's git config says", async () => {
    const globalConfig = path.join(tmp, 'gitconfig');
    fs.writeFileSync(
      globalConfig,
      '[submodule]\n\trecurse = true\n[fetch]\n\trecurseSubmodules = true\n[protocol "ext"]\n\tallow = always\n',
    );
    process.env.GIT_CONFIG_GLOBAL = globalConfig;

    const read = (name: string): Promise<string> => defaultGitRunner(['config', '--get', name], { cwd: tmp });
    expect(await read('submodule.recurse')).toBe('false');
    expect(await read('fetch.recurseSubmodules')).toBe('false');
    expect(await read('protocol.ext.allow')).toBe('never');
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
