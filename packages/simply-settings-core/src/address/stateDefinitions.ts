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

import { SfError } from '@salesforce/core';

/** One state (ISO 3166-2 subdivision) to create or activate. */
export type StateDefinition = {
  /** ISO 3166-1 alpha-2 country code, e.g. `US`. */
  country: string;
  /** The subdivision code without its country prefix, e.g. `CA` for `US-CA`. */
  code: string;
  /** The state's label. Also used as its integration value. */
  name: string;
};

const STATE_KEY_PATTERN = /^([A-Z]{2})-([A-Z0-9]{1,3})$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

function invalid(message: string): SfError {
  return new SfError(message, 'InvalidStateDefinitionsError');
}

/**
 * Validates and normalizes state definitions given as a JSON object mapping `{Country}-{State}`
 * ISO 3166-2 codes to state names — e.g. `{ "US-CA": "California" }`, the same shape the
 * mattandneil/statecodes Visualforce page edits.
 *
 * @param json - The already-parsed JSON value.
 * @returns One definition per key, in the object's key order.
 * @throws SfError (`InvalidStateDefinitionsError`) naming the first invalid entry.
 */
export function parseStateDefinitions(json: unknown): StateDefinition[] {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw invalid(
      'State definitions must be a JSON object mapping "{Country}-{State}" codes to state names, e.g. {"US-CA": "California"}.',
    );
  }

  const definitions: StateDefinition[] = [];

  for (const [key, value] of Object.entries(json)) {
    const match = STATE_KEY_PATTERN.exec(key);
    if (!match) {
      throw invalid(
        `Invalid state key "${key}": expected a two-letter ISO country code, a hyphen, and a 1-3 character state code, e.g. "US-CA".`,
      );
    }

    if (typeof value !== 'string' || value.trim() === '') {
      throw invalid(`State "${key}" must have a non-empty name.`);
    }

    definitions.push({ country: match[1], code: match[2], name: value.trim() });
  }

  if (definitions.length === 0) {
    throw invalid('State definitions are empty.');
  }

  return definitions;
}

/**
 * Narrows definitions to the given countries.
 *
 * @param definitions - Definitions from {@link parseStateDefinitions}.
 * @param countries - ISO 3166-1 alpha-2 codes (case-insensitive). Empty or omitted keeps everything.
 * @returns The definitions whose country is in `countries`, in their original order.
 * @throws SfError (`InvalidStateDefinitionsError`) when a code is malformed or has no definitions —
 * a typo'd `--country` should fail loudly rather than quietly do nothing.
 */
export function filterStateDefinitions(definitions: StateDefinition[], countries?: string[]): StateDefinition[] {
  if (!countries || countries.length === 0) {
    return definitions;
  }

  const wanted = new Set<string>();
  for (const country of countries) {
    const normalized = country.trim().toUpperCase();
    if (!COUNTRY_CODE_PATTERN.test(normalized)) {
      throw invalid(`Invalid country code "${country}": expected a two-letter ISO 3166-1 code, e.g. "US".`);
    }
    wanted.add(normalized);
  }

  const present = new Set(definitions.map((definition) => definition.country));
  const missing = [...wanted].filter((country) => !present.has(country));
  if (missing.length > 0) {
    throw invalid(`No state definitions for ${missing.map((country) => `"${country}"`).join(', ')}.`);
  }

  return definitions.filter((definition) => wanted.has(definition.country));
}

/** `US-CA` for a definition. */
export function formatStateKey(definition: Pick<StateDefinition, 'country' | 'code'>): string {
  return `${definition.country}-${definition.code}`;
}
