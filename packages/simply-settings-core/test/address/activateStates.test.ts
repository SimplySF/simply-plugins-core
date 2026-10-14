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

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { Duration } from '@salesforce/kit';
import { ComponentSet, ComponentStatus } from '@salesforce/source-deploy-retrieve';
import sinon from 'sinon';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { activateStates } from '../../src/address/activateStates.js';
import { parseAddressSettingsXml } from '../../src/address/addressSettingsXml.js';
import { retrieveAddressSettingsXml } from '../../src/address/addressSettingsTransfer.js';
import { formatStateKey, parseStateDefinitions } from '../../src/address/stateDefinitions.js';
import { fixture } from './fixtures.js';

describe('AddressSettings retrieve/deploy', () => {
  const $$ = new TestContext({ sinon });
  const testOrg = new MockTestOrgData();
  const wait = Duration.minutes(1);
  let scratch: string;

  beforeAll(async () => {
    await $$.stubAuths(testOrg);
  });

  afterEach(async () => {
    $$.restore();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  /** Stubs the retrieve to write the fixture where SDR would, and report it. */
  async function stubRetrieve(fileResponses?: unknown[]): Promise<void> {
    scratch = await mkdtemp(path.join(tmpdir(), 'settings-test-'));
    const filePath = path.join(scratch, 'settings', 'Address.settings-meta.xml');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fixture('Address.settings-meta.xml'));
    $$.SANDBOX.stub(ComponentSet.prototype, 'retrieve').resolves({
      pollStatus: sinon.stub().resolves({
        getFileResponses: () =>
          fileResponses ?? [{ fullName: 'Address', type: 'Settings', filePath, state: ComponentStatus.Created }],
      }),
    } as never);
  }

  function stubDeploy(success = true): { deployedXml: () => string | undefined } {
    let deployedXml: string | undefined;
    const fromSource = ComponentSet.fromSource.bind(ComponentSet);
    $$.SANDBOX.stub(ComponentSet, 'fromSource').callsFake((input) => {
      // `deployAddressSettingsXml` always passes the one file path it wrote.
      const filePath = input as unknown as string;
      const set = fromSource(filePath);
      sinon.stub(set, 'deploy').callsFake(async () => {
        deployedXml = await readFile(filePath, 'utf8');
        return {
          pollStatus: sinon.stub().resolves({
            response: { id: '0Af000000000001', status: success ? 'Succeeded' : 'Failed', success },
            getFileResponses: () =>
              success
                ? [{ fullName: 'Address', type: 'Settings', state: ComponentStatus.Changed }]
                : [{ fullName: 'Address', type: 'Settings', state: ComponentStatus.Failed, error: 'bad label' }],
          }),
        } as never;
      });
      return set;
    });
    return { deployedXml: () => deployedXml };
  }

  it('retrieves the Address settings file text', async () => {
    await stubRetrieve();
    const connection = await testOrg.getConnection();

    const xml = await retrieveAddressSettingsXml({ connection, wait });

    expect(parseAddressSettingsXml(xml).countries).toHaveLength(2);
    const [components] = (ComponentSet.prototype.retrieve as sinon.SinonStub).thisValues as ComponentSet[];
    expect(components.toArray().map((component) => `${component.type.name}:${component.fullName}`)).toStrictEqual([
      'Settings:Address',
    ]);
  });

  it('reports a retrieve that returned no settings file', async () => {
    await stubRetrieve([{ fullName: 'Address', type: 'Settings', state: ComponentStatus.Failed, error: 'no access' }]);
    const connection = await testOrg.getConnection();

    await expect(retrieveAddressSettingsXml({ connection, wait })).rejects.toThrow(
      "Couldn't retrieve AddressSettings from the org. no access",
    );
  });

  it('deploys the settings with only the listed states activated', async () => {
    await stubRetrieve();
    const deploy = stubDeploy();
    const connection = await testOrg.getConnection();

    const result = await activateStates({
      connection,
      wait,
      states: parseStateDefinitions({ 'US-GU': 'Guam', 'US-CA': 'California', 'US-ZZ': 'Zed' }),
    });

    expect(result.activated.map(formatStateKey)).toStrictEqual(['US-GU']);
    expect(result.alreadyActive.map(formatStateKey)).toStrictEqual(['US-CA']);
    expect(result.notInOrg.map(formatStateKey)).toStrictEqual(['US-ZZ']);
    expect(result.deploy).toStrictEqual({ id: '0Af000000000001', status: 'Succeeded', success: true, failures: [] });

    const deployed = parseAddressSettingsXml(deploy.deployedXml()!);
    expect(deployed.countries[1].states.find((state) => state.isoCode === 'GU')).toMatchObject({
      active: true,
      visible: true,
    });
  });

  it('returns a failed deploy rather than throwing', async () => {
    await stubRetrieve();
    stubDeploy(false);
    const connection = await testOrg.getConnection();

    const result = await activateStates({ connection, wait, states: parseStateDefinitions({ 'US-GU': 'Guam' }) });

    expect(result.deploy).toMatchObject({
      success: false,
      failures: [{ fullName: 'Address', type: 'Settings', error: 'bad label' }],
    });
  });

  it('skips the deploy for a dry run, and when nothing needs changing', async () => {
    await stubRetrieve();
    const deploy = stubDeploy();
    const connection = await testOrg.getConnection();

    const dryRun = await activateStates({
      connection,
      wait,
      dryRun: true,
      states: parseStateDefinitions({ 'US-GU': 'Guam' }),
    });
    const noChange = await activateStates({
      connection,
      wait,
      states: parseStateDefinitions({ 'US-CA': 'California' }),
    });

    expect(dryRun.activated.map(formatStateKey)).toStrictEqual(['US-GU']);
    expect(dryRun.deploy).toBeUndefined();
    expect(noChange.deploy).toBeUndefined();
    expect(deploy.deployedXml()).toBeUndefined();
  });
});
