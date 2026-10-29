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
import {
  buildEntityRelationshipModel,
  splitEntityRelationshipModel,
  renderMermaidErDiagram,
  buildEntityRelationshipDiagramMarkdown,
  type ObjectItem,
  type CustomFieldItem,
  type ErdDiagram,
  type ErdEntity,
  type ErdRelationship,
  type ErdRelationshipKind,
  type ErdOptions,
  type EntityRelationshipModel,
} from '../src/index.js';

function lookup(fullName: string, referenceTo?: string | string[], required?: string): CustomFieldItem {
  return { fullName, type: 'Lookup', referenceTo, required };
}

const clusters: ObjectItem[] = [
  { name: 'Invoice__c', customFields: [lookup('Approver__c', 'User')] },
  {
    name: 'Invoice_Line__c',
    customFields: [{ fullName: 'Invoice__c', type: 'MasterDetail', referenceTo: 'Invoice__c' }],
  },
  { name: 'Case__c', customFields: [lookup('Reviewer__c', 'User')] },
  { name: 'Case_Note__c', customFields: [lookup('Case__c', 'Case__c')] },
];

function split(objects: ObjectItem[], options: ErdOptions = { maxObjects: 4 }) {
  return splitEntityRelationshipModel(buildEntityRelationshipModel(objects), options);
}

describe('buildEntityRelationshipModel', () => {
  it('uses raw metadata types, strips object prefixes, and reports missing targets in order', () => {
    const model = buildEntityRelationshipModel([
      {
        name: 'Invoice__c',
        label: 'Invoice',
        customFields: [
          lookup('Invoice__c.Z__c'),
          lookup('A__c', []),
          lookup('Raw__c', 'Account'),
          { fullName: 'Display__c', type: 'Lookup(Account)' },
          { fullName: 'Typed__c', type: 'Lookup(Account)', fieldType: 'Lookup', referenceTo: 'Account' },
          { fullName: 'Ignored__c', type: 'Lookup', fieldType: 'Text', referenceTo: 'Account' },
          { fullName: 'External__c', type: 'ExternalLookup', referenceTo: 'Outside__x' },
          { fullName: 'Metadata__c', type: 'MetadataRelationship', referenceTo: 'Type__mdt' },
          { fullName: 'Other__c', type: 'Text' },
        ],
      },
    ]);
    expect(model.entities).toEqual([
      { name: 'Account', external: true },
      { name: 'Invoice__c', label: 'Invoice', external: false },
    ]);
    expect(model.relationships.map((edge) => edge.field)).toEqual(['Raw__c', 'Typed__c']);
    expect(model.skippedFields).toEqual(['Invoice__c.A__c', 'Invoice__c.Z__c']);
  });

  it('keeps multiple fields per pair and expands polymorphic referenceTo', () => {
    const model = buildEntityRelationshipModel([
      { name: 'Contact', customFields: [lookup('First__c', ['Account', 'User']), lookup('Second__c', 'Account')] },
      { name: 'Account' },
    ]);
    expect(model.relationships.map(({ parent, field }) => [parent, field])).toEqual([
      ['Account', 'First__c'],
      ['Account', 'Second__c'],
      ['User', 'First__c'],
    ]);
    expect(model.entities.find((entity) => entity.name === 'Account')?.external).toBe(false);
  });

  it('accepts boolean required from external callers and forces MasterDetail required', () => {
    const model = buildEntityRelationshipModel([
      {
        name: 'Child',
        customFields: [
          { ...lookup('Boolean__c', 'Parent'), required: true } as unknown as CustomFieldItem,
          { fullName: 'Master__c', type: 'MasterDetail', referenceTo: 'Parent', required: 'false' },
          lookup('False__c', 'Parent', 'false'),
        ],
      },
    ]);
    expect(model.relationships.map(({ field, required }) => [field, required])).toEqual([
      ['Boolean__c', true],
      ['False__c', false],
      ['Master__c', true],
    ]);
  });
});

describe('renderMermaidErDiagram', () => {
  it('renders all cardinalities, sorted and quoted, without a trailing newline', () => {
    const objects: ObjectItem[] = [
      {
        name: 'Child',
        customFields: [
          lookup('Required__c', 'Parent', 'true'),
          lookup('Optional__c', 'Parent'),
          { fullName: 'Master__c', type: 'MasterDetail', referenceTo: 'Parent' },
        ],
      },
      { name: 'User', customFields: [{ fullName: 'Manager__c', type: 'Hierarchy' }] },
    ];
    const { diagrams } = split(objects, {});
    expect(renderMermaidErDiagram({ ...diagrams[0], relationships: [...diagrams[0].relationships].reverse() })).toBe(
      'erDiagram\n' +
        '  Parent ||--o{ Child : "Master__c"\n' +
        '  Parent |o..o{ Child : "Optional__c"\n' +
        '  Parent ||..o{ Child : "Required__c"\n' +
        '  User |o..o{ User : "Manager__c"',
    );
    expect(buildEntityRelationshipModel(objects).relationships.at(-1)).toMatchObject({
      parent: 'User',
      child: 'User',
      required: false,
    });
  });
});

