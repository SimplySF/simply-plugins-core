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

import { describe, expect, it, vi } from 'vitest';
import { developerNameIssue } from '../../src/developerName.js';
import * as developerNames from '../../src/developerName.js';
import { createBinding } from '../../src/at4dxWrite.js';
import {
  PathResolver,
  buildSObjectNames,
  buildSelectorPlan,
  buildDomainPlan,
  buildUnitOfWorkPlan,
  buildServiceNames,
  buildServicePlan,
  buildActionNames,
  buildActionPlan,
  buildCriteriaPlan,
  buildFieldInjectionNames,
  buildFieldInjectionPlan,
  renderGenerationPlan,
  describeGenerationError,
  generateUnitOfWorkOptionsSchema,
  generateSelectorOptionsSchema,
  generateServiceOptionsSchema,
  generateSelectorMethodOptionsSchema,
  generateActionOptionsSchema,
  generateCriteriaOptionsSchema,
  type GenerationPreview,
} from '../../src/index.js';

const paths = new PathResolver();
const common = { flavor: 'at4dx' as const, apiVersion: '62.0', paths, includeBinding: true };

describe('generation input and CMDT validation', () => {
  it.each(['ns__Foo__c', 'Foo__e', 'Foo__mdt', 'A'.repeat(41), 'Foo_'])(
    'rejects derived CMDT names from %s',
    (apiName) => {
      const names = buildSObjectNames({ apiName, isCustom: true });
      const inputs = { ...common, names, view: { apiName, isCustom: true, fieldNames: ['Id'] } };
      for (const build of [
        () => buildSelectorPlan(inputs),
        () => buildDomainPlan(inputs),
        () => buildUnitOfWorkPlan({ ...inputs, bindingSequenceValue: '1000' }),
      ]) {
        try {
          build();
          expect.fail('Expected invalid DeveloperName');
        } catch (error) {
          expect(error).toMatchObject({
            code: 'invalid-developer-name',
            data: { source: apiName, developerName: names.applicationFactoryLabel },
          });
          expect(describeGenerationError(error).title).toContain(names.applicationFactoryLabel);
        }
      }
    },
  );

  it('rejects a service binding whose interface name exceeds 40 characters', () => {
    expect(() => buildServicePlan({ ...common, names: buildServiceNames({ basename: 'A'.repeat(34) }) })).toThrow(
      expect.objectContaining({ code: 'invalid-developer-name' }),
    );
  });

  it('validates action, criteria, and field inclusion bindings', () => {
    const names = buildActionNames({ className: 'Bad__Name', sobjectApiName: 'Account', order: '10.1' });
    for (const build of [buildActionPlan, buildCriteriaPlan]) {
      expect(() =>
        build({ ...common, names, triggerOperation: 'Before_Insert', orderOfExecution: '10.1', description: 'x' }),
      ).toThrow(expect.objectContaining({ code: 'invalid-developer-name' }));
    }
    expect(() =>
      buildFieldInjectionPlan({
        ...common,
        names: buildFieldInjectionNames({ sobjectApiName: 'Account', fieldsetName: 'Bad_' }),
        fieldNames: ['Id'],
        label: 'x',
        description: 'x',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-developer-name' }));
  });

  it.each(['1Invalid', 'Bad__Name', 'Bad_', 'A'.repeat(41)])(
    'create uses the same shared rule for %s',
    async (developerName) => {
      const spy = vi.spyOn(developerNames, 'developerNameIssue');
      try {
        expect(developerNameIssue(developerName)).toBeTruthy();
        spy.mockClear();
        await expect(
          createBinding(
            { bindingType: 'Selector', developerName, sobject: 'Account', to: 'AccountsSelector' },
            { sourceDir: '/unused' },
          ),
        ).rejects.toMatchObject({ code: 'invalid-developer-name' });
        expect(spy).toHaveBeenCalledWith(developerName);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each(['1000', '1000.5', '0'])('accepts decimal sequence %s', (bindingSequence) => {
    expect(
      generateUnitOfWorkOptionsSchema.safeParse({ sobject: 'Account', flavor: 'at4dx', bindingSequence }).success,
    ).toBe(true);
  });
  it.each(['Infinity', '-1', '0x10', '1e3', ' 5 ', '', 'NaN', '9'.repeat(400)])(
    'rejects sequence %s',
    (bindingSequence) => {
      expect(
        generateUnitOfWorkOptionsSchema.safeParse({ sobject: 'Account', flavor: 'at4dx', bindingSequence }).success,
      ).toBe(false);
    },
  );

  it.each(['../../escape', '/tmp/escape', 'Bad\\Name', 'C:\\escape'])('rejects unsafe identifier %s', (value) => {
    expect(generateSelectorOptionsSchema.safeParse({ sobject: value, flavor: 'at4dx' }).success).toBe(false);
    expect(generateServiceOptionsSchema.safeParse({ serviceBasename: value, flavor: 'at4dx' }).success).toBe(false);
    const options = { sobject: 'Account', className: value, sobjectSelectorClassName: 'AccountsSelector' };
    for (const schema of [
      generateSelectorMethodOptionsSchema,
      generateActionOptionsSchema,
      generateCriteriaOptionsSchema,
    ]) {
      expect(schema.safeParse(options).success).toBe(false);
    }
  });
  it.each(['Account', 'ns__Foo__c', 'Foo__e', 'Foo__mdt', 'Foo__x'])(
    'accepts SObject API name %s at the schema boundary',
    (sobject) => {
      expect(generateSelectorOptionsSchema.safeParse({ sobject, flavor: 'at4dx' }).success).toBe(true);
    },
  );
});

describe('plan rendering policies', () => {
  const preview: GenerationPreview = {
    commandId: 'generate',
    baseDir: '/tmp',
    files: [
      {
        artifactId: 'serviceInterface',
        relativePath: 'A.cls',
        absolutePath: '/tmp/A.cls',
        content: 'a',
        status: 'exists',
      },
      {
        artifactId: 'serviceInterface',
        relativePath: 'B.cls',
        absolutePath: '/tmp/B.cls',
        content: 'b',
        status: 'new',
      },
    ],
  };
  it('defaults to a failure label', () => {
    expect(renderGenerationPlan(preview)).toEqual(['EXISTS (will fail)  A.cls', 'NEW  B.cls']);
  });
  it.each([
    ['overwrite', 'OVERWRITE'],
    ['skip', 'SKIP'],
  ] as const)('renders %s', (policy, label) => {
    expect(renderGenerationPlan(preview, policy)).toEqual([`${label}  A.cls`, 'NEW  B.cls']);
  });
});
