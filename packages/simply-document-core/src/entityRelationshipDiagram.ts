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

import type { ObjectItem } from './technicalDesignDocumentTemplate.js';

/** Supported raw Salesforce relationship field types. */
export type ErdRelationshipKind = 'MasterDetail' | 'Lookup' | 'Hierarchy';
/** An object node, including referenced objects outside the scanned project. */
export type ErdEntity = { name: string; label?: string; external: boolean };
/** A relationship field directed from its referenced parent to its owning child. */
export type ErdRelationship = {
  parent: string;
  child: string;
  field: string;
  kind: ErdRelationshipKind;
  required: boolean;
};
/** Sorted (by name; relationships by parent, child, field) entities, relationships, and fields skipped for missing referenceTo. */
export type EntityRelationshipModel = {
  entities: ErdEntity[];
  relationships: ErdRelationship[];
  skippedFields: string[];
};
/** A connected diagram; oversized counts in-project nodes after hub attachment. */
export type ErdDiagram = {
  name: string;
  entities: ErdEntity[];
  relationships: ErdRelationship[];
  oversized: boolean;
};
/** Defaults: 40 in-project objects (maxObjects counts connected in-project objects only), User as the sole hub, and no title. */
export type ErdOptions = { maxObjects?: number; hubs?: string[]; title?: string };

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRelationships(a: ErdRelationship, b: ErdRelationship): number {
  return (
    compareNames(a.parent, b.parent) ||
    compareNames(a.child, b.child) ||
    compareNames(a.field, b.field) ||
    compareNames(a.kind, b.kind) ||
    Number(a.required) - Number(b.required)
  );
}

/** Build a deterministic graph from raw relationship metadata, without parsing display types. */
export function buildEntityRelationshipModel(objects: ObjectItem[]): EntityRelationshipModel {
  const entities = new Map<string, ErdEntity>(
    objects.map((object) => [object.name, { name: object.name, label: object.label, external: false }]),
  );
  const relationships: ErdRelationship[] = [];
  const skippedFields: string[] = [];
  for (const object of objects) {
    for (const field of object.customFields ?? []) {
      const kind = field.fieldType ?? field.type;
      if (kind !== 'MasterDetail' && kind !== 'Lookup' && kind !== 'Hierarchy') continue;
      const name = field.fullName.slice(field.fullName.lastIndexOf('.') + 1);
      const targets = kind === 'Hierarchy' ? [object.name] : field.referenceTo;
      const parents = [...new Set([targets ?? []].flat().map((target) => (typeof target === 'string' ? target.trim() : '')))]
        .filter(Boolean)
        .sort(compareNames);
      if (parents.length === 0) skippedFields.push(`${object.name}.${name}`);
      for (const parent of parents) {
        if (!entities.has(parent)) entities.set(parent, { name: parent, external: true });
        relationships.push({
          parent,
          child: object.name,
          field: name,
          kind,
          required: kind === 'MasterDetail' || (kind === 'Lookup' && String(field.required) === 'true'),
        });
      }
    }
  }
  const seen = new Set<string>();
  return {
    entities: [...entities.values()].sort((a, b) => compareNames(a.name, b.name)),
    relationships: relationships.sort(compareRelationships).filter((edge) => {
      const key = JSON.stringify([edge.parent, edge.child, edge.field]);
      return !seen.has(key) && seen.add(key);
    }),
    skippedFields: [...new Set(skippedFields)].sort(compareNames),
  };
}

function endpointNames(relationships: ErdRelationship[]): Set<string> {
  return new Set(relationships.flatMap(({ parent, child }) => [parent, child]));
}