describe('splitEntityRelationshipModel', () => {
  it('lists unrelated project objects separately and ignores unrelated external entities', () => {
    const model = buildEntityRelationshipModel([...clusters, { name: 'Z__c' }, { name: 'A__c' }]);
    model.entities.push({ name: 'External', external: true });
    const result = splitEntityRelationshipModel(model);
    expect(result.unrelatedObjects).toEqual(['A__c', 'Z__c']);
    expect(result.diagrams[0].entities).toHaveLength(5);
  });

  it('uses an inclusive threshold counting external nodes and excluding unrelated objects', () => {
    const result = split([...clusters, { name: 'Unrelated' }], { maxObjects: 5, title: 'All' });
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0]).toMatchObject({ name: 'All', oversized: false });
  });

  it('splits clusters joined only through User and uses ordinal anchors for ties', () => {
    const { diagrams } = split(clusters);
    expect(
      diagrams.map(({ name, entities, oversized }) => [name, entities.map((entity) => entity.name), oversized]),
    ).toEqual([
      ['Case__c', ['Case_Note__c', 'Case__c', 'User'], false],
      ['Invoice__c', ['Invoice_Line__c', 'Invoice__c', 'User'], false],
    ]);
    const tie = split([{ name: 'a', customFields: [lookup('Z__c', 'Z')] }, { name: 'Z' }], { maxObjects: 1 });
    expect(tie.diagrams[0]).toMatchObject({ name: 'Z', oversized: true });
  });

  it('allows no hubs and marks an oversized component', () => {
    const { diagrams } = split(clusters, { maxObjects: 3, hubs: [] });
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]).toMatchObject({ name: 'Case__c', oversized: true });
  });

  it('counts only in-project nodes for oversized after splitting', () => {
    expect(split(clusters, { maxObjects: 2 }).diagrams.every((diagram) => !diagram.oversized)).toBe(true);
  });

  it('orders by project count before anchor and ignores absent hubs', () => {
    const objects = [...clusters, { name: 'Extra', customFields: [lookup('Invoice__c', 'Invoice__c')] }];
    const options = { maxObjects: 4, hubs: ['User', 'Missing'] };
    expect(split(objects, options).diagrams.map((diagram) => diagram.name)).toEqual(['Invoice__c', 'Case__c']);
  });

  it('attaches hub-to-hub edges to every diagram already containing either hub', () => {
    const objects = [
      ...clusters,
      { name: 'User', customFields: [{ fullName: 'Manager__c', type: 'Hierarchy' }, lookup('Account__c', 'Account')] },
    ];
    const { diagrams } = split(objects, { maxObjects: 4, hubs: ['User', 'Account'] });
    expect(diagrams).toHaveLength(2);
    for (const diagram of diagrams) {
      expect(diagram.relationships).toHaveLength(4);
      expect(diagram.entities.map((entity) => entity.name)).toContain('Account');
      expect(diagram.relationships.filter((edge) => edge.child === 'User')).toHaveLength(2);
    }
  });

  it('seeds separate diagrams for objects connected only to hubs', () => {
    const objects = [
      { name: 'A', customFields: [lookup('Owner', 'User'), lookup('Reviewer', 'User')] },
      { name: 'B', customFields: [lookup('Owner', 'User')] },
    ];
    const { diagrams, unrelatedObjects, markdown } = buildEntityRelationshipDiagramMarkdown(objects, { maxObjects: 2 });
    expect(
      diagrams.map(({ name, entities, relationships, oversized }) => ({
        name,
        names: entities.map((entity) => entity.name),
        fields: relationships.map((edge) => edge.field),
        oversized,
      })),
    ).toEqual([
      { name: 'A', names: ['A', 'User'], fields: ['Owner', 'Reviewer'], oversized: false },
      { name: 'B', names: ['B', 'User'], fields: ['Owner'], oversized: false },
    ]);
    expect(unrelatedObjects).toEqual([]);
    expect(markdown).toContain('User |o..o{ A : "Owner"');
    expect(markdown).toContain('User |o..o{ A : "Reviewer"');
    expect(markdown).toContain('User |o..o{ B : "Owner"');
  });

  it('preserves hub-only objects alongside clusters, including external non-hub endpoints', () => {
    const objects: ObjectItem[] = [
      ...clusters,
      { name: 'Solo__c', customFields: [lookup('Owner', 'User')] },
      { name: 'User', customFields: [lookup('External', 'Outside'), { fullName: 'Manager', type: 'Hierarchy' }] },
      { name: 'Unrelated' },
    ];
    const result = buildEntityRelationshipDiagramMarkdown(objects, { maxObjects: 2 });
    expect(result.diagrams).toHaveLength(4);
    expect(result.unrelatedObjects).toEqual(['Unrelated']);
    expect(result.diagrams.flatMap((diagram) => diagram.relationships)).toEqual(
      expect.arrayContaining(result.model.relationships),
    );
    expect(result.markdown).toContain('User |o..o{ Solo__c : "Owner"');
    expect(result.markdown).toContain('Outside |o..o{ User : "External"');
    expect(buildEntityRelationshipDiagramMarkdown([...objects].reverse(), { maxObjects: 2 })).toEqual(result);
  });

  it('falls back to the first entity name when a caller supplies only external nodes', () => {
    const entities: ErdEntity[] = [
      { name: 'B', external: true },
      { name: 'A', external: true },
    ];
    const kind: ErdRelationshipKind = 'Lookup';
    const edge: ErdRelationship = { parent: 'A', child: 'B', field: 'A__c', kind, required: false };
    const model: EntityRelationshipModel = { entities, relationships: [edge], skippedFields: [] };
    const diagram: ErdDiagram = splitEntityRelationshipModel(model, { maxObjects: 1 }).diagrams[0];
    expect(diagram).toMatchObject({ name: 'A', oversized: false });
  });
});

