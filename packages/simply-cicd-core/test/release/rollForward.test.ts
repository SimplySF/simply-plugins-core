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
import { rollForward } from '../../src/release/rollForward.js';

// These run real git against a bare remote: the guarantees are about git's behavior, so mocking it
// would prove little.
// A git hook exports variables like GIT_DIR, which would point these commands at the repo being
// pushed instead of the temporary ones, so they're cleared for this whole test file.
for (const key of Object.keys(process.env).filter((name) => name.startsWith('GIT_'))) {
  delete process.env[key];
}

let root: string;
let lead: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const project = (version: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify(
    {
      packageDirectories: [
        {
          path: 'force-app',
          package: 'Pkg',
          versionName: `v${version}`,
          versionNumber: `${version}.NEXT`,
          default: true,
          ...extra,
        },
      ],
      packageAliases: { Pkg: '0Ho' },
    },
    undefined,
    2,
  )}\n`;

function commit(cwd: string, file: string, content: string, message = file): void {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
}

function configure(cwd: string): void {
  git(cwd, 'config', 'user.email', 'lead@example.com');
  git(cwd, 'config', 'user.name', 'Lead');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'config', 'tag.gpgsign', 'false');
}

function cutRelease(
  cwd: string,
  base: string,
  version: string,
  buildTag: string,
  extra?: Record<string, unknown>,
): void {
  git(cwd, 'switch', '-qc', `release/v${version}`, base);
  commit(cwd, 'sfdx-project.json', project(version, extra), `bump ${version}`);
  commit(cwd, `work-${version}.txt`, version);
  git(cwd, 'tag', '-a', buildTag, '-m', '04t');
}

const pushAll = (): string => git(lead, 'push', '-q', 'origin', '--all', '--follow-tags');
type Project = { packageDirectories: Array<Record<string, unknown>>; packageAliases: Record<string, string> };
const remoteProject = (branch: string): Project =>
  JSON.parse(git(remote, 'show', `${branch}:sfdx-project.json`)) as Project;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'roll-forward-test-'));
  remote = path.join(root, 'remote.git');
  lead = path.join(root, 'lead');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'release/v1.0.0', lead);
  configure(lead);
  git(lead, 'remote', 'add', 'origin', remote);
  commit(lead, 'sfdx-project.json', project('1.0.0'), 'base');
  git(lead, 'tag', '-a', 'v1.0.0.1', '-m', '04t');
  cutRelease(lead, 'release/v1.0.0', '1.1.0', 'v1.1.0.13');
  cutRelease(lead, 'release/v1.0.0', '1.2.0', 'v1.2.0.5');
  pushAll();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('rollForward', () => {
  it('resolves the first roll identity conflict and keeps the source tags in the target history', async () => {
    const result = await rollForward({ cwd: lead });

    const hop = result.hops.find(({ target }) => target === 'release/v1.2.0');
    expect(hop?.status).toBe('Rolled');
    expect(hop?.tags).toContain('v1.1.0.13');
    expect(git(remote, 'tag', '--merged', 'release/v1.2.0')).toContain('v1.1.0.13');
    expect(remoteProject('release/v1.2.0').packageDirectories[0].versionNumber).toBe('1.2.0.NEXT');
    expect(remoteProject('release/v1.2.0').packageDirectories[0].versionName).toBe('v1.2.0');
  });

  it('makes a real merge commit with the target as first parent', async () => {
    const before = git(remote, 'rev-parse', 'release/v1.2.0');
    const sourceTip = git(remote, 'rev-parse', 'release/v1.1.0');

    await rollForward({ cwd: lead });

    expect(git(remote, 'rev-parse', 'release/v1.2.0^1')).toBe(before);
    expect(git(remote, 'rev-parse', 'release/v1.2.0^2')).toBe(sourceTip);
  });

  it('reports up to date on a second run, and rolls clean when the source moves', async () => {
    await rollForward({ cwd: lead });
    const again = await rollForward({ cwd: lead });
    expect(again.hops.every(({ status }) => status === 'Up to date')).toBe(true);

    git(lead, 'switch', '-q', 'release/v1.1.0');
    git(lead, 'pull', '-q', 'origin', 'release/v1.1.0');
    commit(lead, 'fix.txt', 'fix');
    git(lead, 'tag', '-a', 'v1.1.0.14', '-m', '04t');
    git(lead, 'push', '-q', 'origin', 'release/v1.1.0', 'v1.1.0.14');

    const third = await rollForward({ cwd: lead });
    expect(third.hops.at(-1)?.status).toBe('Rolled');
    expect(git(remote, 'tag', '--merged', 'release/v1.2.0')).toContain('v1.1.0.14');
  });

  it('rolls a chain, carrying each merge into the next hop, and returns to the start branch', async () => {
    cutRelease(lead, 'release/v1.2.0', '1.10.0', 'v1.10.0.1');
    cutRelease(lead, 'release/v1.2.0', '1.9.0', 'v1.9.0.1');
    pushAll();
    git(lead, 'switch', '-q', 'release/v1.0.0');

    const { hops } = await rollForward({ cwd: lead, source: 'release/v1.1.0' });

    expect(hops.map(({ target }) => target)).toEqual(['release/v1.2.0', 'release/v1.9.0', 'release/v1.10.0']);
    expect(hops.every(({ status }) => status === 'Rolled')).toBe(true);
    expect(git(remote, 'tag', '--merged', 'release/v1.10.0')).toContain('v1.1.0.13');
    expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.0.0');
  });

  it('stops on an unrelated conflict, leaves later hops alone, and finishes on a re-run', async () => {
    git(lead, 'switch', '-q', 'release/v1.1.0');
    commit(lead, 'shared.txt', 'from 1.1\n');
    git(lead, 'switch', '-q', 'release/v1.2.0');
    commit(lead, 'shared.txt', 'from 1.2\n');
    cutRelease(lead, 'release/v1.2.0', '1.3.0', 'v1.3.0.1');
    pushAll();
    const target = git(remote, 'rev-parse', 'release/v1.2.0');

    const first = await rollForward({ cwd: lead });
    const [conflict, later] = first.hops.filter(({ source }) => source !== 'release/v1.0.0');
    expect(conflict.status).toBe('Conflict');
    expect(conflict.conflictedFiles).toEqual(['shared.txt']);
    expect(later.status).toBe('Not started');
    expect(git(remote, 'rev-parse', 'release/v1.2.0')).toBe(target);

    await expect(rollForward({ cwd: lead })).rejects.toThrow(/merge is still in progress/);

    fs.writeFileSync(path.join(lead, 'shared.txt'), 'both\n');
    git(lead, 'add', '-A');
    git(lead, 'commit', '-qm', 'resolved');

    const second = await rollForward({ cwd: lead });
    expect(second.hops.filter(({ status }) => status === 'Rolled').map(({ target: t }) => t)).toEqual([
      'release/v1.2.0',
      'release/v1.3.0',
    ]);
    expect(git(remote, 'show', 'release/v1.2.0:shared.txt')).toBe('both');
  });

  it('stops on a dependencies conflict, with identity already resolved', async () => {
    git(lead, 'switch', '-q', 'release/v1.1.0');
    commit(lead, 'sfdx-project.json', project('1.1.0', { dependencies: [{ package: 'Dep@1.0.0-1' }] }));
    git(lead, 'switch', '-q', 'release/v1.2.0');
    commit(lead, 'sfdx-project.json', project('1.2.0', { dependencies: [{ package: 'Dep@2.0.0-1' }] }));
    pushAll();

    const { hops } = await rollForward({ cwd: lead });

    expect(hops.at(-1)?.conflictedFiles).toEqual(['sfdx-project.json']);
    const text = fs.readFileSync(path.join(lead, 'sfdx-project.json'), 'utf8');
    expect(text).toContain('Dep@2.0.0-1');
    expect(text).toContain('"versionNumber": "1.2.0.NEXT"');
    expect(text).not.toContain('"versionNumber": "1.1.0.NEXT"');
  });

  it('forces the target identity back when a wrong value merged cleanly, and unions aliases', async () => {
    git(lead, 'switch', '-q', 'release/v1.1.0');
    const withAlias = JSON.parse(project('1.1.0')) as { packageAliases: Record<string, string> };
    withAlias.packageAliases['Pkg@1.1.0-13'] = '04t';
    commit(lead, 'sfdx-project.json', `${JSON.stringify(withAlias, undefined, 2)}\n`);
    pushAll();

    await rollForward({ cwd: lead });

    const merged = remoteProject('release/v1.2.0');
    expect(merged.packageDirectories[0].versionNumber).toBe('1.2.0.NEXT');
    expect(merged.packageAliases).toEqual({ Pkg: '0Ho', 'Pkg@1.1.0-13': '04t' });
  });

  it('never publishes a local-only tag', async () => {
    git(lead, 'tag', 'stray');

    await rollForward({ cwd: lead });

    expect(git(remote, 'tag')).not.toContain('stray');
  });

  it('rejects a moved target without forcing, and succeeds on a re-run', async () => {
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', remote, other);
    configure(other);
    let moved = false;

    const hookedConfirm = async (): Promise<boolean> => {
      if (!moved) {
        moved = true;
        git(other, 'switch', '-q', 'release/v1.2.0');
        commit(other, 'race.txt', 'race');
        git(other, 'push', '-q', 'origin', 'release/v1.2.0');
      }
      return true;
    };

    await expect(rollForward({ cwd: lead, confirm: hookedConfirm })).rejects.toThrow(
      /Pushing to release\/v1.2.0 failed/,
    );
    expect(git(remote, 'log', '-1', '--format=%s', 'release/v1.2.0')).toBe('race.txt');

    const { hops } = await rollForward({ cwd: lead });
    expect(hops.at(-1)?.status).toBe('Rolled');
    expect(git(remote, 'show', 'release/v1.2.0:race.txt')).toBe('race');
  });

  it('changes nothing on a dry run or a declined confirmation', async () => {
    const target = git(remote, 'rev-parse', 'release/v1.2.0');

    const dry = await rollForward({ cwd: lead, dryRun: true });
    expect(dry.hops.at(-1)?.status).toBe('Would roll');

    const declined = await rollForward({ cwd: lead, confirm: () => Promise.resolve(false) });
    expect(declined.declined).toBe(true);

    expect(git(remote, 'rev-parse', 'release/v1.2.0')).toBe(target);
    expect(git(lead, 'branch', '--list', 'roll-forward/*')).toBe('');
  });

  it('leaves the merge on the roll branch with noPush, and pushes it on a later run', async () => {
    git(lead, 'switch', '-q', 'release/v1.0.0');
    const target = git(remote, 'rev-parse', 'release/v1.2.0');

    const { hops } = await rollForward({ cwd: lead, noPush: true });
    expect(hops.at(-1)?.status).toBe('Merged, not pushed');
    expect(git(remote, 'rev-parse', 'release/v1.2.0')).toBe(target);
    expect(git(lead, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v1.0.0');
    expect(git(lead, 'branch', '--list', 'roll-forward/v1.1.0-to-v1.2.0')).toContain('roll-forward');

    const later = await rollForward({ cwd: lead });
    expect(later.hops.at(-1)?.status).toBe('Rolled');
  });

  it('refuses a shallow clone, a dirty tree, a backward roll, and a version that disagrees with its name', async () => {
    const shallow = path.join(root, 'shallow');
    git(root, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${remote}`, shallow);
    await expect(rollForward({ cwd: shallow })).rejects.toThrow(/shallow clone/);

    await expect(rollForward({ cwd: lead, source: 'release/v1.2.0', target: 'release/v1.1.0' })).rejects.toThrow(
      /lower version/,
    );

    git(lead, 'switch', '-q', '-c', 'release/v1.4.0', 'release/v1.2.0');
    commit(lead, 'bystander.txt', 'x');
    pushAll();
    await expect(rollForward({ cwd: lead })).rejects.toThrow(/doesn't match its name/);

    fs.writeFileSync(path.join(lead, 'bystander.txt'), 'dirty');
    await expect(rollForward({ cwd: lead })).rejects.toThrow(/uncommitted changes/);
  });
});
