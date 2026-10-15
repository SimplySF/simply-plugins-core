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

import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sinon from 'sinon';
import { SfProject } from '@salesforce/core';
import { isAepGenerationError } from '../../src/generate/errors.js';
import {
  describeTarget,
  resolveApiVersion,
  resolveOutputBase,
  resolveProjectApiVersion,
  isValidOrderValue,
  isWithinCustomMetadataNameLimit,
} from '../../src/generate/support.js';

describe('AEP support', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'simply-aep-support-'));
  });
  afterEach(async () => {
    sinon.restore();
    await rm(root, { recursive: true, force: true });
  });

  it('resolves relative output against an explicit root', async () => {
    expect(await resolveOutputBase('generated-files', root)).to.equal(join(root, 'generated-files'));
  });
  it('uses the current Salesforce project when root is omitted', async () => {
    const resolve = sinon.stub(SfProject, 'resolveProjectPath').resolves(root);
    expect(await resolveOutputBase('generated-files')).to.equal(join(root, 'generated-files'));
    expect(resolve.calledOnce).to.equal(true);
  });
  it('preserves absolute output paths with or without a project', async () => {
    const resolve = sinon.stub(SfProject, 'resolveProjectPath').rejects(new Error('no project'));
    expect(await resolveOutputBase(root, '/another/root')).to.equal(root);
    expect(await resolveOutputBase(root)).to.equal(root);
    expect(resolve.called).to.equal(false);
  });
  it('reads the API version from an explicit project root', async () => {
    await writeFile(
      join(root, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [], namespace: '', sourceApiVersion: '63.0' }),
    );
    expect(await resolveProjectApiVersion(root)).to.equal('63.0');
  });
  it('returns undefined outside a project', async () => {
    expect(await resolveProjectApiVersion(root)).to.equal(undefined);
  });
  it('propagates failures other than a missing project', async () => {
    const failure = new Error('invalid project configuration');
    sinon.stub(SfProject, 'resolve').rejects(failure);
    try {
      await resolveProjectApiVersion(root);
      expect.fail('Expected failure');
    } catch (error) {
      expect(error).to.equal(failure);
    }
  });
  it('lets an explicit API version override the connection', async () => {
    const getApiVersion = sinon.stub().returns('62.0');
    expect(await resolveApiVersion({ explicit: '61.0', conn: { getApiVersion } })).to.equal('61.0');
    expect(getApiVersion.called).to.equal(false);
  });
  it('uses the connection version without an explicit flag', async () => {
    expect(await resolveApiVersion({ conn: { getApiVersion: () => '62.0' } })).to.equal('62.0');
  });
  it('uses 60.0 without a connection even if a project is supplied', async () => {
    expect(await resolveApiVersion({ projectRoot: root })).to.equal('60.0');
    expect(await resolveApiVersion({ explicit: '61.0' })).to.equal('61.0');
  });
  it('describes through the supplied connection', async () => {
    const raw: unknown = JSON.parse(await readFile('test/fixtures/generate/describe/account.json', 'utf8'));
    const describeSObject = sinon.stub().resolves(raw);
    const view = await describeTarget({ describeSObject }, 'Account');
    expect(view.apiName).to.equal('Account');
    expect(view.fieldNames).to.include('Name');
    expect(describeSObject.calledOnceWithExactly('Account')).to.equal(true);
  });
  for (const key of ['name', 'code', 'errorCode']) {
    it(`maps NOT_FOUND from ${key} to sobject-not-found`, async () => {
      const cause = Object.assign(new Error('Object does not exist'), { [key]: 'NOT_FOUND' });
      try {
        await describeTarget({ describeSObject: sinon.stub().rejects(cause) }, 'Missing__c');
        expect.fail('Expected failure');
      } catch (error) {
        expect(isAepGenerationError(error)).to.equal(true);
        if (!isAepGenerationError(error)) throw error;
        expect(error.code).to.equal('sobject-not-found');
        expect(error.message).to.equal('Object does not exist');
        expect(error.data).to.deep.equal({ sobject: 'Missing__c', cause });
      }
    });
  }
  it('maps other describe failures and retains their cause', async () => {
    const cause = new Error('Network failed');
    try {
      await describeTarget({ describeSObject: sinon.stub().rejects(cause) }, 'Account');
      expect.fail('Expected failure');
    } catch (error) {
      expect(isAepGenerationError(error)).to.equal(true);
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).to.equal('describe-failed');
      expect(error.message).to.equal('Network failed');
      expect(error.data).to.deep.equal({ sobject: 'Account', cause });
    }
  });
  it('validates order and metadata name limits', () => {
    expect(isValidOrderValue('10.20')).to.equal(true);
    for (const value of ['-1', '1.', 'a', '']) expect(isValidOrderValue(value)).to.equal(false);
    expect(isWithinCustomMetadataNameLimit('a'.repeat(40))).to.equal(true);
    expect(isWithinCustomMetadataNameLimit('a'.repeat(41))).to.equal(false);
  });
});
