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

import fs from 'node:fs';
import path from 'node:path';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'xmlns="http://soap.sforce.com/2006/04/metadata"';

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${XML_HEADER}\n${contents}\n`);
}

function field(fullName: string, body: string): string {
  return `<CustomField ${NS}>\n    <fullName>${fullName}</fullName>\n    <label>${fullName}</label>\n${body}\n</CustomField>`;
}

/**
 * Writes a small source-format project under `root/main/default` containing:
 * - `Widget__c` with a text field, a required field, a master-detail field, and a record type
 * - a `Widget__c` custom tab
 * - a standalone `Account.Rating__c` field (no `Account.object-meta.xml`)
 *
 * @param root - The directory to write into.
 */
export function writeFixtureProject(root: string): void {
  const base = path.join(root, 'main', 'default');
  const widget = path.join(base, 'objects', 'Widget__c');

  write(
    path.join(widget, 'Widget__c.object-meta.xml'),
    `<CustomObject ${NS}>\n    <label>Widget</label>\n    <pluralLabel>Widgets</pluralLabel>\n    <nameField>\n        <label>Name</label>\n        <type>Text</type>\n    </nameField>\n    <deploymentStatus>Deployed</deploymentStatus>\n    <sharingModel>ReadWrite</sharingModel>\n</CustomObject>`,
  );
  write(
    path.join(widget, 'fields', 'Color__c.field-meta.xml'),
    field('Color__c', '    <type>Text</type>\n    <length>40</length>\n    <required>false</required>'),
  );
  write(
    path.join(widget, 'fields', 'Serial__c.field-meta.xml'),
    field('Serial__c', '    <type>Text</type>\n    <length>40</length>\n    <required>true</required>'),
  );
  write(
    path.join(widget, 'fields', 'Account__c.field-meta.xml'),
    field(
      'Account__c',
      '    <type>MasterDetail</type>\n    <referenceTo>Account</referenceTo>\n    <relationshipName>Widgets</relationshipName>',
    ),
  );
  write(
    path.join(widget, 'recordTypes', 'Standard.recordType-meta.xml'),
    `<RecordType ${NS}>\n    <fullName>Standard</fullName>\n    <active>true</active>\n    <label>Standard</label>\n</RecordType>`,
  );
  write(
    path.join(base, 'tabs', 'Widget__c.tab-meta.xml'),
    `<CustomTab ${NS}>\n    <customObject>true</customObject>\n    <motif>Custom20: Airplane</motif>\n</CustomTab>`,
  );
  write(
    path.join(base, 'objects', 'Account', 'fields', 'Rating__c.field-meta.xml'),
    field('Rating__c', '    <type>Number</type>\n    <precision>3</precision>\n    <scale>0</scale>'),
  );
}
