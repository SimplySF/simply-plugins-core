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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VERSION_TAG_FORMAT,
  VersionTagFormat,
  VersionTagFormatError,
} from '../../src/build/versionTagFormat.js';

describe('VersionTagFormat.parse', () => {
  it.each([
    ['{MAJOR}.{MINOR}.{PATCH}', '{BUILD} must appear exactly once, found 0'],
    ['{MAJOR}.{MINOR}.{PATCH}.{BUILD}.{BUILD}', '{BUILD} must appear exactly once, found 2'],
    ['{MAJOR}.{MINOR}.{PATCH}.{BUILDD}', 'unknown placeholder "{BUILDD}"'],
    ['{major}.{minor}.{patch}.{build}', 'unknown placeholder "{major}"'],
    ['v{MAJOR}.{MINOR}.{PATCH}.{BUILD', 'unmatched "{" or "}"'],
    ['{MAJOR}.{MINOR}{PATCH}.{BUILD}', '{MINOR}{PATCH} must be separated by a non-digit'],
    ['{MAJOR}.{MINOR}0{PATCH}.{BUILD}', '{MINOR} and {PATCH} must be separated by a non-digit'],
    ['v {MAJOR}.{MINOR}.{PATCH}.{BUILD}', 'contains a space'],
    ['v{MAJOR}.{MINOR}.{PATCH}*{BUILD}', 'one of ~^:?*[\\'],
    ['v{MAJOR}..{MINOR}.{PATCH}.{BUILD}', 'contains ".."'],
    ['-{MAJOR}.{MINOR}.{PATCH}.{BUILD}', 'cannot start with "-"'],
    ['{MAJOR}.{MINOR}.{PATCH}.{BUILD}.', 'cannot end with "."'],
    ['release//{MAJOR}.{MINOR}.{PATCH}.{BUILD}', 'empty "/"-separated component'],
    ['{MAJOR}.{MINOR}.{PATCH}.{BUILD}.lock', 'ending with ".lock"'],
  ])('should reject %s', (format, problem) => {
    expect(() => VersionTagFormat.parse(format)).toThrow(VersionTagFormatError);
    expect(() => VersionTagFormat.parse(format)).toThrow(problem);
  });

  it('should name the offending format and where it is configured', () => {
    expect(() => VersionTagFormat.parse('{MAJOR}')).toThrow(
      'Invalid version tag format "{MAJOR}" (plugins.simply.versionTagFormat)',
    );
  });

  it('should accept placeholders in any order', () => {
    expect(VersionTagFormat.parse('b{BUILD}-{MAJOR}.{MINOR}.{PATCH}').render('1.2.3.4')).toBe('b4-1.2.3');
  });
});

describe('VersionTagFormat.fromProject', () => {
  it('should default when the project declares no format', () => {
    expect(VersionTagFormat.fromProject({ packageDirectories: [] }).format).toBe(DEFAULT_VERSION_TAG_FORMAT);
    expect(VersionTagFormat.fromProject(undefined).format).toBe(DEFAULT_VERSION_TAG_FORMAT);
  });

  it('should read plugins.simply.versionTagFormat', () => {
    const project = {
      packageDirectories: [],
      plugins: { simply: { versionTagFormat: '{MAJOR}.{MINOR}.{PATCH}+{BUILD}' } },
    };

    expect(VersionTagFormat.fromProject(project).format).toBe('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');
  });

  it('should reject a format that is not a string', () => {
    expect(() =>
      VersionTagFormat.fromProject({ packageDirectories: [], plugins: { simply: { versionTagFormat: 42 } } }),
    ).toThrow('must be a string');
  });

  describe('with SIMPLY_CICD_VERSION_TAG_FORMAT', () => {
    const project = {
      packageDirectories: [],
      plugins: { simply: { versionTagFormat: 'v{MAJOR}.{MINOR}.{PATCH}-{BUILD}' } },
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should override the project setting and the default', () => {
      vi.stubEnv('SIMPLY_CICD_VERSION_TAG_FORMAT', '{MAJOR}.{MINOR}.{PATCH}+{BUILD}');

      expect(VersionTagFormat.fromProject(project).format).toBe('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');
      expect(VersionTagFormat.fromProject(undefined).format).toBe('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');
    });

    it('should be ignored when empty', () => {
      vi.stubEnv('SIMPLY_CICD_VERSION_TAG_FORMAT', '');

      expect(VersionTagFormat.fromProject(project).format).toBe('v{MAJOR}.{MINOR}.{PATCH}-{BUILD}');
    });

    it('should name the variable, not the project setting, when its format is invalid', () => {
      vi.stubEnv('SIMPLY_CICD_VERSION_TAG_FORMAT', '{MAJOR}.{MINOR}.{PATCH}');

      expect(() => VersionTagFormat.fromProject(project)).toThrow(
        'Invalid version tag format "{MAJOR}.{MINOR}.{PATCH}" (SIMPLY_CICD_VERSION_TAG_FORMAT): {BUILD} must appear exactly once',
      );
    });
  });
});