function connectedComponents(relationships: ErdRelationship[]): Array<Set<string>> {
  const roots = new Map<string, string>();
  const find = (name: string): string => {
    const parent = roots.get(name);
    if (parent === undefined) {
      roots.set(name, name);
      return name;
    }
    if (parent === name) return name;
    const root = find(parent);
    roots.set(name, root);
    return root;
  };
  for (const { parent, child } of relationships) roots.set(find(parent), find(child));
  const components = new Map<string, Set<string>>();
  for (const name of roots.keys()) {
    const root = find(name);
    const component = components.get(root) ?? new Set<string>();
    component.add(name);
    components.set(root, component);
  }
  return [...components.values()];
}

function inProjectCount(diagram: ErdDiagram): number {
  return diagram.entities.filter((entity) => !entity.external).length;
}

function anchorName(entities: ErdEntity[], relationships: ErdRelationship[], hubs: Set<string>): string {
  const degrees = new Map<string, number>();
  for (const edge of relationships) {
    for (const name of new Set([edge.parent, edge.child])) degrees.set(name, (degrees.get(name) ?? 0) + 1);
  }
  const tier = (entity: ErdEntity): number => (hubs.has(entity.name) ? 2 : entity.external ? 1 : 0);
  const candidates = [...entities].sort(
    (a, b) =>
      tier(a) - tier(b) || (degrees.get(b.name) ?? 0) - (degrees.get(a.name) ?? 0) || compareNames(a.name, b.name),
  );
  return candidates[0].name;
}

function indexByEndpoint(relationships: ErdRelationship[]): Map<string, ErdRelationship[]> {
  const index = new Map<string, ErdRelationship[]>();
  for (const edge of relationships) {
    for (const name of new Set([edge.parent, edge.child])) {
      const edges = index.get(name) ?? [];
      edges.push(edge);
      index.set(name, edges);
    }
  }
  return index;
}

/** Split when connected in-project objects exceed maxObjects, excluding hub edges when finding components.
 *
 * Expects a model from buildEntityRelationshipModel (sorted arrays) and preserves its order.
 * Unrelated in-project objects are listed separately. Non-hub objects connected only to hubs
 * ("satellites") share one diagram per hub (their lexicographically first hub). Hub-to-hub edges
 * attach to diagrams containing either hub; any edge still unplaced forms diagrams by connectivity.
 */
export function splitEntityRelationshipModel(
  model: EntityRelationshipModel,
  options?: ErdOptions,
): { diagrams: ErdDiagram[]; unrelatedObjects: string[] } {
  const maxObjects = options?.maxObjects ?? 40;
  const hubs = new Set(options?.hubs ?? ['User']);
  const { relationships } = model;
  const names = endpointNames(relationships);
  const connected = model.entities.filter((entity) => names.has(entity.name));
  const unrelatedObjects = model.entities
    .filter((entity) => !entity.external && !names.has(entity.name))
    .map((entity) => entity.name);
  if (connected.length === 0) return { diagrams: [], unrelatedObjects };
  if (connected.filter((entity) => !entity.external).length <= maxObjects) {
    return {
      diagrams: [{ name: options?.title ?? 'Data model', entities: connected, relationships, oversized: false }],
      unrelatedObjects,
    };
  }
  const order = new Map(relationships.map((edge, index) => [edge, index]));
  const index = indexByEndpoint(relationships);
  const isHubEdge = (edge: ErdRelationship): boolean => hubs.has(edge.parent) && hubs.has(edge.child);
  const nonHubEdges = relationships.filter((edge) => !hubs.has(edge.parent) && !hubs.has(edge.child));
  const nonHubNames = endpointNames(nonHubEdges);
  const groups = connectedComponents(nonHubEdges);
  const satellites = new Map<string, Set<string>>();
  for (const { name } of connected) {
    if (hubs.has(name) || nonHubNames.has(name)) continue;
    const hub = (index.get(name) ?? [])
      .map((edge) => (edge.parent === name ? edge.child : edge.parent))
      .sort(compareNames)[0];
    satellites.set(hub, (satellites.get(hub) ?? new Set<string>()).add(name));
  }
  groups.push(...satellites.values());
  const placed = new Set<ErdRelationship>();
  const build = (edgeSet: Set<ErdRelationship>): ErdDiagram => {
    const edges = [...edgeSet].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const diagramNames = endpointNames(edges);
    const entities = connected.filter((entity) => diagramNames.has(entity.name));
    for (const edge of edges) placed.add(edge);
    const diagram = {
      name: anchorName(entities, edges, hubs),
      entities,
      relationships: edges,
      oversized: false,
    };
    diagram.oversized = inProjectCount(diagram) > maxObjects;
    return diagram;
  };
  const diagrams = groups.map((group) => {
    const edges = new Set([...group].flatMap((name) => index.get(name) ?? []));
    for (const name of endpointNames([...edges])) {
      for (const edge of index.get(name) ?? []) if (isHubEdge(edge)) edges.add(edge);
    }
    return build(edges);
  });
  const leftover = relationships.filter((edge) => !placed.has(edge));
  const leftoverIndex = indexByEndpoint(leftover);
  for (const group of connectedComponents(leftover)) {
    diagrams.push(build(new Set([...group].flatMap((name) => leftoverIndex.get(name) ?? []))));
  }
  diagrams.sort((a, b) => inProjectCount(b) - inProjectCount(a) || compareNames(a.name, b.name));
  return { diagrams, unrelatedObjects };
}

