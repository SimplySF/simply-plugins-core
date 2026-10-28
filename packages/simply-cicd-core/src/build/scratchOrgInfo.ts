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

import { promises as fs } from 'node:fs';

export type ScratchOrgInfo = {
  authFields: {
    username: string;
    clientId: string;
    instanceUrl: string;
    devHubUsername?: string;
    /** Present when the owning Dev Hub wasn't JWT-authenticated. */
    refreshToken?: string;
    /** Present alongside `refreshToken` for a custom connected app. */
    clientSecret?: string;
  };
};

/** Reads and parses `SCRATCH_ORG_INFO.json` (written by `build create-scratch`) from the current directory. */
export async function readScratchOrgInfo(): Promise<ScratchOrgInfo> {
  return JSON.parse(await fs.readFile('SCRATCH_ORG_INFO.json', 'utf-8')) as ScratchOrgInfo;
}
