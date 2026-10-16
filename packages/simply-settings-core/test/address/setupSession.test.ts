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

import type { Connection } from '@salesforce/core';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLoginPage,
  scriptRedirectTarget,
  SetupSession,
  SetupTransportError,
} from '../../src/address/setupSession.js';
import { fixture } from './fixtures.js';

const INSTANCE = 'https://acme.my.salesforce.com';
const SETUP = 'https://acme.my.salesforce-setup.com';
const TOKEN = '00D!SECRET-TOKEN';
const PROBE = '/i18n/ConfigureNewState.apexp?countryIso=US';

function fakeConnection(accessToken = TOKEN): {
  connection: Connection;
  refreshAuth: ReturnType<typeof vi.fn>;
} {
  const refreshAuth = vi.fn(async () => {});
  return {
    connection: { instanceUrl: INSTANCE, accessToken, refreshAuth } as unknown as Connection,
    refreshAuth,
  };
}

describe('SetupSession', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
  });

  afterEach(async () => {
    await agent.close();
  });

  async function openFailure(connection: Connection): Promise<Error> {
    try {
      await SetupSession.open({ connection, dispatcher: agent });
    } catch (error) {
      return error as Error;
    }
    throw new Error('Expected SetupSession.open to fail.');
  }

  it('opens with the access token as the sid cookie and carries cookies across hosts', async () => {
    const { connection, refreshAuth } = fakeConnection();
    const instance = agent.get(INSTANCE);
    const setup = agent.get(SETUP);
    let handoffCookie: string | undefined;

    instance.intercept({ path: PROBE, method: 'GET', headers: { cookie: `sid=${TOKEN}` } }).reply(302, '', {
      headers: { location: `${SETUP}/handoff?retURL=${encodeURIComponent(PROBE)}`, 'set-cookie': ['oid=ORG; Path=/'] },
    });
    // The token stays on the instance host; Salesforce hands the session over with a redirect that
    // sets the setup domain's own cookie.
    setup.intercept({ path: `/handoff?retURL=${encodeURIComponent(PROBE)}`, method: 'GET' }).reply(
      302,
      (options) => {
        handoffCookie = (options.headers as Record<string, string>).Cookie;
        return '';
      },
      { headers: { location: PROBE, 'set-cookie': ['sid=SETUP_SESSION; Path=/; Secure'] } },
    );
    setup
      .intercept({ path: PROBE, method: 'GET', headers: { cookie: 'sid=SETUP_SESSION' } })
      .reply(200, fixture('new-state-form.html'));

    const session = await SetupSession.open({ connection, dispatcher: agent });

    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(handoffCookie).toBeUndefined();

    instance
      .intercept({
        path: '/i18n/ConfigureNewState.apexp',
        method: 'POST',
        headers: { cookie: `sid=${TOKEN}; oid=ORG` },
      })
      .reply(200, 'ok');
    const response = await session.postForm('/i18n/ConfigureNewState.apexp', [['a', 'b c']]);
    expect(response.body).toBe('ok');
  });

  it('posts url-encoded fields without following the redirect', async () => {
    const { connection } = fakeConnection();
    const instance = agent.get(INSTANCE);
    instance.intercept({ path: PROBE, method: 'GET' }).reply(200, fixture('new-state-form.html'));
    const session = await SetupSession.open({ connection, dispatcher: agent });

    let sentBody = '';
    let sentType = '';
    instance.intercept({ path: '/i18n/ConfigureNewState.apexp', method: 'POST' }).reply(
      302,
      (options) => {
        sentBody = options.body as string;
        sentType = String((options.headers as Record<string, string>)['Content-Type']);
        return '';
      },
      { headers: { location: '/i18n/ConfigureCountry.apexp?countryIso=US&success=true' } },
    );

    const response = await session.postForm(`${INSTANCE}/i18n/ConfigureNewState.apexp`, [
      ['name', 'Zed & Co'],
      ['name', 'twice'],
    ]);

    expect(sentType).toBe('application/x-www-form-urlencoded');
    expect(sentBody).toBe('name=Zed+%26+Co&name=twice');
    expect(response.status).toBe(302);
    expect(response.location).toBe('/i18n/ConfigureCountry.apexp?countryIso=US&success=true');
  });

  it('fails when the connection has no access token', async () => {
    const { connection } = fakeConnection('');

    expect((await openFailure(connection)).message).toMatch(/no instance URL or access token/);
  });

  it('fails with the scope hint, without the token, when Setup answers with the login page', async () => {
    const { connection } = fakeConnection();
    agent
      .get(INSTANCE)
      .intercept({ path: PROBE, method: 'GET' })
      .reply(302, '', { headers: { location: 'https://login.salesforce.com/?ec=302' } });
    agent
      .get('https://login.salesforce.com')
      .intercept({ path: '/?ec=302', method: 'GET' })
      .reply(200, fixture('login.html'));

    const error = await openFailure(connection);

    expect(error.message).toMatch(/lack the `web` or `full` OAuth scope/);
    expect(JSON.stringify(error)).not.toMatch(/SECRET/);
  });

  it('never puts the token in a transport error', async () => {
    const { connection } = fakeConnection();
    agent.get(INSTANCE).intercept({ path: PROBE, method: 'GET' }).reply(503, 'down');

    const error = await openFailure(connection);

    expect(error.message).toBe("Couldn't open a Setup session: HTTP 503 from /i18n/ConfigureNewState.apexp.");
    expect(JSON.stringify(error)).not.toMatch(/SECRET/);
  });

  it("follows Salesforce's redirectOnLoad() script interstitials like HTTP redirects", async () => {
    const { connection } = fakeConnection();
    const instance = agent.get(INSTANCE);
    const setup = agent.get(SETUP);
    instance.intercept({ path: PROBE, method: 'GET' }).reply(200, scriptRedirect(`${SETUP}\\/handoff?retURL\\x3d1`));
    setup
      .intercept({ path: '/handoff?retURL=1', method: 'GET' })
      .reply(200, scriptRedirect(PROBE), { headers: { 'set-cookie': ['sid=SETUP_SESSION; Path=/'] } });
    setup
      .intercept({ path: PROBE, method: 'GET', headers: { cookie: 'sid=SETUP_SESSION' } })
      .reply(200, fixture('new-state-form.html'));

    await expect(SetupSession.open({ connection, dispatcher: agent })).resolves.toBeInstanceOf(SetupSession);
  });

  it('fails with the identity-verification hint when Salesforce holds the user at MFA registration', async () => {
    const { connection } = fakeConnection();
    const instance = agent.get(INSTANCE);
    instance
      .intercept({ path: PROBE, method: 'GET' })
      .reply(200, scriptRedirect(`${INSTANCE}/identity/twofactor/addTwoFactorOnly.apexp`));
    instance
      .intercept({ path: '/identity/twofactor/addTwoFactorOnly.apexp', method: 'GET' })
      .reply(200, '<html><body>Register</body></html>');

    const error = await openFailure(connection);

    expect(error.message).toMatch(/identity-verification step/);
    expect(JSON.stringify(error)).not.toMatch(/SECRET/);
  });

  it('throws a retryable SetupTransportError for a 5xx', async () => {
    const { connection } = fakeConnection();
    const instance = agent.get(INSTANCE);
    instance.intercept({ path: PROBE, method: 'GET' }).reply(200, fixture('new-state-form.html'));
    const session = await SetupSession.open({ connection, dispatcher: agent });
    instance.intercept({ path: PROBE, method: 'GET' }).reply(502, 'bad gateway');

    await expect(session.get(PROBE)).rejects.toBeInstanceOf(SetupTransportError);
  });
});

