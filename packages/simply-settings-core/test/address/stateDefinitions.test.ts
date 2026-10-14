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
import { filterStateDefinitions, formatStateKey, parseStateDefinitions } from '../../src/address/stateDefinitions.js';

describe('parseStateDefinitions', () => {
  it('splits each key into country and code, trimming names', () => {
    expect(
      parseStateDefinitions({ 'US-CA': 'California', 'AD-02': ' Canillo ', 'GB-ABE': 'Aberdeen City' }),
    ).toStrictEqual([
      { country: 'US', code: 'CA', name: 'California' },
      { country: 'AD', code: '02', name: 'Canillo' },
      { country: 'GB', code: 'ABE', name: 'Aberdeen City' },
    ]);
  });

  it.each([[null], [[]], ['US-CA'], [42]])('rejects %j as not an object', (json) => {
    expect(() => parseStateDefinitions(json)).toThrow(/must be a JSON object/);
  });

  it.each(['us-CA', 'USA-CA', 'US_CA', 'US-ABCD', 'US-'])('rejects the key %s, naming it', (key) => {
    expect(() => parseStateDefinitions({ [key]: 'Somewhere' })).toThrow(`Invalid state key "${key}"`);
  });

  it.each([[''], ['   '], [7]])('rejects the name %j', (name) => {
    expect(() => parseStateDefinitions({ 'US-CA': name })).toThrow('State "US-CA" must have a non-empty name.');
  });

  it('rejects an empty object', () => {
    expect(() => parseStateDefinitions({})).toThrow('State definitions are empty.');
  });
});

describe('filterStateDefinitions', () => {
  const definitions = parseStateDefinitions({ 'US-CA': 'California', 'CA-ON': 'Ontario', 'US-TX': 'Texas' });

  it('keeps everything without a filter', () => {
    expect(filterStateDefinitions(definitions)).toBe(definitions);
    expect(filterStateDefinitions(definitions, [])).toBe(definitions);
  });

  it('keeps only the given countries, case-insensitively, in original order', () => {
    expect(filterStateDefinitions(definitions, ['us']).map(formatStateKey)).toStrictEqual(['US-CA', 'US-TX']);
  });

  it('rejects a malformed country code', () => {
    expect(() => filterStateDefinitions(definitions, ['USA'])).toThrow('Invalid country code "USA"');
  });

  it('rejects a country with no definitions rather than returning nothing', () => {
    expect(() => filterStateDefinitions(definitions, ['US', 'MX', 'FR'])).toThrow(
      'No state definitions for "MX", "FR".',
    );
  });
});
