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
import { readReleasePluginConfig } from '../../src/release/releaseConfig.js';

const withRelease = (release: unknown): Record<string, unknown> => ({
  packageDirectories: [],
  plugins: { simply: { release } },
});

describe('readReleasePluginConfig', () => {
  it.each([
    ['no plugins key', { packageDirectories: [] }],
    ['no simply key', { plugins: { other: {} } }],
    ['no release key', { plugins: { simply: { versionTagFormat: 'v{MAJOR}' } } }],
    ['no increments key', withRelease({})],
  ])('returns no increments with %s', (_name, project) => {
    expect(readReleasePluginConfig(project).increments ?? {}).toEqual({});
  });

  it('returns the increments a project declares, leaving the rest unset', () => {
    expect(readReleasePluginConfig(withRelease({ increments: { minor: 10, patch: 1 } }))).toEqual({
      increments: { minor: 10, patch: 1 },
    });
  });

  it.each([0, -1, 1.5, '10', null])('rejects an increment of %j, naming the field and source', (value) => {
    expect(() =>
      readReleasePluginConfig(withRelease({ increments: { minor: value } }), 'origin/release/v1.2.0'),
    ).toThrow(
      `plugins.simply.release.increments.minor in origin/release/v1.2.0's sfdx-project.json must be a whole number of at least 1, not ${JSON.stringify(value)}.`,
    );
  });

  it.each([
    ['release', withRelease('fast'), 'plugins.simply.release in'],
    ['increments', withRelease({ increments: [10] }), 'plugins.simply.release.increments in'],
  ])('rejects a %s that is not an object', (_name, project, message) => {
    expect(() => readReleasePluginConfig(project)).toThrow(message);
  });
});
