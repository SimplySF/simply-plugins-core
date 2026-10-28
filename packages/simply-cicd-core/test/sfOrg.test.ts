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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrgInstanceUrl, getRemainingDailyScratchOrgs } from '../src/sfOrg.js';

const orgCreateMock = vi.hoisted(() => vi.fn());
const limitsMock = vi.hoisted(() => vi.fn());

vi.mock('@salesforce/core', () => ({ Org: { create: orgCreateMock } }));

describe('sfOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgCreateMock.mockResolvedValue({
      getConnection: () => ({ instanceUrl: 'https://acme.my.salesforce.com', limits: limitsMock }),
    });
  });

  describe('getOrgInstanceUrl', () => {
    it("returns the org connection's instance URL", async () => {
      expect(await getOrgInstanceUrl('my-org')).toBe('https://acme.my.salesforce.com');
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'my-org' });
    });

    it.each([undefined, ''])('falls back to the default target org for %j', async (alias) => {
      await getOrgInstanceUrl(alias);
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: undefined });
    });
  });

  describe('getRemainingDailyScratchOrgs', () => {
    it("returns the Dev Hub's remaining DailyScratchOrgs", async () => {
      limitsMock.mockResolvedValue({ DailyScratchOrgs: { Max: 200, Remaining: 37 }, DailyApiRequests: {} });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBe(37);
      expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: 'hub@example.com' });
    });

    it('returns undefined when the org does not report the limit', async () => {
      limitsMock.mockResolvedValue({ DailyApiRequests: { Max: 1, Remaining: 1 } });

      expect(await getRemainingDailyScratchOrgs('hub@example.com')).toBeUndefined();
    });
  });
});
