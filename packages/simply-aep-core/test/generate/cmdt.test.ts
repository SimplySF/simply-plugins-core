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
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_BINDING_TYPES,
  PathResolver,
  buildActionNames,
  buildActionPlan,
  buildDomainPlan,
  buildFieldInjectionNames,
  buildFieldInjectionPlan,
  buildSObjectNames,
  buildSelectorPlan,
  buildUnitOfWorkPlan,
  scanLocalBindings,
  scanLocalDomainProcessBindings,
  scanLocalFieldSetInclusions,
  validateBindings,
  validateDomainProcessBindings,
  validateFieldSetInclusions,
  type PlannedArtifact,
} from '../../src/index.js';
import { REFERENCE_CMDT_ARTIFACTS, buildReferenceCases } from './referenceCases.js';

/**
 * Every generated CMDT record has to be one the scanners read back cleanly and the validators accept
 * on its own — the shared-serializer decision in docs/design/0045. `User` is the case apx-core got
 * wrong: a standard object EntityDefinition can't reference, which apx put in the primary field.
 */
const userCases = (): Record<string, PlannedArtifact[]> => {
  const paths = new PathResolver();
  const view = { apiName: 'User', isCustom: false, fieldNames: ['Id', 'Name'] };
  const names = buildSObjectNames({ apiName: 'User', isCustom: false });
  const inputs = { names, view, flavor: 'at4dx' as const, apiVersion: '62.0', paths, includeBinding: true };
  const actionNames = buildActionNames({ className: 'UserAction', sobjectApiName: 'User', order: '10.2' });
  const fieldSetNames = buildFieldInjectionNames({ sobjectApiName: 'User' });
  return {
    'selector/User': buildSelectorPlan(inputs).artifacts,
    'domain/User': buildDomainPlan(inputs).artifacts,
    'unit-of-work/User': buildUnitOfWorkPlan({ ...inputs, bindingSequenceValue: '1000.0' }).artifacts,
    'action/User': buildActionPlan({
      names: actionNames,
      flavor: 'at4dx',
      apiVersion: '62.0',
      triggerOperation: 'Before_Insert',
      orderOfExecution: '10.2',
      description: 'x',
      paths,
    }).artifacts,
    'field-set-inclusion/User': buildFieldInjectionPlan({
      names: fieldSetNames,
      flavor: 'at4dx',
      fieldNames: ['Name'],
      label: fieldSetNames.fieldsetName,
      description: 'x',
      paths,
    }).artifacts,
  };
};

describe('generated CMDT records', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-aep-generate-cmdt-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const records = Object.entries({ ...buildReferenceCases(), ...userCases() }).flatMap(([name, artifacts]) =>
    artifacts.filter((artifact) => REFERENCE_CMDT_ARTIFACTS.has(artifact.id)).map((artifact) => ({ name, artifact })),
  );

  it('covers every CMDT artifact type', () => {
    expect(new Set(records.map(({ artifact }) => artifact.id))).toStrictEqual(REFERENCE_CMDT_ARTIFACTS);
  });

  for (const { name, artifact } of records) {
    it(`${name}: ${path.basename(artifact.relativePath)} scans back and validates clean`, () => {
      const target = path.join(dir, 'customMetadata', path.basename(artifact.relativePath));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, artifact.content);

      const scan =
        artifact.id === 'domainProcessBinding'
          ? scanLocalDomainProcessBindings([dir])
          : artifact.id === 'selectorConfigFieldSetInclusionBinding'
            ? scanLocalFieldSetInclusions([dir])
            : scanLocalBindings([dir], ALL_BINDING_TYPES);
      expect(scan.records).toHaveLength(1);
      expect(scan.malformed).toStrictEqual([]);
      expect(scan.ambiguous).toStrictEqual([]);

      const issues =
        artifact.id === 'domainProcessBinding'
          ? validateDomainProcessBindings(scanLocalDomainProcessBindings([dir]))
          : artifact.id === 'selectorConfigFieldSetInclusionBinding'
            ? validateFieldSetInclusions(scanLocalFieldSetInclusions([dir]))
            : validateBindings(scanLocalBindings([dir], ALL_BINDING_TYPES));
      expect(issues).toStrictEqual([]);
    });
  }

  it('puts an object EntityDefinition cannot reference in the alternate field', () => {
    const [binding] = userCases()['selector/User'].filter((artifact) => artifact.id === 'selectorBinding');
    expect(binding.content).toContain(
      '<values><field>BindingSObjectAlternate__c</field><value xsi:type="xsd:string">User</value></values>',
    );
    expect(binding.content).toContain('<values><field>BindingSObject__c</field><value xsi:nil="true"/></values>');
  });
});
