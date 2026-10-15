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
  PLANNED_SOURCE,
  PathResolver,
  buildActionNames,
  buildActionPlan,
  buildBindingXml,
  buildDomainProcessBindingXml,
  buildDomainPlan,
  buildFieldInjectionNames,
  buildFieldInjectionPlan,
  buildSObjectNames,
  buildServiceNames,
  buildServicePlan,
  planGeneration,
  planValidation,
  type GenerationPlan,
  type GenerationPreview,
} from '../../src/index.js';

const paths = new PathResolver();
const view = { apiName: 'Account', isCustom: false, fieldNames: ['Id', 'Name'] };

const domainPlan = (flavor: 'at4dx' | 'fflib' = 'at4dx'): GenerationPlan =>
  buildDomainPlan({
    names: buildSObjectNames({ apiName: 'Account', isCustom: false }),
    view,
    flavor,
    apiVersion: '62.0',
    paths,
    includeBinding: flavor === 'at4dx',
  });

const writeDomainBinding = (dir: string, developerName: string, sobject: string, to: string): string => {
  const filePath = path.join(dir, 'customMetadata', `ApplicationFactory_DomainBinding.${developerName}.md-meta.xml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    buildBindingXml({ bindingType: 'Domain', key: sobject, keyField: 'primary', to }, { label: developerName }),
  );
  return filePath;
};

describe('planValidation', () => {
  let root: string;
  let packageDir: string;
  let outputDir: string;
  let preview: (plan: GenerationPlan) => Promise<GenerationPreview>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-aep-plan-validation-'));
    packageDir = path.join(root, 'force-app');
    outputDir = path.join(root, 'generated-files');
    fs.mkdirSync(packageDir, { recursive: true });
    preview = (plan) => planGeneration(plan, outputDir, 'generate-domain');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns nothing for a run that plans no CMDT record', async () => {
    writeDomainBinding(packageDir, 'Contact_A', 'Contact', 'ContactsA');
    writeDomainBinding(packageDir, 'Contact_B', 'Contact', 'ContactsB');
    expect(planValidation(await preview(domainPlan('fflib')), [packageDir])).toStrictEqual([]);
  });

  it('returns nothing for a clean run', async () => {
    expect(planValidation(await preview(domainPlan()), [packageDir, outputDir])).toStrictEqual([]);
  });

  it('reports an error the planned record introduces, located at its planned path', async () => {
    writeDomainBinding(packageDir, 'Account_Domain', 'Account', 'AccountsDomainImpl');
    const planned = await preview(domainPlan());
    const issues = planValidation(planned, [packageDir, outputDir]);

    const plannedPath = planned.files.find((file) => file.artifactId === 'domainBinding')!.absolutePath;
    expect(
      issues.map((issue) => [issue.record, issue.rule, issue.severity, issue.developerName, issue.source]),
    ).toStrictEqual([
      ['binding', 'duplicate-domain-sobject', 'error', 'Account_Domain', 'force-app'],
      ['binding', 'duplicate-domain-sobject', 'error', 'Account', PLANNED_SOURCE],
    ]);
    expect(issues[1].filePath).toBe(plannedPath);
  });

  it('reads existing records in the generators’ own layout under the output directory', async () => {
    const earlier = path.join(
      outputDir,
      paths.domainBindingDir(),
      'ApplicationFactory_DomainBinding.Earlier.md-meta.xml',
    );
    fs.mkdirSync(path.dirname(earlier), { recursive: true });
    fs.writeFileSync(
      earlier,
      buildBindingXml(
        { bindingType: 'Domain', key: 'Account', keyField: 'primary', to: 'Earlier' },
        { label: 'Earlier' },
      ),
    );

    const issues = planValidation(await preview(domainPlan()), [outputDir]);
    expect(issues.map((issue) => issue.developerName)).toStrictEqual(['Earlier', 'Account']);
  });

  it('ignores a pre-existing problem the planned records have nothing to do with', async () => {
    writeDomainBinding(packageDir, 'Contact_A', 'Contact', 'ContactsA');
    writeDomainBinding(packageDir, 'Contact_B', 'Contact', 'ContactsB');
    expect(planValidation(await preview(domainPlan()), [packageDir, outputDir])).toStrictEqual([]);
  });

  it('treats a planned file that replaces an existing one as a replacement, not a duplicate', async () => {
    const planned = await preview(domainPlan());
    const binding = planned.files.find((file) => file.artifactId === 'domainBinding')!;
    fs.mkdirSync(path.dirname(binding.absolutePath), { recursive: true });
    fs.writeFileSync(binding.absolutePath, binding.content);

    expect(planValidation(await preview(domainPlan()), [packageDir, outputDir])).toStrictEqual([]);
  });

  it('skips source directories that do not exist', async () => {
    expect(planValidation(await preview(domainPlan()), [path.join(root, 'missing'), outputDir])).toStrictEqual([]);
  });

  it('writes nothing to the source directories', async () => {
    planValidation(await preview(domainPlan()), [packageDir, outputDir]);
    expect(fs.readdirSync(packageDir)).toStrictEqual([]);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('validates domain-process bindings, tagged with their record type', async () => {
    const names = buildActionNames({ className: 'SloganAction', sobjectApiName: 'Account', order: '10.2' });
    const existing = path.join(packageDir, 'customMetadata', 'DomainProcessBinding.Other.md-meta.xml');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(
      existing,
      buildDomainProcessBindingXml(
        {
          sobject: 'Account',
          sobjectField: 'primary',
          processContext: 'TriggerExecution',
          triggerOperation: 'Before_Insert',
          type: 'Action',
          classToInject: 'OtherAction',
          order: 10.2,
          isActive: true,
          executeAsynchronous: false,
          logicalInverse: false,
          preventRecursive: false,
        },
        { label: 'Other' },
      ),
    );
    const plan = buildActionPlan({
      names,
      flavor: 'at4dx',
      apiVersion: '62.0',
      triggerOperation: 'Before_Insert',
      orderOfExecution: '10.2',
      description: 'x',
      paths,
    });

    const issues = planValidation(await planGeneration(plan, outputDir, 'generate-action'), [packageDir]);
    expect(issues.map((issue) => [issue.record, issue.rule])).toContainEqual([
      'domain-process-binding',
      'order-collision',
    ]);
  });

  it('validates field-set inclusions, tagged with their record type', async () => {
    const names = buildFieldInjectionNames({ sobjectApiName: 'Account' });
    const plan = buildFieldInjectionPlan({
      names,
      flavor: 'at4dx',
      fieldNames: ['Name'],
      label: names.fieldsetName,
      description: 'x',
      paths,
    });
    const first = await planGeneration(plan, path.join(root, 'elsewhere'), 'generate-field-set-inclusion');
    for (const file of first.files) {
      fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
      fs.writeFileSync(file.absolutePath, file.content);
    }

    const issues = planValidation(await planGeneration(plan, outputDir, 'generate-field-set-inclusion'), [
      path.join(root, 'elsewhere'),
    ]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.record === 'field-set-inclusion')).toBe(true);
  });

  it('reports a service binding with the same To__c as an existing one', async () => {
    const names = buildServiceNames({ basename: 'Billing' });
    const existing = path.join(packageDir, 'customMetadata', 'ApplicationFactory_ServiceBinding.Old.md-meta.xml');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(
      existing,
      buildBindingXml(
        { bindingType: 'Service', key: 'IOldService', to: names.implementationClassName },
        { label: 'Old' },
      ),
    );
    const plan = buildServicePlan({ names, flavor: 'at4dx', apiVersion: '62.0', paths, includeBinding: true });

    const issues = planValidation(await planGeneration(plan, outputDir, 'generate-service'), [packageDir]);
    expect(issues.map((issue) => issue.rule)).toContain('duplicate-to');
  });
});
