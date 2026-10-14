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
import { parseAddressSettingsXml, planStateActivation } from '../../src/address/addressSettingsXml.js';
import { formatStateKey, parseStateDefinitions } from '../../src/address/stateDefinitions.js';
import { fixture } from './fixtures.js';

const xml = fixture('Address.settings-meta.xml');

describe('parseAddressSettingsXml', () => {
  it('reads countries and states, keeping codes as strings', () => {
    const settings = parseAddressSettingsXml(xml);

    expect(settings.countries.map((country) => country.isoCode)).toStrictEqual(['AD', 'US']);
    expect(settings.countries[0].states).toStrictEqual([
      { isoCode: '02', label: 'Canillo', active: false, visible: false },
    ]);
    expect(settings.countries[1].states.map((state) => [state.isoCode, state.active, state.visible])).toStrictEqual([
      ['CA', true, true],
      ['GU', false, false],
      ['PR', true, false],
    ]);
    expect(settings.countries[1].states[2].label).toBe('Puerto Rico & Islands');
  });

  it('treats a lone country and a lone state as one-element lists', () => {
    const single = xml.replace(/<countries>[\s\S]*?<\/countries>\s*(?=<countries>)/, '');
    const settings = parseAddressSettingsXml(single);

    expect(settings.countries).toHaveLength(1);
    expect(settings.countries[0].states).toHaveLength(3);
    expect(parseAddressSettingsXml(xml).countries[0].states).toHaveLength(1);
  });

  it('explains an org without State and Country/Territory Picklists', () => {
    expect(() =>
      parseAddressSettingsXml('<AddressSettings xmlns="http://soap.sforce.com/2006/04/metadata"></AddressSettings>'),
    ).toThrow(/Enable State and Country\/Territory Picklists/);
  });

  it('rejects a document that is not AddressSettings', () => {
    expect(() => parseAddressSettingsXml('<Package></Package>')).toThrow('not AddressSettings metadata');
  });
});

describe('planStateActivation', () => {
  it('activates only the listed states, and sorts the rest', () => {
    const plan = planStateActivation(
      xml,
      parseStateDefinitions({
        'US-GU': 'Guam',
        'US-PR': 'Puerto Rico',
        'US-CA': 'California',
        'US-ZZ': 'Nowhere',
        'FR-75': 'Paris',
      }),
    );

    expect(plan.activated.map(formatStateKey)).toStrictEqual(['US-GU', 'US-PR']);
    expect(plan.alreadyActive.map(formatStateKey)).toStrictEqual(['US-CA']);
    expect(plan.notInOrg.map(formatStateKey)).toStrictEqual(['US-ZZ', 'FR-75']);

    const flags = parseAddressSettingsXml(plan.xml!).countries.flatMap((country) =>
      country.states.map((state) => `${country.isoCode}-${state.isoCode}:${state.active}/${state.visible}`),
    );
    // AD-02 is inactive in the org but wasn't listed, so it's left alone.
    expect(flags).toStrictEqual(['AD-02:false/false', 'US-CA:true/true', 'US-GU:true/true', 'US-PR:true/true']);
  });

  it('writes the rest of the document back unchanged', () => {
    const plan = planStateActivation(xml, parseStateDefinitions({ 'US-GU': 'Guam' }));
    const expected = xml
      .replace(
        '<active>false</active>\n                <integrationValue>Guam',
        '<active>true</active>\n                <integrationValue>Guam',
      )
      .replace(/(<isoCode>GU<\/isoCode>[\s\S]*?)<visible>false<\/visible>/, '$1<visible>true</visible>');

    expect(plan.xml!.trim()).toBe(expected.trim());
  });

  it('adds missing flags in schema order', () => {
    const withoutActive = xml.replace(
      '<active>false</active>\n                <integrationValue>Guam',
      '<integrationValue>Guam',
    );
    const plan = planStateActivation(withoutActive, parseStateDefinitions({ 'US-GU': 'Guam' }));

    expect(plan.xml).toMatch(/<states>\s*<active>true<\/active>\s*<integrationValue>Guam<\/integrationValue>/);
  });

  it('returns no XML when there is nothing to change', () => {
    const plan = planStateActivation(xml, parseStateDefinitions({ 'US-CA': 'California', 'MX-JAL': 'Jalisco' }));

    expect(plan.xml).toBeUndefined();
    expect(plan.alreadyActive.map(formatStateKey)).toStrictEqual(['US-CA']);
    expect(plan.notInOrg.map(formatStateKey)).toStrictEqual(['MX-JAL']);
  });
});
