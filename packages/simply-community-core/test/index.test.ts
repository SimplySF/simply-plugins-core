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

import { it, expect } from 'vitest';
import * as api from '../src/index.js';

/**
 * Pins down this package's public API surface. Types are erased at runtime and so can't be checked
 * here — TypeScript's own compilation of this file is what would catch a type export being removed
 * (this file doesn't currently import any type-only export, so add one if that changes). This test
 * guards the *value* exports (functions, constants) that survive to runtime.
 *
 * Updating this list is expected when the API deliberately grows. A test failure from a removed or
 * renamed key is the signal to treat the change as breaking (see `src/index.ts`'s header comment).
 */
it('exports the expected set of runtime values', () => {
  expect(Object.keys(api).sort()).toStrictEqual([
    'DEFAULT_PUBLISH_REQUEST_TIMEOUT',
    'checkPublishStatus',
    'deployChangedFiles',
    'patchCustomSiteXml',
    'patchNetworkXml',
    'publishCommunity',
    'readNetworkSiteName',
    'resolveNetworkFile',
    'resolveRetrieveDestination',
    'resolveSearchRoots',
    'resolveSiteFile',
    'retrieveCustomSite',
    'verifyDomain',
  ]);
});
