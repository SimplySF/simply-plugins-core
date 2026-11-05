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
});
