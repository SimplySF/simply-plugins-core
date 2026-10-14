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

import { planStateActivation } from './addressSettingsXml.js';
import {
  deployAddressSettingsXml,
  retrieveAddressSettingsXml,
  type AddressSettingsDeployResult,
  type AddressSettingsTransferOptions,
} from './addressSettingsTransfer.js';
import type { StateDefinition } from './stateDefinitions.js';

export type ActivateStatesOptions = AddressSettingsTransferOptions & {
  states: StateDefinition[];
  /** Plan only: report what would change, deploy nothing. */
  dryRun?: boolean;
};

export type ActivateStatesResult = {
  activated: StateDefinition[];
  alreadyActive: StateDefinition[];
  notInOrg: StateDefinition[];
  /** Present when a deploy ran — not for a dry run, or when nothing needed changing. */
  deploy?: AddressSettingsDeployResult;
};

/**
 * Sets the given states active and visible: retrieves the org's AddressSettings, flips
 * `<active>`/`<visible>` on exactly those states, and deploys the result back.
 *
 * @param options - Connection, states, wait, and dry-run.
 * @returns How each state was handled, and the deploy result if one ran. A failed deploy is
 * reported in `deploy.success`/`deploy.failures`, not thrown.
 */
export async function activateStates(options: ActivateStatesOptions): Promise<ActivateStatesResult> {
  const xml = await retrieveAddressSettingsXml(options);
  const { xml: updatedXml, ...plan } = planStateActivation(xml, options.states);

  if (options.dryRun || updatedXml === undefined) {
    return plan;
  }

  return { ...plan, deploy: await deployAddressSettingsXml({ ...options, xml: updatedXml }) };
}
