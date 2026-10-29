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

function split(objects: ObjectItem[], options: ErdOptions = { maxObjects: 2 }) {
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

  it('skips empty or whitespace referenceTo in string and array forms', () => {
    const model = buildEntityRelationshipModel([
      {
        name: 'Child',
        customFields: [
          lookup('Blank__c', ''),
          lookup('Spaces__c', '   '),
          lookup('Arr__c', ['', ' ']),
          lookup('Mixed__c', [' Parent ', '']),
        ],
      },
    ]);
    expect(model.skippedFields).toEqual(['Child.Arr__c', 'Child.Blank__c', 'Child.Spaces__c']);
    expect(model.entities.map((entity) => entity.name)).toEqual(['Child', 'Parent']);
    expect(model.relationships.map((edge) => [edge.parent, edge.field])).toEqual([['Parent', 'Mixed__c']]);
  });

  it('dedupes duplicate objects by parent, child, and field, keeping the first sorted', () => {
    const model = buildEntityRelationshipModel([
      { name: 'Child', customFields: [lookup('F__c', 'Parent', 'true')] },
      { name: 'Child', customFields: [lookup('F__c', 'Parent')] },
    ]);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0].required).toBe(false);
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

  it('uses an inclusive threshold counting only in-project objects, not externals or unrelated ones', () => {
    const result = split([...clusters, { name: 'Unrelated' }], { maxObjects: 4, title: 'All' });
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0]).toMatchObject({ name: 'All', oversized: false });
    expect(result.diagrams[0].entities).toHaveLength(5);
    expect(split(clusters, { maxObjects: 3 }).diagrams).toHaveLength(2);
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

  it('groups satellites connected only to hubs into one diagram per hub', () => {
    const objects = [
      { name: 'A', customFields: [lookup('Owner', 'User'), lookup('Reviewer', 'User')] },
      { name: 'B', customFields: [lookup('Owner', 'User')] },
      { name: 'C', customFields: [lookup('Owner', 'User')] },
    ];
    const { diagrams, unrelatedObjects, markdown } = buildEntityRelationshipDiagramMarkdown(objects, { maxObjects: 2 });
    expect(
      diagrams.map(({ name, entities, relationships, oversized }) => ({
        name,
        names: entities.map((entity) => entity.name),
        fields: relationships.map((edge) => `${edge.child}.${edge.field}`),
        oversized,
      })),
    ).toEqual([
      {
        name: 'A',
        names: ['A', 'B', 'C', 'User'],
        fields: ['A.Owner', 'A.Reviewer', 'B.Owner', 'C.Owner'],
        oversized: true,
      },
    ]);
    expect(unrelatedObjects).toEqual([]);
    expect(markdown).toContain('User |o..o{ C : "Owner"');
  });

  it('puts a satellite of several hubs in its first hub group and keeps its other hub edges', () => {
    const objects = [
      { name: 'A', customFields: [lookup('Owner', 'User'), lookup('Acct', 'Account')] },
      { name: 'B', customFields: [lookup('Acct', 'Account')] },
      ...clusters,
    ];
    const { diagrams } = split(objects, { maxObjects: 2, hubs: ['User', 'Account'] });
    const group = diagrams.find((diagram) => diagram.relationships.some((edge) => edge.child === 'B'));
    expect(group?.relationships.map((edge) => `${edge.child}.${edge.field}`)).toEqual([
      'A.Acct',
      'B.Acct',
      'A.Owner',
    ]);
    expect(diagrams.filter((diagram) => diagram.relationships.some((edge) => edge.child === 'A'))).toHaveLength(1);
  });

  it('never picks a hub as anchor while an in-project non-hub exists', () => {
    const objects = [
      ...clusters,
      { name: 'User', customFields: [lookup('A__c', 'Z_Ext'), lookup('B__c', 'Z_Ext'), lookup('C__c', 'Z_Ext')] },
    ];
    const names = split(objects).diagrams.map((diagram) => diagram.name);
    expect(names).not.toContain('User');
    expect(names).toEqual(['Case__c', 'Invoice__c', 'Z_Ext']);
  });

  it('places hub-only edges that no other diagram contains, and every relationship appears somewhere', () => {
    const objects: ObjectItem[] = [
      ...clusters,
      { name: 'Sat__c', customFields: [lookup('Owner', 'User')] },
      {
        name: 'User',
        customFields: [{ fullName: 'Manager__c', type: 'Hierarchy' }, lookup('Org__c', 'Org')],
      },
      { name: 'Org', customFields: [lookup('Parent__c', 'Parent_Org')] },
      { name: 'Parent_Org' },
      { name: 'Lone_Hub_Child', customFields: [{ fullName: 'Self', type: 'Hierarchy' }] },
    ];
    for (const hubs of [['User'], ['User', 'Org'], ['User', 'Org', 'Parent_Org'], ['Lone_Hub_Child']]) {
      const result = buildEntityRelationshipDiagramMarkdown(objects, { maxObjects: 2, hubs });
      const included = new Set(result.diagrams.flatMap((diagram) => diagram.relationships));
      for (const edge of result.model.relationships) expect(included.has(edge)).toBe(true);
    }
    const only: ObjectItem[] = [
      ...clusters,
      { name: 'User', customFields: [{ fullName: 'Manager__c', type: 'Hierarchy' }] },
      { name: 'Org', customFields: [lookup('Owner__c', 'Org2')] },
      { name: 'Org2', customFields: [lookup('X__c', 'User2')] },
    ];
    const { diagrams } = split(only, { maxObjects: 2, hubs: ['Org', 'Org2', 'User2'] });
    expect(diagrams.some((diagram) => diagram.relationships.some((edge) => edge.field === 'Owner__c'))).toBe(true);
    const hubOnly = split(
      [...clusters, { name: 'User', customFields: [{ fullName: 'Manager__c', type: 'Hierarchy' }] }],
      { maxObjects: 3, hubs: ['User'] },
    );
    expect(hubOnly.diagrams.flatMap((diagram) => diagram.relationships.map((edge) => edge.field))).toContain(
      'Manager__c',
    );
  });

  it('emits a diagram for hub-only edges when no diagram contains the hubs', () => {
    const objects: ObjectItem[] = [
      { name: 'P', customFields: [lookup('Q__c', 'Q')] },
      { name: 'Q', customFields: [lookup('R__c', 'R')] },
      { name: 'Hub1', customFields: [lookup('Hub2__c', 'Hub2'), { fullName: 'Self__c', type: 'Hierarchy' }] },
      { name: 'Hub2' },
    ];
    const { diagrams, unrelatedObjects } = split(objects, { maxObjects: 2, hubs: ['Hub1', 'Hub2'] });
    expect(unrelatedObjects).toEqual([]);
    expect(diagrams.map((diagram) => [diagram.name, diagram.relationships.length])).toEqual([
      ['Hub1', 2],
      ['Q', 2],
    ]);
  });

  it('preserves hub-only objects alongside clusters, including external non-hub endpoints', () => {
    const objects: ObjectItem[] = [
      ...clusters,
      { name: 'Solo__c', customFields: [lookup('Owner', 'User')] },
      { name: 'User', customFields: [lookup('External', 'Outside'), { fullName: 'Manager', type: 'Hierarchy' }] },
      { name: 'Unrelated' },
    ];
    const result = buildEntityRelationshipDiagramMarkdown(objects, { maxObjects: 2 });
    expect(result.diagrams).toHaveLength(3);
    expect(result.unrelatedObjects).toEqual(['Unrelated']);
    expect(result.diagrams.flatMap((diagram) => diagram.relationships)).toEqual(
      expect.arrayContaining(result.model.relationships),
    );
    expect(result.markdown).toContain('User |o..o{ Solo__c : "Owner"');
    expect(result.markdown).toContain('Outside |o..o{ User : "External"');
    expect(buildEntityRelationshipDiagramMarkdown([...objects].reverse(), { maxObjects: 2 })).toEqual(result);
  });

  it('falls back to a hub, then the first entity name, when a diagram has no other candidates', () => {
    const entities: ErdEntity[] = [
      { name: 'P', external: false },
      { name: 'Q', external: false },
      { name: 'R', external: false },
      { name: 'B', external: true },
      { name: 'A', external: true },
    ];
    const kind: ErdRelationshipKind = 'Lookup';
    const edge = (parent: string, child: string): ErdRelationship => ({
      parent,
      child,
      field: `${parent}__c`,
      kind,
      required: false,
    });
    const model: EntityRelationshipModel = {
      entities,
      relationships: [edge('A', 'B'), edge('P', 'Q'), edge('Q', 'R')],
      skippedFields: [],
    };
    const diagram: ErdDiagram = splitEntityRelationshipModel(model, { maxObjects: 2, hubs: ['A', 'B'] }).diagrams[1];
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
      markdown: '# Data model\n\nNo objects found.\n',
      diagrams: [],
      unrelatedObjects: [],
    });
    const result = buildEntityRelationshipDiagramMarkdown([{ name: 'Unrelated' }]);
    expect(result.diagrams).toEqual([]);
    expect(result.markdown).toContain('## Objects with no relationships\n\nUnrelated\n');
    expect(result.markdown).not.toContain('```mermaid');
  });

  it('uses a bare H1 without a title and omits the intro when nothing is related', () => {
    expect(buildEntityRelationshipDiagramMarkdown([{ name: 'Unrelated' }]).markdown).toBe(
      '# Data model\n\n## Objects with no relationships\n\nUnrelated\n',
    );
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
