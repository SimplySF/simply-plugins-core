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
import { describe, expect, it, vi } from 'vitest';
import { parseAddressSettingsXml } from '../../src/address/addressSettingsXml.js';
import { createState, createStates, planStateCreation } from '../../src/address/createStates.js';
import { SetupTransportError, type SetupResponse, type SetupSession } from '../../src/address/setupSession.js';
import { parseStateDefinitions, type StateDefinition } from '../../src/address/stateDefinitions.js';
import { fixture } from './fixtures.js';

const FORM_URL = 'https://acme.my.salesforce.com/i18n/ConfigureNewState.apexp';
const noDelay = { initialRetryDelay: Duration.milliseconds(1) };

type FakeSession = {
  session: SetupSession;
  get: ReturnType<typeof vi.fn>;
  postForm: ReturnType<typeof vi.fn>;
};

function fakeSession(
  post: (fields: Array<[string, string]>) => Promise<Omit<SetupResponse, 'url'>> = async () => ({
    status: 200,
    body: fixture('post-success.html'),
  }),
  page = fixture('new-state-form.html'),
): FakeSession {
  const get = vi.fn(async (path: string) => ({ status: 200, url: new URL(path, FORM_URL).toString(), body: page }));
  const postForm = vi.fn(async (_url: URL, fields: Array<[string, string]>) => ({
    url: FORM_URL,
    ...(await post(fields)),
  }));
  return { session: { get, postForm } as unknown as SetupSession, get, postForm };
}

const zed: StateDefinition = { country: 'US', code: 'ZZ', name: 'Zed' };

describe('planStateCreation', () => {
  it('settles existing states and missing countries without traffic, case-insensitively', () => {
    const settings = parseAddressSettingsXml(fixture('Address.settings-meta.xml'));
    const plan = planStateCreation(
      parseStateDefinitions({ 'US-CA': 'California', 'US-ZZ': 'Zed', 'FR-75': 'Paris', 'AD-02': 'Canillo' }),
      settings,
    );

    expect(plan.pending).toStrictEqual([zed]);
    expect(plan.settled.map((outcome) => [outcome.country, outcome.code, outcome.status])).toStrictEqual([
      ['US', 'CA', 'exists'],
      ['FR', '75', 'country-missing'],
      ['AD', '02', 'exists'],
    ]);
  });
});

describe('createState', () => {
  it('loads the form for the country and posts it back to its action', async () => {
    const { session, get, postForm } = fakeSession();

    const outcome = await createState(session, zed, noDelay);

    expect(outcome).toStrictEqual({ ...zed, status: 'created' });
    expect(get).toHaveBeenCalledWith('/i18n/ConfigureNewState.apexp?countryIso=US');
    const [url, fields] = postForm.mock.calls[0] as [URL, Array<[string, string]>];
    expect(url.toString()).toBe(FORM_URL);
    expect(fields).toContainEqual(['configurenew:j_id1:blockNew:j_id9:codeSectionItem:editIsoCode', 'ZZ']);
  });

  it("carries Salesforce's message on a rejection", async () => {
    const { session } = fakeSession(async () => ({ status: 200, body: fixture('post-rejected.html') }));

    expect(await createState(session, zed, noDelay)).toMatchObject({ status: 'rejected', message: /80 characters/ });
  });

  it('fails without posting when the form is not recognized', async () => {
    const { session, postForm } = fakeSession(undefined, '<html><form><input name="x"></form></html>');

    expect(await createState(session, zed, noDelay)).toMatchObject({
      status: 'failed',
      message: /Setup form layout not recognized/,
    });
    expect(postForm).not.toHaveBeenCalled();
  });

  it('says so when the session has expired', async () => {
    const { session } = fakeSession(undefined, fixture('login.html'));

    expect(await createState(session, zed, noDelay)).toMatchObject({ status: 'failed', message: /session expired/ });
  });

  it('retries a transport failure, and a retried POST that had landed comes back as exists', async () => {
    let attempt = 0;
    const { session, postForm } = fakeSession(async () => {
      attempt++;
      if (attempt === 1) throw new SetupTransportError('HTTP 503 from /i18n/ConfigureNewState.apexp');
      return { status: 200, body: fixture('post-errors.html') };
    });

    expect(await createState(session, zed, noDelay)).toMatchObject({ status: 'exists' });
    expect(postForm).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transport error, reporting it as failed', async () => {
    const { session, postForm } = fakeSession(async () => {
      throw new Error('boom');
    });

    expect(await createState(session, zed, noDelay)).toStrictEqual({ ...zed, status: 'failed', message: 'boom' });
    expect(postForm).toHaveBeenCalledOnce();
  });

  it('gives up after the configured retries', async () => {
    const { session, postForm } = fakeSession(async () => {
      throw new SetupTransportError('HTTP 503 from /i18n/ConfigureNewState.apexp');
    });

    expect(await createState(session, zed, { ...noDelay, retryAttempts: 1 })).toMatchObject({
      status: 'failed',
      message: 'HTTP 503 from /i18n/ConfigureNewState.apexp',
    });
    expect(postForm).toHaveBeenCalledTimes(2);
  });
});

describe('createStates', () => {
  const states = parseStateDefinitions({ 'US-AA': 'A', 'US-BB': 'B', 'US-CC': 'C', 'US-DD': 'D', 'US-EE': 'E' });

  it('returns outcomes in input order, reports each as it finishes, and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const { session } = fakeSession(async (fields) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Finish in reverse order of submission, so completion order differs from input order.
      const code = fields.find(([name]) => name.endsWith(':editIsoCode'))![1];
      await new Promise((resolve) => setTimeout(resolve, 25 - code.charCodeAt(0) + 60));
      inFlight--;
      return { status: 200, body: fixture('post-success.html') };
    });
    const progress: string[] = [];

    const outcomes = await createStates({
      session,
      states,
      concurrency: 2,
      onProgress: (outcome) => progress.push(outcome.code),
      ...noDelay,
    });

    expect(outcomes.map((outcome) => outcome.code)).toStrictEqual(['AA', 'BB', 'CC', 'DD', 'EE']);
    expect(outcomes.every((outcome) => outcome.status === 'created')).toBe(true);
    expect(progress).toHaveLength(5);
    expect(peak).toBe(2);
  });
});
