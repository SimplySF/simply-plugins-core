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
import {
  PathResolver,
  buildActionNames,
  buildActionPlan,
  buildCriteriaNames,
  buildCriteriaPlan,
  buildDomainPlan,
  buildFieldInjectionNames,
  buildFieldInjectionPlan,
  buildSObjectNames,
  buildSelectorMethodNames,
  buildSelectorMethodPlan,
  buildSelectorPlan,
  buildServiceNames,
  buildServicePlan,
  buildUnitOfWorkPlan,
  toDescribeView,
  type ArtifactId,
  type GenerationPlan,
  type PlannedArtifact,
  type SObjectDescribeView,
} from '../../src/index.js';

/** The CMDT artifacts, which 0045 serializes with this package's builders instead of apx-core's templates. */
export const REFERENCE_CMDT_ARTIFACTS: ReadonlySet<ArtifactId> = new Set([
  'selectorBinding',
  'domainBinding',
  'serviceBinding',
  'unitOfWorkBinding',
  'domainProcessBinding',
  'selectorConfigFieldSetInclusionBinding',
]);

/**
 * @param name - A fixture under `test/fixtures/generate/describe/`.
 * @returns The fixture's raw describe JSON.
 */
export function readDescribe(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/generate/describe/${name}`, import.meta.url), 'utf8')) as unknown;
}

const describeView = (name: string): SObjectDescribeView =>
  toDescribeView(readDescribe(name) as Parameters<typeof toDescribeView>[0]);

/**
 * Every case in `apx-core-0.3.1-reference.json`, built the same way the reference was captured: the
 * same inputs, passed to this package's plan builders instead of apx-core's.
 *
 * @returns The planned artifacts per case name.
 */
export function buildReferenceCases(): Record<string, PlannedArtifact[]> {
  const views: Array<[string, SObjectDescribeView]> = [
    ['Account', describeView('account.json')],
    ['Property__c', describeView('property__c.json')],
  ];
  const paths = new PathResolver();
  const cases: Record<string, PlannedArtifact[]> = {};
  const add = (name: string, plan: GenerationPlan): void => {
    cases[name] = plan.artifacts;
  };

  for (const flavor of ['at4dx', 'fflib'] as const) {
    for (const [sobject, view] of views) {
      for (const prefix of [undefined, 'acme']) {
        const names = buildSObjectNames({ apiName: view.apiName, isCustom: view.isCustom, prefix });
        const inputs = { names, view, flavor, apiVersion: '62.0', paths, includeBinding: flavor === 'at4dx' };
        const tag = `${flavor}/${sobject}${prefix ? `/${prefix}` : ''}`;
        add(`selector/${tag}`, buildSelectorPlan(inputs));
        add(`domain/${tag}`, buildDomainPlan(inputs));
        add(`unit-of-work/${tag}`, buildUnitOfWorkPlan({ ...inputs, bindingSequenceValue: '1000.0' }));
      }
    }
    for (const prefix of [undefined, 'acme']) {
      add(
        `service/${flavor}/LimitMonitors${prefix ? `/${prefix}` : ''}`,
        buildServicePlan({
          names: buildServiceNames({ basename: 'LimitMonitors', prefix }),
          flavor,
          apiVersion: '62.0',
          paths,
          includeBinding: flavor === 'at4dx',
        }),
      );
    }
  }

  add(
    'selector-method/at4dx/SelectBySloganMethod',
    buildSelectorMethodPlan({
      names: buildSelectorMethodNames({
        className: 'SelectBySloganMethod',
        sobjectApiName: 'Account',
        sobjectSelectorClassName: 'AccountsSelector',
      }),
      flavor: 'at4dx',
      apiVersion: '62.0',
      paths,
    }),
  );

  for (const type of ['action', 'criteria'] as const) {
    for (const sobject of ['Account', 'Property__c']) {
      for (const processName of [undefined, 'FishCompanySlogans']) {
        const order = type === 'action' ? '10.2' : '10.1';
        const names = (type === 'action' ? buildActionNames : buildCriteriaNames)({
          className: `DefaultSlogan${type === 'action' ? 'Action' : 'Criteria'}`,
          sobjectApiName: sobject,
          processName,
          order,
        });
        add(
          `${type}/at4dx/${sobject}${processName ? `/${processName}` : ''}`,
          (type === 'action' ? buildActionPlan : buildCriteriaPlan)({
            names,
            flavor: 'at4dx',
            apiVersion: '62.0',
            triggerOperation: 'Before_Insert',
            orderOfExecution: order,
            description: `Review generated ${type} binding for ${names.className}.`,
            paths,
          }),
        );
      }
    }
  }

  for (const sobject of ['Account', 'Property__c']) {
    for (const fieldsetName of [undefined, 'CustomInclusion']) {
      const names = buildFieldInjectionNames({ sobjectApiName: sobject, fieldsetName });
      add(
        `field-set-inclusion/at4dx/${sobject}${fieldsetName ? `/${fieldsetName}` : ''}`,
        buildFieldInjectionPlan({
          names,
          flavor: 'at4dx',
          fieldNames: ['Name', 'Slogan__c'],
          label: names.fieldsetName,
          description: `Generated selector field inclusion for ${names.sobjectApiName}.`,
          paths,
        }),
      );
    }
  }

  return cases;
}

/**
 * A deliberately independent reader of a CustomMetadata record's label and `<values>`, so the parity
 * test doesn't validate this package's serializer with this package's own parser.
 *
 * @param xml - A `.md-meta.xml` document.
 * @returns The label, and each field's value — present as `undefined` when the field is `xsi:nil`.
 */
export function parseCustomMetadataValues(xml: string): { label?: string; values: Record<string, string | undefined> } {
  const values: Record<string, string | undefined> = {};
  for (const match of xml.matchAll(
    /<values>\s*<field>([^<]+)<\/field>\s*(<value[^>]*\/>|<value[^>]*>([^<]*)<\/value>)\s*<\/values>/g,
  )) {
    values[match[1]] = match[2].endsWith('/>') ? undefined : match[3];
  }
  return { label: /<label>([^<]*)<\/label>/.exec(xml)?.[1], values };
}
