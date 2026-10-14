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

// Everything exported from this file is this package's public API and is semver-covered: adding an
// export is a minor/patch change, but removing or renaming one is breaking. `test/index.test.ts`
// pins the exported-key list down so an accidental removal fails a test instead of silently shipping
// in a patch release. See docs/design/0042-settings-address-states.md for why this package exists
// and why its logic lives here rather than in `@simplysf/simply-settings` (the CLI).

export { activateStates, type ActivateStatesOptions, type ActivateStatesResult } from './address/activateStates.js';
export {
  deployAddressSettingsXml,
  retrieveAddressSettingsXml,
  type AddressSettingsDeployFailure,
  type AddressSettingsDeployResult,
  type AddressSettingsTransferOptions,
} from './address/addressSettingsTransfer.js';
export {
  parseAddressSettingsXml,
  planStateActivation,
  type AddressSettings,
  type AddressSettingsCountry,
  type AddressSettingsState,
  type StateActivationPlan,
} from './address/addressSettingsXml.js';
export {
  createState,
  createStates,
  DEFAULT_CREATE_CONCURRENCY,
  planStateCreation,
  type CreateStateOptions,
  type CreateStatesOptions,
  type StateCreationOutcome,
  type StateCreationPlan,
  type StateCreationStatus,
} from './address/createStates.js';
export {
  classifyNewStateResponse,
  fillNewStateForm,
  parseNewStateForm,
  type NewStateForm,
  type NewStateResponseClassification,
  type NewStateResponseStatus,
} from './address/newStateForm.js';
export {
  fetchIsoCodesStateDefinitions,
  ISO_CODES_SOURCE_IDS,
  ISO_CODES_SOURCES,
  subdivisionsToStateDefinitions,
  type FetchIsoCodesStateDefinitionsOptions,
  type IsoCodesStateDefinitions,
} from './address/isoCodes/index.js';
export type {
  IsoCodesFetchOptions,
  IsoCodesSource,
  IsoCodesSourceId,
  IsoCodesSubdivision,
} from './address/isoCodes/types.js';
export {
  isLoginPage,
  NEW_STATE_FORM_PATH,
  openSetupSession,
  SetupSession,
  SetupTransportError,
  type OpenSetupSessionOptions,
  type SetupResponse,
} from './address/setupSession.js';
export {
  filterStateDefinitions,
  formatStateKey,
  parseStateDefinitions,
  type StateDefinition,
} from './address/stateDefinitions.js';
