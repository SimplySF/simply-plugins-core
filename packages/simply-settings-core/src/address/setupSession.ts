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

import { SfError, type Connection } from '@salesforce/core';
import { fetch, type Dispatcher } from 'undici';

/** A Setup page response, after any redirects were followed. */
export type SetupResponse = {
  status: number;
  /** The URL the response came from (the last one, for a followed redirect chain). */
  url: string;
  /** The `Location` header of an unfollowed redirect. */
  location?: string;
  body: string;
};

export type OpenSetupSessionOptions = {
  connection: Connection;
  /** Bounds each HTTP request. Defaults to 60 seconds — the upstream Apex used the same. */
  requestTimeoutMs?: number;
  /** For tests: an `undici` `MockAgent`, or any other dispatcher. */
  dispatcher?: Dispatcher;
};

/**
 * Thrown for a transport-level failure talking to Setup (a 5xx, or a redirect loop) — the kind of
 * error worth retrying, as opposed to a page that came back with content we can classify.
 */
export class SetupTransportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SetupTransportError';
  }
}

/** The page `openSetupSession` loads to prove the session reaches Setup. */
export const NEW_STATE_FORM_PATH = '/i18n/ConfigureNewState.apexp';

const MAX_REDIRECTS = 10;

type StoredCookie = { name: string; value: string; domain: string; hostOnly: boolean };

/**
 * A minimal cookie jar: enough to carry Salesforce's session cookies across the frontdoor redirect
 * chain and between `*.my.salesforce.com` and `*.my.salesforce-setup.com`. Paths and expiry dates
 * aren't tracked — every request here is to a Setup page, and the jar lives for one command run.
 */
class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  public store(url: URL, setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const [pair, ...attributes] = header.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;

      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      let domain = url.hostname;
      let hostOnly = true;
      let expired = value === '';

      for (const attribute of attributes) {
        const [rawKey, ...rest] = attribute.split('=');
        const key = rawKey.trim().toLowerCase();
        const attributeValue = rest.join('=').trim();
        if (key === 'domain' && attributeValue) {
          domain = attributeValue.replace(/^\./, '').toLowerCase();
          hostOnly = false;
        } else if (key === 'max-age' && Number(attributeValue) <= 0) {
          expired = true;
        } else if (key === 'expires' && Date.parse(attributeValue) < Date.now()) {
          expired = true;
        }
      }

      const id = `${domain}|${name}`;
      if (expired) {
        this.cookies.delete(id);
      } else {
        this.cookies.set(id, { name, value, domain, hostOnly });
      }
    }
  }

  public header(url: URL): string | undefined {
    const host = url.hostname.toLowerCase();
    const matching = [...this.cookies.values()].filter((cookie) =>
      cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith(`.${cookie.domain}`),
    );
    return matching.length > 0 ? matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') : undefined;
  }
}

// Salesforce often redirects with a 200 page whose only job is to run `window.location.replace('…')`
// (its `redirectOnLoad()` interstitial) instead of with a 3xx: on the hop from `*.my.salesforce.com`
// to `*.my.salesforce-setup.com`, and to identity-verification pages, among others. The target
// pattern stays inside one single-quoted JS string (`[^'<>\\]` or an escape), which keeps it linear.
const SCRIPT_REDIRECT_MARKER = /\bfunction\s+redirectOnLoad\s*\(/;
const SCRIPT_REDIRECT_TARGET = /\bwindow\.location\.replace\(\s*'((?:[^'<>\\]|\\.)*)'\s*\)/;

function decodeJsString(value: string): string {
  return value.replace(
    /\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|(.))/gi,
    (_, hex?: string, unicode?: string, char?: string) => {
      const code = hex ?? unicode;
      return code ? String.fromCharCode(parseInt(code, 16)) : (char ?? '');
    },
  );
}

/**
 * Where a Salesforce `redirectOnLoad()` interstitial sends the browser, if the page is one.
 *
 * @param body - The page.
 * @param base - The page's URL, to resolve a relative target against.
 * @returns The absolute `https:` target, or `undefined` for any other page.
 */