/** The interstitial Salesforce answers with in place of a 3xx (scrubbed from a real org). */
function scriptRedirect(target: string): string {
  return `<html><head><script>
function redirectOnLoad() {
if (this.SfdcApp && this.SfdcApp.projectOneNavigator) { SfdcApp.projectOneNavigator.handleRedirect('${target}'); }
else if (window.location.replace){ window.location.replace('${target}'); }
else { window.location.href ='${target}'; }
}
redirectOnLoad();
</script></head></html>`;
}

describe('scriptRedirectTarget', () => {
  const base = new URL(`${INSTANCE}${PROBE}`);

  it('resolves and unescapes the target', () => {
    expect(scriptRedirectTarget(scriptRedirect('\\/home\\x3fa\\u003d1'), base)?.href).toBe(`${INSTANCE}/home?a=1`);
  });

  it.each([
    ['an ordinary page', fixture('new-state-form.html')],
    ['a non-https target', scriptRedirect('http://evil.example/')],
    ['a replace() without the interstitial', "<script>window.location.replace('/x')</script>"],
  ])('ignores %s', (_, body) => {
    expect(scriptRedirectTarget(body, base)).toBeUndefined();
  });
});

describe('isLoginPage', () => {
  it.each([
    ['https://login.salesforce.com/?ec=302', ''],
    ['https://test.salesforce.com/', ''],
    ['https://acme.my.salesforce.com/', ''],
    ['https://acme.my.salesforce.com/login/thing', ''],
    ['https://acme.my.salesforce.com/i18n/ConfigureNewState.apexp', fixture('login.html')],
  ])('recognizes %s', (url, body) => {
    expect(isLoginPage({ url, body })).toBe(true);
  });

  it('accepts the Setup page itself', () => {
    expect(isLoginPage({ url: `${INSTANCE}${PROBE}`, body: fixture('new-state-form.html') })).toBe(false);
  });

  it('stays linear on many unclosed forms (CodeQL: polynomial regex)', () => {
    const started = performance.now();
    expect(isLoginPage({ url: `${INSTANCE}${PROBE}`, body: '<form'.repeat(50_000) })).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