describe('buildEntityRelationshipDiagramMarkdown', () => {
  it('pins realistic Markdown including preamble, escaped lists/headings, and raw Mermaid', () => {
    const objects: ObjectItem[] = [
      { name: 'Invoice__c', customFields: [lookup('Billing_Account__c', 'ns__Account__c')] },
      { name: 'Audit_Log__c' },
    ];
    expect(buildEntityRelationshipDiagramMarkdown(objects, { title: 'force_app' }).markdown).toMatchInlineSnapshot(`
      "# Data model: force\\_app

      Generated by \`sf simply document erd\`. Paste each block into Gliffy via Create from code → Mermaid.
      Standard relationships (such as Contact → Account) aren't in DX source and aren't shown.

      ## 1. force\\_app (2 objects, 1 relationship)

      Referenced, not in this project: ns\\_\\_Account\\_\\_c

      \`\`\`mermaid
      erDiagram
        ns__Account__c |o..o{ Invoice__c : "Billing_Account__c"
      \`\`\`

      ## Objects with no relationships

      Audit\\_Log\\_\\_c
      "
    `);
  });

  it('uses singular counts and no external notice for a self relationship', () => {
    const { markdown } = buildEntityRelationshipDiagramMarkdown([
      { name: 'User', customFields: [{ fullName: 'Manager', type: 'Hierarchy' }] },
    ]);
    expect(markdown).toContain('## 1. Data model (1 object, 1 relationship)');
    expect(markdown).not.toContain('Referenced, not in this project');
  });

  it('handles empty input and projects with no edges', () => {
    expect(buildEntityRelationshipDiagramMarkdown([])).toMatchObject({
      markdown: '# Data model: Data model\n\nNo objects found.\n',
      diagrams: [],
      unrelatedObjects: [],
    });
    const result = buildEntityRelationshipDiagramMarkdown([{ name: 'Unrelated' }]);
    expect(result.diagrams).toEqual([]);
    expect(result.markdown).toContain('## Objects with no relationships\n\nUnrelated\n');
    expect(result.markdown).not.toContain('```mermaid');
  });

  it('is byte-identical under object, field, and target shuffling without mutating input', () => {
    const objects = [
      ...clusters,
      { name: 'Audit_Log__c' },
      {
        name: 'User',
        customFields: [lookup('MissingB__c'), lookup('MissingA__c'), lookup('Target__c', ['Account', 'Contact'])],
      },
    ];
    const original = structuredClone(objects);
    const shuffled = [...objects].reverse().map((object) => ({
      ...object,
      customFields: object.customFields
        ?.map((field) => ({
          ...field,
          referenceTo: Array.isArray(field.referenceTo) ? [...field.referenceTo].reverse() : field.referenceTo,
        }))
        .reverse(),
    }));
    for (const options of [{}, { maxObjects: 2 }]) {
      expect(buildEntityRelationshipDiagramMarkdown(shuffled, options)).toEqual(
        buildEntityRelationshipDiagramMarkdown(objects, options),
      );
    }
    expect(objects).toEqual(original);
  });
});
