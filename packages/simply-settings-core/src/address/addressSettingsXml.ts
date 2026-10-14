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
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { StateDefinition } from './stateDefinitions.js';

export type AddressSettingsState = {
  isoCode: string;
  label: string;
  active: boolean;
  visible: boolean;
};

export type AddressSettingsCountry = {
  isoCode: string;
  label: string;
  active: boolean;
  visible: boolean;
  states: AddressSettingsState[];
};

/** The parts of an org's `AddressSettings` this package reads. */
export type AddressSettings = {
  countries: AddressSettingsCountry[];
};

export type StateActivationPlan = {
  /**
   * The settings XML with every `activated` state set active and visible, or `undefined` when
   * `activated` is empty — there is nothing to deploy.
   */
  xml?: string;
  /** Definitions whose state was inactive or hidden and is now set active and visible. */
  activated: StateDefinition[];
  /** Definitions whose state was already active and visible. */
  alreadyActive: StateDefinition[];
  /** Definitions with no matching state in the org (not created yet, or the country is absent). */
  notInOrg: StateDefinition[];
};

type RawNode = Record<string, unknown>;

type RawAddressSettingsXml = {
  AddressSettings?: {
    countriesAndStates?: {
      countries?: RawNode[];
    };
  };
};

const COUNTRIES_PATH = 'AddressSettings.countriesAndStates.countries';
const STATES_PATH = `${COUNTRIES_PATH}.states`;

// `parseTagValue: false` matters: ISO codes like `02` (Andorra's Canillo) must stay strings, and the
// XML is written back verbatim by `planStateActivation`, so no value may be coerced on the way in.
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (_tagName: string, jPath: unknown): boolean => jPath === COUNTRIES_PATH || jPath === STATES_PATH,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  indentBy: '    ',
});

// The Metadata API's `State` element sequence. Only consulted when a retrieved state lacks
// `<active>`/`<visible>` entirely, so the added element lands where the schema expects it.
const STATE_FIELD_ORDER = ['active', 'integrationValue', 'isoCode', 'label', 'standard', 'visible'];

function countriesOf(parsed: RawAddressSettingsXml): RawNode[] {
  if (!parsed.AddressSettings) {
    throw new SfError('The retrieved file is not AddressSettings metadata.', 'InvalidAddressSettingsError');
  }

  const countries = parsed.AddressSettings.countriesAndStates?.countries ?? [];
  if (countries.length === 0) {
    throw new SfError(
      'The org has no countries in its AddressSettings. Enable State and Country/Territory Picklists in Setup first.',
      'StateCountryPicklistsNotEnabledError',
    );
  }

  return countries;
}

function text(node: RawNode, key: string): string {
  const value = node[key];
  return typeof value === 'string' ? value : '';
}

function flag(node: RawNode, key: string): boolean {
  return text(node, key) === 'true';
}

function rawStates(country: RawNode): RawNode[] {
  return (country.states as RawNode[] | undefined) ?? [];
}

/**
 * Reads the countries and states out of an `Address.settings-meta.xml` document.
 *
 * @param xml - The settings file's text, as retrieved.
 * @returns Every country with its states, in document order.
 * @throws SfError when the document isn't AddressSettings or has no countries (State and
 * Country/Territory Picklists not enabled).
 */
export function parseAddressSettingsXml(xml: string): AddressSettings {
  return {
    countries: countriesOf(parser.parse(xml) as RawAddressSettingsXml).map((country) => ({
      isoCode: text(country, 'isoCode'),
      label: text(country, 'label'),
      active: flag(country, 'active'),
      visible: flag(country, 'visible'),
      states: rawStates(country).map((state) => ({
        isoCode: text(state, 'isoCode'),
        label: text(state, 'label'),
        active: flag(state, 'active'),
        visible: flag(state, 'visible'),
      })),
    })),
  };
}

function withFlagsSet(state: RawNode): RawNode {
  if ('active' in state && 'visible' in state) {
    return { ...state, active: 'true', visible: 'true' };
  }

  const merged: RawNode = { ...state, active: 'true', visible: 'true' };
  const ordered: RawNode = {};
  for (const key of STATE_FIELD_ORDER) {
    if (key in merged) ordered[key] = merged[key];
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

/**
 * Sets `<active>` and `<visible>` to `true` on exactly the states named by `definitions`, leaving
 * every other state and every country untouched.
 *
 * @param xml - The settings file's text, as retrieved from the same org it will be deployed to.
 * @param definitions - The states to activate.
 * @returns The rewritten XML (only when something changed) and how each definition was handled.
 */
export function planStateActivation(xml: string, definitions: StateDefinition[]): StateActivationPlan {
  const parsed = parser.parse(xml) as RawAddressSettingsXml;
  const countries = countriesOf(parsed);
  const countriesByCode = new Map(countries.map((country) => [text(country, 'isoCode').toUpperCase(), country]));

  const plan: StateActivationPlan = { activated: [], alreadyActive: [], notInOrg: [] };

  for (const definition of definitions) {
    const country = countriesByCode.get(definition.country);
    const states = country ? rawStates(country) : [];
    const index = states.findIndex((state) => text(state, 'isoCode').toUpperCase() === definition.code);

    if (!country || index === -1) {
      plan.notInOrg.push(definition);
    } else if (flag(states[index], 'active') && flag(states[index], 'visible')) {
      plan.alreadyActive.push(definition);
    } else {
      states[index] = withFlagsSet(states[index]);
      plan.activated.push(definition);
    }
  }

  if (plan.activated.length > 0) {
    plan.xml = builder.build(parsed);
  }

  return plan;
}