describe('VersionTagFormat render/parseTag', () => {
  it.each([
    [DEFAULT_VERSION_TAG_FORMAT, 'v1.2.3.4'],
    ['{MAJOR}.{MINOR}.{PATCH}+{BUILD}', '1.2.3+4'],
    ['v{MAJOR}.{MINOR}.{PATCH}-{BUILD}', 'v1.2.3-4'],
    ['release/{MAJOR}.{MINOR}.{PATCH}.{BUILD}', 'release/1.2.3.4'],
  ])('should round-trip %s as %s', (format, tag) => {
    const versionTagFormat = VersionTagFormat.parse(format);

    expect(versionTagFormat.render('1.2.3.4')).toBe(tag);
    expect(versionTagFormat.render('1.2.3.4', 'feature/x')).toBe(`${tag}-feature/x`);
    expect(versionTagFormat.parseTag(tag)).toEqual({
      versionTag: tag,
      version: { major: '1', minor: '2', patch: '3', build: '4' },
      rest: '',
    });
    expect(versionTagFormat.parseTag(`${tag}-feature/x-2`)?.rest).toBe('feature/x-2');
  });

  it('should keep a multi-digit build number whole when the format ends in -{BUILD}', () => {
    const versionTagFormat = VersionTagFormat.parse('v{MAJOR}.{MINOR}.{PATCH}-{BUILD}');

    expect(versionTagFormat.parseTag('v1.2.3-45')).toMatchObject({ versionTag: 'v1.2.3-45', rest: '' });
    expect(versionTagFormat.parseTag('v1.2.3-45-1')).toMatchObject({ versionTag: 'v1.2.3-45', rest: '1' });
  });

  it('should not parse a tag in a different shape', () => {
    const versionTagFormat = VersionTagFormat.parse(DEFAULT_VERSION_TAG_FORMAT);

    expect(versionTagFormat.parseTag('v1.1.0')).toBeUndefined();
    expect(versionTagFormat.parseTag('1.2.3.4')).toBeUndefined();
    expect(versionTagFormat.parseTag('v1.2.3.4x')).toBeUndefined();
  });

  it('should refuse to render a version that is not major.minor.patch.build', () => {
    expect(() => VersionTagFormat.parse(DEFAULT_VERSION_TAG_FORMAT).render('1.2.3.NEXT')).toThrow(
      'expected major.minor.patch.build',
    );
  });
});

describe('VersionTagFormat.matchPattern', () => {
  it.each([
    [DEFAULT_VERSION_TAG_FORMAT, '6.40.0.NEXT', 'v6.40.0.*'],
    ['{MAJOR}.{MINOR}.{PATCH}+{BUILD}', '6.40.0.NEXT', '6.40.0+*'],
    ['{MAJOR}.{MINOR}.{PATCH}.{BUILD}-sf', '6.40.0.NEXT', '6.40.0.*-sf*'],
    ['b{BUILD}-{MAJOR}.{MINOR}.{PATCH}', '6.40.0.NEXT', 'b*-6.40.0*'],
    [DEFAULT_VERSION_TAG_FORMAT, undefined, 'v*'],
    [DEFAULT_VERSION_TAG_FORMAT, '6.40', 'v*'],
    ['release/{MAJOR}.{MINOR}.{PATCH}.{BUILD}', undefined, 'release/*'],
    ['{MAJOR}.{MINOR}.{PATCH}+{BUILD}', undefined, '*'],
  ])('should match %s tags for versionNumber %s with %s', (format, versionNumber, pattern) => {
    expect(VersionTagFormat.parse(format).matchPattern(versionNumber)).toBe(pattern);
  });

  it('should no longer match a different patch line that merely starts with the same digits', () => {
    // git's glob, reduced to the one wildcard the pattern uses.
    const pattern = VersionTagFormat.parse(DEFAULT_VERSION_TAG_FORMAT).matchPattern('1.2.3.NEXT');
    const glob = new RegExp(`^${pattern.replace(/[.+]/g, '\\$&').replace(/\*/g, '.*')}$`);

    expect(glob.test('v1.2.3.4')).toBe(true);
    expect(glob.test('v1.2.3.4-feature-1')).toBe(true);
    expect(glob.test('v1.2.30.0')).toBe(false);
  });
});
