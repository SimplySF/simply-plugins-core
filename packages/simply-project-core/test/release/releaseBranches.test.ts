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
import {
  nextReleaseBranch,
  parseReleaseBranch,
  selectReleasePairs,
  sortReleaseBranches,
  versionNumberMatchesBranch,
} from '../../src/release/releaseBranches.js';

const names = ['release/v1.9.0', 'release/uat', 'feature/x', 'release/v1.10.0', 'release/v1.2.0'];

describe('releaseBranches', () => {
  it('parses with and without the v and the patch, and rejects anything else', () => {
    expect(parseReleaseBranch('release/v1.2.3', 'release/')).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      label: 'v1.2.3',
    });
    expect(parseReleaseBranch('release/1.2', 'release/')).toMatchObject({ major: 1, minor: 2 });
    expect(parseReleaseBranch('release/uat', 'release/')).toBeUndefined();
    expect(parseReleaseBranch('v1.2.3', 'release/')).toBeUndefined();
  });

  it('sorts numerically and ignores non-release branches', () => {
    expect(sortReleaseBranches(names, 'release/').map(({ name }) => name)).toEqual([
      'release/v1.2.0',
      'release/v1.9.0',
      'release/v1.10.0',
    ]);
  });

  it('refuses two branches naming one version', () => {
    expect(() => sortReleaseBranches(['release/v1.2.0', 'release/1.2.0'], 'release/')).toThrow(/same version/);
  });

  it('selects adjacent pairs for each flag combination', () => {
    const branches = sortReleaseBranches(names, 'release/');
    const hops = (source?: string, target?: string): string[] =>
      selectReleasePairs(branches, source, target).map((pair) => `${pair.source.label}>${pair.target.label}`);

    expect(hops()).toEqual(['v1.2.0>v1.9.0', 'v1.9.0>v1.10.0']);
    expect(hops('release/v1.9.0')).toEqual(['v1.9.0>v1.10.0']);
    expect(hops(undefined, 'release/v1.9.0')).toEqual(['v1.2.0>v1.9.0']);
    expect(hops('release/v1.2.0', 'release/v1.10.0')).toEqual(['v1.2.0>v1.9.0', 'v1.9.0>v1.10.0']);
  });

  it('refuses an unknown branch and a backward roll', () => {
    const branches = sortReleaseBranches(names, 'release/');
    expect(() => selectReleasePairs(branches, 'release/uat')).toThrow(/not a release branch/);
    expect(() => selectReleasePairs(branches, 'release/v1.9.0', 'release/v1.2.0')).toThrow(/lower version/);
  });

  it('compares versionNumber with the branch name', () => {
    const patchBranch = parseReleaseBranch('release/v1.2.0', 'release/')!;
    const minorBranch = parseReleaseBranch('release/1.2', 'release/')!;
    expect(versionNumberMatchesBranch('1.2.0.NEXT', patchBranch)).toBe(true);
    expect(versionNumberMatchesBranch('1.1.0.NEXT', patchBranch)).toBe(false);
    expect(versionNumberMatchesBranch('1.2.7.NEXT', minorBranch)).toBe(true);
  });

  describe('nextReleaseBranch', () => {
    const branch = (name: string): NonNullable<ReturnType<typeof parseReleaseBranch>> =>
      parseReleaseBranch(name, 'release/')!;
    const next = (name: string, type: 'major' | 'minor' | 'patch', increment?: number): string =>
      nextReleaseBranch(branch(name), type, 'release/', increment).name;

    it.each([
      ['major', 'release/v2.0.0'],
      ['minor', 'release/v1.21.0'],
      ['patch', 'release/v1.20.4'],
    ] as const)('moves %s by one by default, resetting the parts below it', (type, expected) => {
      expect(next('release/v1.20.3', type)).toBe(expected);
    });

    it.each([
      ['major', 2, 'release/v3.0.0'],
      ['minor', 10, 'release/v1.30.0'],
      ['patch', 5, 'release/v1.20.8'],
    ] as const)('moves %s by an increment of %i', (type, increment, expected) => {
      expect(next('release/v1.20.3', type, increment)).toBe(expected);
    });

    it("keeps the label's shape", () => {
      expect(next('release/1.20', 'minor', 10)).toBe('release/1.30');
      expect(nextReleaseBranch(branch('release/1.20'), 'minor', 'release/', 10)).toMatchObject({
        label: '1.30',
        major: 1,
        minor: 30,
      });
      expect(next('release/1.4', 'major', 2)).toBe('release/3.0');
    });

    it.each([0, -1, 1.5, Number.NaN])('rejects an increment of %s', (increment) => {
      expect(() => next('release/v1.2.0', 'minor', increment)).toThrow('Use a whole number of at least 1');
    });

    it('still refuses a patch on a minor line', () => {
      expect(() => next('release/1.2', 'patch', 2)).toThrow('names a minor line');
    });
  });
});
