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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CICD_ENV_VARS,
  findCicdVar,
  LEGACY_CICD_ENV_VARS,
  readCicdEnvVar,
  toEnvFileContent,
  withLegacyCicdEnvVars,
} from '../src/cicdEnvVars.js';
import { logger } from '../src/logger.js';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));

describe('cicdEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefixes every name with SIMPLY_CICD_ and maps each to a distinct, unprefixed legacy name', () => {
    const names = Object.values(CICD_ENV_VARS);
    for (const name of names) {
      expect(name).toMatch(/^SIMPLY_CICD_/);
      expect(LEGACY_CICD_ENV_VARS[name]).toBeDefined();
      expect(LEGACY_CICD_ENV_VARS[name]).not.toMatch(/^SIMPLY_/);
    }
    expect(Object.keys(LEGACY_CICD_ENV_VARS).sort()).toStrictEqual([...names].sort());
    expect(new Set(Object.values(LEGACY_CICD_ENV_VARS)).size).toBe(names.length);
  });

  it('does not reuse the env variable of notify build --subscriber-package-version-id', () => {
    // A dotenv key under that name would make every downstream job look like it built the package.
    expect(Object.values(CICD_ENV_VARS)).not.toContain('SIMPLY_CICD_SUBSCRIBER_PACKAGE_VERSION_ID');
  });

  describe('readCicdEnvVar', () => {
    it('reads the current name without a warning', () => {
      const found = readCicdEnvVar(CICD_ENV_VARS.packageChanged, { SIMPLY_CICD_PACKAGE_CHANGED: 'TRUE' });

      expect(found).toStrictEqual({ name: 'SIMPLY_CICD_PACKAGE_CHANGED', value: 'TRUE' });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('prefers the current name when both are set', () => {
      const found = readCicdEnvVar(CICD_ENV_VARS.packageChanged, {
        SIMPLY_CICD_PACKAGE_CHANGED: 'TRUE',
        PACKAGE_CHANGED: 'FALSE',
      });

      expect(found).toStrictEqual({ name: 'SIMPLY_CICD_PACKAGE_CHANGED', value: 'TRUE' });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('falls back to the legacy name with a deprecation warning', () => {
      const found = readCicdEnvVar(CICD_ENV_VARS.packageChanged, { PACKAGE_CHANGED: 'FALSE' });

      expect(found).toStrictEqual({ name: 'PACKAGE_CHANGED', value: 'FALSE' });
      expect(logger.warn).toHaveBeenCalledWith(
        'PACKAGE_CHANGED is deprecated and will be removed in a future release. Set SIMPLY_CICD_PACKAGE_CHANGED instead.',
      );
    });

    it('treats an empty value as unset', () => {
      expect(readCicdEnvVar(CICD_ENV_VARS.packageChanged, { SIMPLY_CICD_PACKAGE_CHANGED: '' })).toBeUndefined();
      expect(
        readCicdEnvVar(CICD_ENV_VARS.packageChanged, { SIMPLY_CICD_PACKAGE_CHANGED: '', PACKAGE_CHANGED: 'TRUE' }),
      ).toStrictEqual({ name: 'PACKAGE_CHANGED', value: 'TRUE' });
    });

    it('returns undefined when neither name is set', () => {
      expect(readCicdEnvVar(CICD_ENV_VARS.packageChanged, {})).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('findCicdVar', () => {
    it('can fall back silently', () => {
      const found = findCicdVar(CICD_ENV_VARS.lastTag, (key) => (key === 'LAST_TAG' ? 'v1.0.0' : undefined), {
        warn: false,
      });

      expect(found).toStrictEqual({ name: 'LAST_TAG', value: 'v1.0.0' });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('withLegacyCicdEnvVars', () => {
    it('appends a legacy copy of each variable after the current names, with a deprecation notice', () => {
      const result = withLegacyCicdEnvVars({
        [CICD_ENV_VARS.packageChanged]: 'TRUE',
        [CICD_ENV_VARS.lastTag]: 'v1.0.0',
      });

      expect(Object.entries(result)).toStrictEqual([
        ['SIMPLY_CICD_PACKAGE_CHANGED', 'TRUE'],
        ['SIMPLY_CICD_LAST_TAG', 'v1.0.0'],
        ['PACKAGE_CHANGED', 'TRUE'],
        ['LAST_TAG', 'v1.0.0'],
      ]);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('PACKAGE_CHANGED, LAST_TAG'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('will be removed in a future release'));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('skips undefined values, and logs nothing when there is nothing to alias', () => {
      expect(withLegacyCicdEnvVars({ [CICD_ENV_VARS.lastTag]: undefined })).toStrictEqual({
        SIMPLY_CICD_LAST_TAG: undefined,
      });
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('keeps empty values, which the old writers wrote too', () => {
      expect(withLegacyCicdEnvVars({ [CICD_ENV_VARS.lastTag]: '' })).toStrictEqual({
        SIMPLY_CICD_LAST_TAG: '',
        LAST_TAG: '',
      });
    });
  });

  describe('toEnvFileContent', () => {
    it('renders one KEY=value line per defined variable', () => {
      expect(toEnvFileContent({ A: '1', B: undefined, C: '' })).toBe('A=1\nC=\n');
    });
  });
});
