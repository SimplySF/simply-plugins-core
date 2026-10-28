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
import { parseBooleanString, resolveBoolean, resolveOptionalString, resolveString } from '../../src/flags/env.js';

describe('parseBooleanString', () => {
  it('passes a real boolean through', () => {
    expect(parseBooleanString(true)).to.equal(true);
    expect(parseBooleanString(false)).to.equal(false);
  });

  it('recognises true/false regardless of case or surrounding whitespace', () => {
    expect(parseBooleanString('TRUE')).to.equal(true);
    expect(parseBooleanString('  true  ')).to.equal(true);
    expect(parseBooleanString('False')).to.equal(false);
  });

  it('treats anything else as false', () => {
    expect(parseBooleanString('1')).to.equal(false);
    expect(parseBooleanString('yes')).to.equal(false);
    expect(parseBooleanString('')).to.equal(false);
  });
});

describe('resolveString', () => {
  it('prefers the flag over every environment variable', () => {
    expect(resolveString('flag', ['env-a', 'env-b'], 'fallback')).to.equal('flag');
  });

  it('falls back to the first defined environment variable, in order', () => {
    expect(resolveString(undefined, [undefined, 'env-b', 'env-c'], 'fallback')).to.equal('env-b');
  });

  it('uses the fallback when nothing else is set', () => {
    expect(resolveString(undefined, [undefined, undefined], 'fallback')).to.equal('fallback');
  });

  it('defaults the fallback to an empty string', () => {
    expect(resolveString(undefined, [])).to.equal('');
  });

  it('keeps an empty-string environment value rather than skipping to the next', () => {
    expect(resolveString(undefined, ['', 'env-b'], 'fallback')).to.equal('');
  });
});

describe('resolveOptionalString', () => {
  it('returns undefined when nothing supplies a value', () => {
    expect(resolveOptionalString(undefined, [undefined])).to.equal(undefined);
  });

  it('prefers the flag, then the first defined environment variable', () => {
    expect(resolveOptionalString('flag', ['env'])).to.equal('flag');
    expect(resolveOptionalString(undefined, [undefined, 'env'])).to.equal('env');
  });
});

describe('resolveBoolean', () => {
  it('prefers the flag over the environment variable', () => {
    expect(resolveBoolean(true, 'false', false)).to.equal(true);
  });

  it('lets an explicit false flag beat a true environment variable', () => {
    expect(resolveBoolean(false, 'true', true)).to.equal(false);
  });

  it('coerces the environment variable when no flag was given', () => {
    expect(resolveBoolean(undefined, 'true', false)).to.equal(true);
    expect(resolveBoolean(undefined, 'nonsense', true)).to.equal(false);
  });

  it('uses the fallback when neither flag nor environment variable is set', () => {
    expect(resolveBoolean(undefined, undefined, true)).to.equal(true);
    expect(resolveBoolean(undefined, undefined, false)).to.equal(false);
  });
});