/** Render sorted Mermaid ER source, with quoted field labels and no fence or trailing newline. */
export function renderMermaidErDiagram(diagram: ErdDiagram): string {
  const lines = [...diagram.relationships].sort(compareRelationships).map((edge) => {
    const cardinality =
      edge.kind === 'MasterDetail' ? '||--o{' : edge.required && edge.kind === 'Lookup' ? '||..o{' : '|o..o{';
    return `  ${edge.parent} ${cardinality} ${edge.child} : "${edge.field}"`;
  });
  return ['erDiagram', ...lines].join('\n');
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('_', '\\_');
}

/** Build the model, split diagrams, and render Markdown for copy-paste into Gliffy or previews. */
export function buildEntityRelationshipDiagramMarkdown(
  objects: ObjectItem[],
  options?: ErdOptions,
): { markdown: string; model: EntityRelationshipModel; diagrams: ErdDiagram[]; unrelatedObjects: string[] } {
  const model = buildEntityRelationshipModel(objects);
  const { diagrams, unrelatedObjects } = splitEntityRelationshipModel(model, options);
  const sections = [options?.title === undefined ? '# Data model' : `# Data model: ${escapeMarkdown(options.title)}`];
  if (objects.length === 0) {
    sections.push('No objects found.');
  } else {
    if (diagrams.length > 0) {
      sections.push(
        'Generated by `sf simply document erd`. Paste each block into Gliffy via Create from code → Mermaid.\n' +
          "Standard relationships (such as Contact → Account) aren't in DX source and aren't shown.",
      );
    }
    for (const [index, diagram] of diagrams.entries()) {
      const count = diagram.entities.length;
      const edgeCount = diagram.relationships.length;
      sections.push(
        `## ${index + 1}. ${escapeMarkdown(diagram.name)} (${count} ${count === 1 ? 'object' : 'objects'}, ${edgeCount} ${edgeCount === 1 ? 'relationship' : 'relationships'})`,
      );
      const external = diagram.entities
        .filter((entity) => entity.external)
        .map((entity) => escapeMarkdown(entity.name));
      if (external.length > 0) sections.push(`Referenced, not in this project: ${external.join(', ')}`);
      sections.push('```mermaid\n' + renderMermaidErDiagram(diagram) + '\n```');
    }
    if (unrelatedObjects.length > 0) {
      sections.push('## Objects with no relationships', unrelatedObjects.map(escapeMarkdown).join(', '));
    }
  }
  return { markdown: sections.join('\n\n') + '\n', model, diagrams, unrelatedObjects };
}
