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

import { describe, expect, it } from 'vitest';
import { bumpProjectVersion, hasVersion } from '../../src/release/projectVersion.js';
import { nextReleaseBranch, parseReleaseBranch, type ReleaseBranch } from '../../src/release/releaseBranches.js';

const branch = (name: string): ReleaseBranch => parseReleaseBranch(name, 'release/')!;

describe('nextReleaseBranch', () => {
  it.each([
    ['release/v1.2.0', 'patch', 'release/v1.2.1'],
    ['release/v1.2.3', 'minor', 'release/v1.3.0'],
    ['release/v1.2.3', 'major', 'release/v2.0.0'],
    ['release/v1.9.0', 'minor', 'release/v1.10.0'],
    ['release/1.2.0', 'minor', 'release/1.3.0'],
    ['release/1.2', 'minor', 'release/1.3'],
    ['release/v1.2', 'major', 'release/v2.0'],
  ] as const)('%s with %s is %s', (from, type, to) => {
    const next = nextReleaseBranch(branch(from), type, 'release/');
    expect(next.name).toBe(to);
    expect(next).toEqual(branch(to));
  });

  it('refuses a patch on a minor-line branch', () => {
    expect(() => nextReleaseBranch(branch('release/1.2'), 'patch', 'release/')).toThrow('has no patch version');
  });
});

describe('bumpProjectVersion', () => {
  const project = (directories: Array<Record<string, unknown>>): Record<string, unknown> => ({
    packageDirectories: directories,
    packageAliases: { Core: '0Ho' },
  });

  it('bumps versionNumber, keeping its build part, and the version inside versionName', () => {
    const { project: bumped, bumped: names } = bumpProjectVersion(
      project([{ package: 'Core', versionName: 'Core v1.2.0', versionNumber: '1.2.0.NEXT', default: true }]),
      branch('release/v1.2.0'),
      branch('release/v1.3.0'),
    );

    expect(bumped.packageDirectories).toEqual([
      { package: 'Core', versionName: 'Core v1.3.0', versionNumber: '1.3.0.NEXT', default: true },
    ]);
    expect(names).toEqual(['Core']);
  });

  it('rewrites a versionName without a v, and leaves one without the version alone', () => {
    const result = bumpProjectVersion(
      project([
        { package: 'A', versionName: 'Release 1.2.0', versionNumber: '1.2.0.NEXT' },
        { package: 'B', versionName: 'Spring', versionNumber: '1.2.0.NEXT' },
      ]),
      branch('release/v1.2.0'),
      branch('release/v1.2.1'),
    );

    const [a, b] = result.project.packageDirectories as Array<Record<string, unknown>>;
    expect(a.versionName).toBe('Release 1.2.1');
    expect(b.versionName).toBe('Spring');
    expect(result.versionNameUnchanged).toEqual(['B']);
  });

  it('matches only a whole version, so 1.2.0 never rewrites 11.2.0 or 1.2.05', () => {
    const { versionNameUnchanged } = bumpProjectVersion(
      project([{ package: 'A', versionName: 'v11.2.0 / 1.2.05', versionNumber: '1.2.0.NEXT' }]),
      branch('release/v1.2.0'),
      branch('release/v1.3.0'),
    );

    expect(versionNameUnchanged).toEqual(['A']);
  });

  it('bumps a minor-line versionName either way it is written', () => {
    const { project: bumped } = bumpProjectVersion(
      project([
        { package: 'A', versionName: 'v1.2', versionNumber: '1.2.0.NEXT' },
        { package: 'B', versionName: 'v1.2.0', versionNumber: '1.2.0.NEXT' },
      ]),
      branch('release/1.2'),
      branch('release/1.3'),
    );

    expect((bumped.packageDirectories as Array<Record<string, unknown>>).map((d) => d.versionName)).toEqual([
      'v1.3',
      'v1.3.0',
    ]);
  });

  it('leaves package directories on another version alone', () => {
    const input = project([
      { package: 'Core', versionName: 'v1.2.0', versionNumber: '1.2.0.NEXT', default: true },
      { package: 'Tools', versionName: 'v4.0.0', versionNumber: '4.0.0.NEXT' },
      { path: 'unpackaged' },
    ]);
    const { project: bumped, bumped: names } = bumpProjectVersion(
      input,
      branch('release/v1.2.0'),
      branch('release/v2.0.0'),
    );

    const directories = bumped.packageDirectories as Array<Record<string, unknown>>;
    expect(directories[1]).toEqual({ package: 'Tools', versionName: 'v4.0.0', versionNumber: '4.0.0.NEXT' });
    expect(directories[2]).toEqual({ path: 'unpackaged' });
    expect(names).toEqual(['Core']);
    expect((input.packageDirectories as Array<Record<string, unknown>>)[0].versionNumber).toBe('1.2.0.NEXT');
  });

  it('hasVersion says whether any directory carries a version', () => {
    const bumped = project([{ package: 'Core', versionNumber: '1.3.0.NEXT' }]);
    expect(hasVersion(bumped, branch('release/v1.3.0'))).toBe(true);
    expect(hasVersion(bumped, branch('release/v1.2.0'))).toBe(false);
  });
});
