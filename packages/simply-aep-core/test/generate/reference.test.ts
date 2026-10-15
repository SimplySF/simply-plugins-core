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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlannedArtifact } from '../../src/index.js';
import { REFERENCE_CMDT_ARTIFACTS, buildReferenceCases, parseCustomMetadataValues } from './referenceCases.js';

/**
 * The parity gate for the port from apx-core (docs/design/0045). The fixture is every artifact
 * `@syntax-syllogism/apx-core@0.3.1` renders for the inputs in `referenceCases.ts`, captured from the
 * published package. Every non-CMDT artifact must match it byte for byte; every CMDT record must carry
 * the same values, with only the differences 0045 lists.
 */
const reference = JSON.parse(
  readFileSync(new URL('../fixtures/generate/apx-core-0.3.1-reference.json', import.meta.url), 'utf8'),
) as { source: string; cases: Record<string, PlannedArtifact[]> };

const cases = buildReferenceCases();

/** The SObject reference field pairs, which 0045 lets differ in which half is populated. */
const SOBJECT_FIELD_PAIRS: Array<[string, string]> = [
  ['BindingSObject__c', 'BindingSObjectAlternate__c'],
  ['RelatedDomainBindingSObject__c', 'RelatedDomainBindingSObjectAlternate__c'],
];
const DOUBLE_FIELDS = new Set(['BindingSequence__c', 'OrderOfExecution__c', 'Priority__c']);

describe('parity with apx-core@0.3.1', () => {
  it('covers the same cases as the reference', () => {
    expect(Object.keys(cases).sort()).toStrictEqual(Object.keys(reference.cases).sort());
  });

  for (const [name, expected] of Object.entries(reference.cases)) {
    describe(name, () => {
      const actual = cases[name] ?? [];

      it('plans the same artifacts at the same paths', () => {
        expect(actual.map(({ id, relativePath }) => ({ id, relativePath }))).toStrictEqual(
          expected.map(({ id, relativePath }) => ({ id, relativePath })),
        );
      });

      for (const [index, artifact] of expected.entries()) {
        const generated = actual[index];
        if (!REFERENCE_CMDT_ARTIFACTS.has(artifact.id)) {
          it(`renders ${artifact.relativePath} byte for byte`, () => {
            expect(generated?.content).toBe(artifact.content);
          });
          continue;
        }

        it(`writes ${artifact.relativePath} with the same values`, () => {
          const before = parseCustomMetadataValues(artifact.content);
          const after = parseCustomMetadataValues(generated?.content ?? '');
          expect(after.label).toBe(before.label);

          const paired = new Set(SOBJECT_FIELD_PAIRS.flat());
          for (const [primary, alternate] of SOBJECT_FIELD_PAIRS) {
            if (!(primary in before.values)) continue;
            expect(after.values[primary] ?? after.values[alternate]).toBe(
              before.values[primary] ?? before.values[alternate],
            );
          }
          for (const [field, value] of Object.entries(before.values)) {
            if (paired.has(field)) continue;
            if (DOUBLE_FIELDS.has(field)) {
              expect(Number(after.values[field])).toBe(Number(value));
            } else {
              expect(after.values[field]).toBe(value);
            }
          }
          // The only field the shared serializer adds: Priority__c on Selector and Service bindings, nil.
          const added = Object.keys(after.values).filter((field) => !(field in before.values));
          expect(added.every((field) => field === 'Priority__c' && after.values[field] === undefined)).toBe(true);
        });
      }
    });
  }
});
