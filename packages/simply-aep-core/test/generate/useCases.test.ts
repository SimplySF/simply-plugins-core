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
import type { Connection } from '@salesforce/core';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FFLIB_UNIT_OF_WORK_SNIPPET,
  describeGenerationError,
  generate,
  generateAction,
  generateDomain,
  generateFieldSetInclusion,
  generateSelector,
  generateService,
  generateUnitOfWork,
  generationCommandDescriptors,
  generationUseCases,
  isAepGenerationError,
  renderGenerationResult,
  uiHints,
} from '../../src/index.js';
import { readDescribe } from './referenceCases.js';

const stubConnection = (): { conn: Connection; describeSObject: sinon.SinonStub } => {
  const describeSObject = sinon.stub().callsFake(async (name: string) => readDescribe(`${name.toLowerCase()}.json`));
  const conn = { describeSObject, getApiVersion: () => '62.0' } as unknown as Connection;
  return { conn, describeSObject };
};

describe('generation use cases', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-aep-use-cases-'));
  });
  afterEach(() => {
    sinon.restore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('has a unique id and simply cliId for every use case', () => {
    expect(Object.keys(generationUseCases)).toStrictEqual(generationCommandDescriptors.map((d) => d.id));
    expect(generationCommandDescriptors.map((d) => d.cliId)).toStrictEqual([
      'simply:aep:generate',
      'simply:aep:generate:selector',
      'simply:aep:generate:domain',
      'simply:aep:generate:service',
      'simply:aep:generate:unit-of-work',
      'simply:aep:generate:selector-method',
      'simply:aep:generate:field-set-inclusion',
      'simply:aep:generate:action',
      'simply:aep:generate:criteria',
    ]);
  });

  it('requires a connection for the describe-backed generators', async () => {
    try {
      await generateSelector.plan(undefined, { sobject: 'Account', flavor: 'at4dx' }, { projectRoot: root });
      expect.fail('Expected org-required');
    } catch (error) {
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).toBe('org-required');
    }
  });

  it('plans from the describe, relative to the project root, without writing', async () => {
    const { conn, describeSObject } = stubConnection();
    const preview = await generateDomain.plan(conn, { sobject: 'Account', flavor: 'at4dx' }, { projectRoot: root });
    expect(describeSObject.calledOnceWithExactly('Account')).toBe(true);
    expect(preview.baseDir).toBe(path.join(root, 'generated-files'));
    expect(preview.files.map((file) => file.relativePath)).toContain('main/classes/domains/Accounts.cls');
    expect(preview.files.every((file) => file.status === 'new')).toBe(true);
    expect(fs.existsSync(preview.baseDir)).toBe(false);
  });

  it('refuses to overwrite on apply unless asked', async () => {
    const { conn } = stubConnection();
    const options = { sobject: 'Account', flavor: 'at4dx' as const };
    const first = await generateSelector.plan(conn, options, { projectRoot: root });
    const written = await generateSelector.apply(conn, first);
    expect(written.created).toHaveLength(first.files.length);

    const second = await generateSelector.plan(conn, options, { projectRoot: root });
    expect(second.files.every((file) => file.status === 'exists')).toBe(true);
    try {
      await generateSelector.apply(conn, second);
      expect.fail('Expected file-exists');
    } catch (error) {
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).toBe('file-exists');
      expect((error.data as { absolutePaths: string[] }).absolutePaths).toHaveLength(second.files.length);
    }
    const replaced = await generateSelector.apply(conn, second, { overwrite: 'overwrite' });
    expect(replaced.created).toHaveLength(second.files.length);
  });

  it('reports nothing-selected for an aggregate run with no group', async () => {
    const { conn } = stubConnection();
    try {
      await generate.plan(conn, { sobject: 'Account', flavor: 'at4dx' }, { projectRoot: root });
      expect.fail('Expected nothing-selected');
    } catch (error) {
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).toBe('nothing-selected');
    }
  });

  it('combines the selected groups in an aggregate run', async () => {
    const { conn } = stubConnection();
    const preview = await generate.plan(
      conn,
      { sobject: 'Property__c', flavor: 'at4dx', selector: true, unitOfWork: true },
      { projectRoot: root },
    );
    const ids = new Set(preview.files.map((file) => file.artifactId));
    expect(ids.has('selectorBinding')).toBe(true);
    expect(ids.has('unitOfWorkBinding')).toBe(true);
    expect(ids.has('domainClass')).toBe(false);
  });

  it('returns the fflib unit-of-work snippet as manual steps, and renders only them', async () => {
    const { conn } = stubConnection();
    const preview = await generateUnitOfWork.plan(conn, { sobject: 'Account', flavor: 'fflib' }, { projectRoot: root });
    expect(preview.files).toStrictEqual([]);
    expect(preview.manualSteps).toStrictEqual([FFLIB_UNIT_OF_WORK_SNIPPET, 'Account.SObjectType']);
    const outcome = await generateUnitOfWork.apply(conn, preview);
    expect(renderGenerationResult(outcome, { commandId: 'generate-unit-of-work' })).toStrictEqual([
      FFLIB_UNIT_OF_WORK_SNIPPET,
      '    Account.SObjectType',
    ]);
  });

  it('rejects a binding sequence that is not a number', async () => {
    const { conn } = stubConnection();
    try {
      await generateUnitOfWork.plan(conn, { sobject: 'Account', flavor: 'at4dx', bindingSequence: 'soon' });
      expect.fail('Expected a validation error');
    } catch (error) {
      expect(describeGenerationError(error).title).toBe(
        'The binding sequence must be a number, such as `1000` or `1000.5`.',
      );
    }
  });

  it('generates a service without an org, at the default API version', async () => {
    const preview = await generateService.plan(
      undefined,
      { serviceBasename: 'Billing', flavor: 'fflib' },
      { projectRoot: root },
    );
    const meta = preview.files.find((file) => file.relativePath.endsWith('BillingService.cls-meta.xml'));
    expect(meta?.content).toContain('<apiVersion>60.0</apiVersion>');
    expect(preview.files.some((file) => file.artifactId === 'serviceBinding')).toBe(false);
  });

  it('rejects an action whose binding name exceeds 40 characters', async () => {
    try {
      await generateAction.plan(undefined, {
        sobject: 'Account',
        className: 'A',
        processName: 'AProcessNameThatIsFarTooLongToFit',
        order: '10.2',
      });
      expect.fail('Expected a validation error');
    } catch (error) {
      expect(describeGenerationError(error).title).toContain('longer than the 40-character Salesforce limit');
    }
  });

  it('defaults a field-set inclusion label and description', async () => {
    const preview = await generateFieldSetInclusion.plan(
      undefined,
      { sobject: 'Account', fields: ['Name'] },
      { projectRoot: root },
    );
    const fieldSet = preview.files.find((file) => file.artifactId === 'selectorInclusionFieldSet');
    expect(fieldSet?.content).toContain('<label>SelectorInclusion_AccountFields</label>');
    expect(fieldSet?.content).toContain('<description>Generated selector field inclusion for Account.</description>');
  });

  it('exposes UI hints for prompting callers', () => {
    const hints = uiHints(generateSelector.descriptor.optionsSchema);
    expect(hints.outputPath).toMatchObject({ kind: 'folder', label: 'Output folder' });
    expect(hints.flavor).toMatchObject({ kind: 'enum', label: 'Framework' });
    expect(hints.sobject).toMatchObject({ kind: 'string', label: 'SObject API name' });
  });

  it('honors cancellation before planning', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await generateService.plan(undefined, { serviceBasename: 'X', flavor: 'fflib' }, { signal: controller.signal });
      expect.fail('Expected cancellation');
    } catch (error) {
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).toBe('cancelled');
    }
  });
});
