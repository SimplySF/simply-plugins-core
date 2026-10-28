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

import { afterEach, describe, expect, it } from 'vitest';
import { getSkipReason } from '../../src/build/skipGuard.js';

describe('getSkipReason', () => {
  const originalPackageChanged = process.env.PACKAGE_CHANGED;

  afterEach(() => {
    process.env.PACKAGE_CHANGED = originalPackageChanged;
  });

  it('should skip build/scratch-related jobs if PACKAGE_CHANGED is FALSE', () => {
    process.env.PACKAGE_CHANGED = 'FALSE';
    expect(getSkipReason('create-scratch')).toContain(
      'No package changes detected (PACKAGE_CHANGED=FALSE). Skipping job: create-scratch',
    );
  });

  it.each([
    'create-scratch',
    'install-dependencies',
    'push-scratch',
    'test-scratch',
    'delete-scratch',
    'create-package-version',
    'publish-utam-page-objects',
  ])('should skip %s if PACKAGE_CHANGED is FALSE', (job) => {
    process.env.PACKAGE_CHANGED = 'FALSE';
    expect(getSkipReason(job)).toBeDefined();
  });

  it('should skip create-fallback-tag if PACKAGE_CHANGED is TRUE', () => {
    process.env.PACKAGE_CHANGED = 'TRUE';
    expect(getSkipReason('create-fallback-tag')).toContain(
      'Package changes detected (PACKAGE_CHANGED=TRUE). Skipping fallback tag creation.',
    );
  });

  it('should not skip create-fallback-tag if PACKAGE_CHANGED is FALSE', () => {
    process.env.PACKAGE_CHANGED = 'FALSE';
    expect(getSkipReason('create-fallback-tag')).toBeUndefined();
  });

  it('should not skip a gated job if PACKAGE_CHANGED is TRUE', () => {
    process.env.PACKAGE_CHANGED = 'TRUE';
    expect(getSkipReason('create-scratch')).toBeUndefined();
  });

  it('should not skip a gated job if PACKAGE_CHANGED is unset', () => {
    delete process.env.PACKAGE_CHANGED;
    expect(getSkipReason('create-scratch')).toBeUndefined();
  });

  it('should never skip jobs outside the gated set', () => {
    process.env.PACKAGE_CHANGED = 'FALSE';
    expect(getSkipReason('cleanup-scratch-orgs')).toBeUndefined();
    expect(getSkipReason('lwc-jest')).toBeUndefined();
    expect(getSkipReason('determine-package-changes')).toBeUndefined();
  });
});