export function scriptRedirectTarget(body: string, base: URL): URL | undefined {
  if (!SCRIPT_REDIRECT_MARKER.test(body)) return undefined;
  const match = SCRIPT_REDIRECT_TARGET.exec(body);
  if (!match) return undefined;
  try {
    const target = new URL(decodeJsString(match[1]), base);
    return target.protocol === 'https:' ? target : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether Salesforce sent the user to an identity-verification step (registering for multi-factor
 * authentication, verifying a device) instead of the page that was asked for. Only a person in a
 * browser can complete one, so there's no point retrying.
 *
 * @param response - The response to check.
 * @returns `true` for an identity-verification page.
 */
export function isIdentityVerificationPage(response: Pick<SetupResponse, 'url'>): boolean {
  const { pathname } = new URL(response.url);
  return pathname.startsWith('/identity/') || pathname.startsWith('/_ui/identity/');
}

/** Why a Setup session can't be used while Salesforce is holding the user at an identity check. */
export const IDENTITY_VERIFICATION_MESSAGE =
  'Salesforce wants this user to complete an identity-verification step (such as registering for multi-factor authentication) before it opens Setup.';

/**
 * Whether a page is Salesforce's login page rather than the Setup page that was asked for — what
 * comes back when the session cookie is missing, expired, or was never granted.
 *
 * @param response - The response to check.
 * @returns `true` for a login page.
 */
export function isLoginPage(response: Pick<SetupResponse, 'url' | 'body'>): boolean {
  const { hostname, pathname } = new URL(response.url);
  return (
    hostname.startsWith('login.') ||
    hostname.startsWith('test.') ||
    pathname === '/' ||
    pathname.startsWith('/login') ||
    // `[^<>]`, not `[^>]`: a match can't run past the next tag, which keeps this linear on input
    // like thousands of unclosed `<form`s.
    /<form[^<>]+id=["']login_form["']/i.test(response.body)
  );
}

/** An authenticated browser-style session against an org's Setup pages. */
export class SetupSession {
  private readonly jar = new CookieJar();

  private constructor(
    private readonly baseUrl: string,
    private readonly requestTimeoutMs: number,
    private readonly dispatcher?: Dispatcher,
  ) {}

  /**
   * Opens a session through a single-use frontdoor URL from the `/services/oauth2/singleaccess`
   * endpoint — the same mechanism `sf org open` uses (`Org.getFrontDoorUrl`) — then confirms the
   * session actually reaches Setup.
   *
   * @param options - The connection, plus an optional timeout and dispatcher.
   * @returns The opened session.
   * @throws SfError (`SetupSessionError`) when no frontdoor URL is issued, or the org answers with a
   * login page — typically an OAuth token without the `web` or `full` scope.
   */
  public static async open(options: OpenSetupSessionOptions): Promise<SetupSession> {
    const { connection } = options;
    const scopeError = new SfError(
      "Couldn't open a Setup session with this org's credentials. The auth may lack the `web` or `full` OAuth scope.",
      'SetupSessionError',
      ['Re-authorize with `sf org login web`, which grants a token that can open Setup pages.'],
    );

    // `singleaccess` answers an expired token with a 403, which jsforce doesn't treat as a cue to
    // refresh — so refresh up front, as `Org.getFrontDoorUrl` does.
    await connection.refreshAuth();

    if (!connection.instanceUrl) {
      throw new SfError('The connection has no instance URL.', 'SetupSessionError');
    }

    const probe = `${NEW_STATE_FORM_PATH}?countryIso=US`;
    const singleAccessUrl = new URL('/services/oauth2/singleaccess', connection.instanceUrl);
    singleAccessUrl.searchParams.append('redirect_uri', probe);

    let frontdoor: string | undefined;
    try {
      frontdoor = (await connection.requestGet<{ frontdoor_uri?: string }>(singleAccessUrl.toString())).frontdoor_uri;
    } catch {
      throw scopeError;
    }
    if (!frontdoor) {
      throw scopeError;
    }

    const session = new SetupSession(connection.instanceUrl, options.requestTimeoutMs ?? 60_000, options.dispatcher);

    let response: SetupResponse;
    try {
      response = await session.get(frontdoor);
    } catch (error) {
      // Never let the frontdoor URL (it carries a one-time token) leak into an error message.
      throw new SfError(
        `Couldn't open a Setup session: ${error instanceof SetupTransportError ? error.message : 'the request failed'}.`,
        'SetupSessionError',
      );
    }

    if (isIdentityVerificationPage(response)) {
      throw new SfError(IDENTITY_VERIFICATION_MESSAGE, 'SetupSessionError', [
        'Log in to the org in a browser as this user, complete the step, then run the command again.',
      ]);
    }
    if (response.status !== 200 || isLoginPage(response)) {
      throw scopeError;
    }

    return session;
  }

  /**
   * GETs a Setup page, following redirects: HTTP ones, and Salesforce's `redirectOnLoad()` script
   * interstitials, which a browser follows too.
   *
   * @param pathOrUrl - A path relative to the org's instance URL, or an absolute URL.
   * @returns The final response.
   */
  public async get(pathOrUrl: string): Promise<SetupResponse> {
    let url = new URL(pathOrUrl, this.baseUrl);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      // eslint-disable-next-line no-await-in-loop -- each hop depends on the previous one's Location
      const response = await this.send(url, { method: 'GET' });
      if (response.location !== undefined) {
        url = new URL(response.location, url);
        continue;
      }
      const scriptTarget = response.status === 200 ? scriptRedirectTarget(response.body, url) : undefined;
      if (scriptTarget === undefined) {
        return response;
      }
      url = scriptTarget;
    }

    throw new SetupTransportError(`Too many redirects loading ${new URL(pathOrUrl, this.baseUrl).pathname}`);
  }

  /**
   * POSTs a form as `application/x-www-form-urlencoded`, without following any redirect — a
   * Visualforce postback signals success through where it redirects to.
   *
   * @param url - The form's action URL.
   * @param fields - Name/value pairs, in order; a name may repeat.
   * @returns The response, with `location` set if it was a redirect.
   */
  public async postForm(url: URL | string, fields: Array<[string, string]>): Promise<SetupResponse> {
    return this.send(new URL(url, this.baseUrl), {
      method: 'POST',
      body: new URLSearchParams(fields).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
  }

  private async send(
    url: URL,
    request: { method: string; body?: string; contentType?: string },
  ): Promise<SetupResponse> {
    const headers: Record<string, string> = { Accept: 'text/html,application/xhtml+xml' };
    const cookie = this.jar.header(url);
    if (cookie) headers.Cookie = cookie;
    if (request.contentType) headers['Content-Type'] = request.contentType;

    const response = await fetch(url, {
      method: request.method,
      body: request.body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      dispatcher: this.dispatcher,
    });

    this.jar.store(url, response.headers.getSetCookie());
    const body = await response.text();

    if (response.status >= 500) {
      throw new SetupTransportError(`HTTP ${response.status} from ${url.pathname}`);
    }

    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    return { status: response.status, url: url.toString(), location: location ?? undefined, body };
  }
}

/**
 * Opens a {@link SetupSession}. See {@link SetupSession.open}.
 *
 * @param options - The connection, plus an optional timeout and dispatcher.
 * @returns The opened session.
 */
export async function openSetupSession(options: OpenSetupSessionOptions): Promise<SetupSession> {
  return SetupSession.open(options);
}
