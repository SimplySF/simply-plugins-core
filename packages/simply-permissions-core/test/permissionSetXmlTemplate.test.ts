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

import { describe, it, expect } from 'vitest';
import { buildPermissionSetXml, type PermissionSetTemplateData } from '../src/permissionSetXmlTemplate.js';

const baseData: PermissionSetTemplateData = {
  label: 'My Permission Set',
  hasActivationRequired: false,
  objectPermissions: [],
  fieldPermissions: [],
  tabSettings: [],
  recordTypeVisibilities: [],
  userPermissions: [],
};

describe('buildPermissionSetXml', () => {
  it('renders label and hasActivationRequired', () => {
    const xml = buildPermissionSetXml(baseData);

    expect(xml).toContain('<label>My Permission Set</label>');
    expect(xml).toContain('<hasActivationRequired>false</hasActivationRequired>');
  });

  it('renders an optional description when provided', () => {
    const xml = buildPermissionSetXml({ ...baseData, description: 'A description' });

    expect(xml).toContain('<description>A description</description>');
  });

  it('omits description entirely when not provided', () => {
    const xml = buildPermissionSetXml(baseData);

    expect(xml).not.toContain('<description>');
  });

  it('renders object permissions with all boolean fields coerced to strings', () => {
    const xml = buildPermissionSetXml({
      ...baseData,
      objectPermissions: [
        {
          object: 'Account',
          allowCreate: true,
          allowDelete: false,
          allowEdit: true,
          allowRead: true,
          modifyAllRecords: false,
          viewAllRecords: true,
          viewAllFields: false,
        },
      ],
    });

    expect(xml).toContain('<object>Account</object>');
    expect(xml).toContain('<allowCreate>true</allowCreate>');
    expect(xml).toContain('<allowDelete>false</allowDelete>');
  });

  it('renders field permissions', () => {
    const xml = buildPermissionSetXml({
      ...baseData,
      fieldPermissions: [{ field: 'Account.CustomField__c', readable: true, editable: false }],
    });

    expect(xml).toContain('<field>Account.CustomField__c</field>');
    expect(xml).toContain('<readable>true</readable>');
    expect(xml).toContain('<editable>false</editable>');
  });

  it('writes each tab setting visibility as given', () => {
    const xml = buildPermissionSetXml({
      ...baseData,
      tabSettings: [
        { tab: 'Account', visibility: 'Visible' },
        { tab: 'Contact', visibility: 'Available' },
        { tab: 'Lead', visibility: 'None' },
      ],
    });

    expect(xml).toMatch(/<tab>Account<\/tab>\s*<visibility>Visible<\/visibility>/);
    expect(xml).toMatch(/<tab>Contact<\/tab>\s*<visibility>Available<\/visibility>/);
    expect(xml).toMatch(/<tab>Lead<\/tab>\s*<visibility>None<\/visibility>/);
    expect(xml).not.toContain('Hidden');
  });

  it('renders record type visibilities', () => {
    const xml = buildPermissionSetXml({
      ...baseData,
      recordTypeVisibilities: [{ recordType: 'Account.Business', visible: true }],
    });

    expect(xml).toContain('<recordType>Account.Business</recordType>');
    expect(xml).toContain('<visible>true</visible>');
  });

  it('renders user permissions', () => {
    const xml = buildPermissionSetXml({
      ...baseData,
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
    });

    expect(xml).toContain('<name>ApiEnabled</name>');
    expect(xml).toContain('<enabled>true</enabled>');
  });

  it('escapes unsafe XML text content', () => {
    const xml = buildPermissionSetXml({ ...baseData, label: 'A & B < C' });

    expect(xml).toContain('<label>A &amp; B &lt; C</label>');
  });
});
