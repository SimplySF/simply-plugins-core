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

import { Duration } from '@salesforce/kit';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { debianIsoCodesDataUrl } from '../../src/address/isoCodes/debian.js';
import {
  fetchIsoCodesStateDefinitions,
  ISO_CODES_SOURCE_IDS,
  subdivisionsToStateDefinitions,
  type FetchIsoCodesStateDefinitionsOptions,
} from '../../src/address/isoCodes/index.js';
import type { IsoCodesSourceId } from '../../src/address/isoCodes/types.js';

const SALSA = 'https://salsa.debian.org';
const TAGS_PATH = '/api/v4/projects/iso-codes-team%2Fiso-codes/repository/tags?order_by=version&sort=desc&per_page=20';
const dataPath = (version: string): string => `/iso-codes-team/iso-codes/-/raw/${version}/data/iso_3166-2.json`;

// A slice of the real file's shape: FR has a region with a nested department, US is flat, and the
// upstream `type` field is present.
const DATA = {
  '3166-2': [
    { code: 'FR-ARA', name: 'Auvergne-Rhône-Alpes', type: 'Metropolitan region' },
    { code: 'FR-01', name: 'Ain', parent: 'FR-ARA', type: 'Metropolitan department' },
    { code: 'US-CA', name: 'California', type: 'State' },
  ],
};

describe('subdivisionsToStateDefinitions', () => {
  const subdivisions = [
    { code: 'FR-ARA', name: 'Auvergne-Rhône-Alpes' },
    { code: 'FR-01', name: 'Ain', parent: 'FR-ARA' },
    { code: 'US-CA', name: 'California' },
  ];

  it('keeps only top-level subdivisions by default', () => {
    expect(subdivisionsToStateDefinitions(subdivisions)).toStrictEqual([
      { country: 'FR', code: 'ARA', name: 'Auvergne-Rhône-Alpes' },
      { country: 'US', code: 'CA', name: 'California' },
    ]);
  });

  it('keeps every level with allLevels, in source order', () => {
    expect(
      subdivisionsToStateDefinitions(subdivisions, { allLevels: true }).map((d) => `${d.country}-${d.code}`),
    ).toStrictEqual(['FR-ARA', 'FR-01', 'US-CA']);
  });

  it('rejects an entry parseStateDefinitions would reject', () => {
    expect(() => subdivisionsToStateDefinitions([{ code: 'FR-TOOLONG', name: 'Nope' }])).toThrow(
      /Invalid state key "FR-TOOLONG"/,
    );
  });
});

