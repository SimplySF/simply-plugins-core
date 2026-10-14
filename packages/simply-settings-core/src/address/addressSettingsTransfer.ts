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

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SfError, type Connection } from '@salesforce/core';
import type { Duration } from '@salesforce/kit';
import { ComponentSet, ComponentStatus } from '@salesforce/source-deploy-retrieve';

export type AddressSettingsTransferOptions = {
  connection: Connection;
  /** How long to poll the retrieve/deploy before giving up. */
  wait: Duration;
};

export type AddressSettingsDeployFailure = {
  fullName: string;
  type: string;
  error: string;
};

export type AddressSettingsDeployResult = {
  id: string;
  status: string;
  success: boolean;
  failures: AddressSettingsDeployFailure[];
};

const SETTINGS_FILE = path.join('settings', 'Address.settings-meta.xml');

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'simply-settings-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Retrieves the org's `Address` settings (the `AddressSettings` metadata type, which holds every
 * country and state in State and Country/Territory Picklists).
 *
 * A Metadata API retrieve rather than a `readMetadata` call, because what comes back is then
 * exactly the source-format file `deployAddressSettingsXml` sends back — one representation for
 * both reading and writing, with no type coercion in between.
 *
 * @param options - The org connection and how long to wait for the retrieve.
 * @returns The `Address.settings-meta.xml` file's text.
 */
export async function retrieveAddressSettingsXml(options: AddressSettingsTransferOptions): Promise<string> {
  return withTempDir(async (dir) => {
    const componentSet = new ComponentSet([{ fullName: 'Address', type: 'Settings' }]);
    const retrieve = await componentSet.retrieve({
      usernameOrConnection: options.connection,
      output: dir,
      merge: false,
    });
    const result = await retrieve.pollStatus({ timeout: options.wait });

    const file = result
      .getFileResponses()
      .find(
        (response) => response.state !== ComponentStatus.Failed && response.filePath?.endsWith('.settings-meta.xml'),
      );

    if (!file?.filePath) {
      const messages = result.getFileResponses().flatMap((response) => ('error' in response ? [response.error] : []));
      throw new SfError(
        `Couldn't retrieve AddressSettings from the org.${messages.length > 0 ? ` ${messages.join(' ')}` : ''}`,
        'AddressSettingsRetrieveError',
      );
    }

    return readFile(file.filePath, 'utf8');
  });
}

/**
 * Deploys `Address.settings-meta.xml` content to the org and polls to completion.
 *
 * Does not throw on a failed deploy — the failure is reported in the result (`success: false`,
 * populated `failures`). An error here means the deploy request or polling itself broke.
 *
 * @param options - The org connection, the settings XML, and how long to wait.
 * @returns The deploy's id, terminal status, and component failures.
 */
export async function deployAddressSettingsXml(
  options: AddressSettingsTransferOptions & { xml: string },
): Promise<AddressSettingsDeployResult> {
  return withTempDir(async (dir) => {
    const filePath = path.join(dir, SETTINGS_FILE);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, options.xml, 'utf8');

    const deploy = await ComponentSet.fromSource(filePath).deploy({ usernameOrConnection: options.connection });
    const result = await deploy.pollStatus({ timeout: options.wait });

    const failures = result
      .getFileResponses()
      .flatMap((response) =>
        response.state === ComponentStatus.Failed
          ? [{ fullName: response.fullName, type: response.type, error: response.error }]
          : [],
      );

    return {
      id: result.response.id,
      status: result.response.status,
      success: result.response.success,
      failures,
    };
  });
}