describe('fetchIsoCodesStateDefinitions (debian)', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
  });

  afterEach(async () => {
    await agent.close();
  });

  const fetchDebian = (
    options: Partial<FetchIsoCodesStateDefinitionsOptions> = {},
  ): ReturnType<typeof fetchIsoCodesStateDefinitions> =>
    fetchIsoCodesStateDefinitions({
      source: 'debian',
      dispatcher: agent,
      initialRetryDelay: Duration.milliseconds(1),
      ...options,
    });

  async function failure(promise: Promise<unknown>): Promise<Error & { name: string; actions?: string[] }> {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error('Expected a failure.');
  }

  it('lists debian as the only source', () => {
    expect(ISO_CODES_SOURCE_IDS).toStrictEqual(['debian']);
  });

  it('downloads a pinned version without looking up tags', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(200, DATA);

    const result = await fetchDebian({ version: 'v4.20.1' });

    expect(result).toStrictEqual({
      source: 'debian',
      label: 'Debian iso-codes',
      version: 'v4.20.1',
      url: `${SALSA}${dataPath('v4.20.1')}`,
      allLevels: false,
      definitions: [
        { country: 'FR', code: 'ARA', name: 'Auvergne-Rhône-Alpes' },
        { country: 'US', code: 'CA', name: 'California' },
      ],
    });
  });

  it('resolves the newest release tag when no version is given, skipping non-release tags', async () => {
    const salsa = agent.get(SALSA);
    salsa
      .intercept({ path: TAGS_PATH, method: 'GET' })
      .reply(200, [{ name: 'debian/4.21.0-1' }, { name: 'v4.21.0-rc1' }, { name: 'v4.20.1' }, { name: 'v4.20.0' }]);
    salsa.intercept({ path: dataPath('v4.20.1'), method: 'GET' }).reply(200, DATA);

    const result = await fetchDebian({ allLevels: true });

    expect(result.version).toBe('v4.20.1');
    expect(result.allLevels).toBe(true);
    expect(result.definitions).toHaveLength(3);
  });

  it('fails when no release tag exists', async () => {
    agent
      .get(SALSA)
      .intercept({ path: TAGS_PATH, method: 'GET' })
      .reply(200, [{ name: 'main-snapshot' }]);

    const error = await failure(fetchDebian());

    expect(error.name).toBe('IsoCodesDownloadError');
    expect(error.message).toContain("Couldn't find a release of Debian iso-codes");
  });

  it('accepts a branch and encodes each path segment', () => {
    expect(debianIsoCodesDataUrl('main')).toBe(`${SALSA}${dataPath('main')}`);
    expect(debianIsoCodesDataUrl('feature/a b')).toBe(`${SALSA}${dataPath('feature/a%20b')}`);
  });

  it('reports a version the source does not have', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v9.9.9'), method: 'GET' })
      .reply(404, 'Not Found');

    const error = await failure(fetchDebian({ version: 'v9.9.9' }));

    expect(error.name).toBe('IsoCodesVersionNotFoundError');
    expect(error.message).toBe('Debian iso-codes has no version "v9.9.9".');
    expect(error.actions?.[0]).toContain('/-/tags');
  });

  it('retries a 5xx and succeeds', async () => {
    const salsa = agent.get(SALSA);
    salsa.intercept({ path: dataPath('v4.20.1'), method: 'GET' }).reply(503, 'busy');
    salsa.intercept({ path: dataPath('v4.20.1'), method: 'GET' }).reply(200, DATA);

    expect((await fetchDebian({ version: 'v4.20.1' })).definitions).toHaveLength(2);
  });

  it('gives up after the configured retries, naming the URL', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(502, 'bad gateway')
      .times(2);

    const error = await failure(fetchDebian({ version: 'v4.20.1', retryAttempts: 1 }));

    expect(error.name).toBe('IsoCodesDownloadError');
    expect(error.message).toBe(
      `Couldn't download ISO 3166-2 data from Debian iso-codes (${SALSA}${dataPath('v4.20.1')}): HTTP 502.`,
    );
  });

  it('turns a timeout into a download error', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(200, DATA)
      .delay(200);

    const error = await failure(fetchDebian({ version: 'v4.20.1', requestTimeoutMs: 20, retryAttempts: 0 }));

    expect(error.name).toBe('IsoCodesDownloadError');
    expect(error.message).toContain('the request timed out');
  });

  it('does not retry or accept another 4xx', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(403, 'forbidden');

    const error = await failure(fetchDebian({ version: 'v4.20.1' }));

    expect(error.name).toBe('IsoCodesDownloadError');
    expect(error.message).toContain('HTTP 403');
  });

  it('rejects data in an unexpected shape', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(200, { '3166-2': [{ code: 'FR-ARA' }] });

    const error = await failure(fetchDebian({ version: 'v4.20.1' }));

    expect(error.name).toBe('InvalidIsoCodesDataError');
  });

  it('rejects a response that is not JSON', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(200, '<html>maintenance</html>');

    const error = await failure(fetchDebian({ version: 'v4.20.1' }));

    expect(error.name).toBe('IsoCodesDownloadError');
    expect(error.message).toContain('not valid JSON');
  });

  it('prefixes a validation failure with the source URL', async () => {
    agent
      .get(SALSA)
      .intercept({ path: dataPath('v4.20.1'), method: 'GET' })
      .reply(200, { '3166-2': [{ code: 'FR-TOOLONG', name: 'Nope' }] });

    const error = await failure(fetchDebian({ version: 'v4.20.1' }));

    expect(error.name).toBe('InvalidIsoCodesDataError');
    expect(error.message).toMatch(new RegExp(`^${SALSA}.*: Invalid state key "FR-TOOLONG"`));
  });

  it('rejects an unsupported source', async () => {
    const error = await failure(fetchDebian({ source: 'cldr' as IsoCodesSourceId }));

    expect(error.name).toBe('UnsupportedIsoCodesSourceError');
    expect(error.message).toBe('Unsupported ISO 3166-2 source "cldr". Supported: debian.');
  });
});
