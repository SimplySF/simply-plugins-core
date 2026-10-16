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
import { mapConcurrent, retryWithBackoff } from '@simplysf/simply-core';
import type { AddressSettings } from './addressSettingsXml.js';
import { classifyNewStateResponse, fillNewStateForm, parseNewStateForm } from './newStateForm.js';
import {
  IDENTITY_VERIFICATION_MESSAGE,
  isIdentityVerificationPage,
  isLoginPage,
  NEW_STATE_FORM_PATH,
  SetupTransportError,
  type SetupSession,
} from './setupSession.js';
import type { StateDefinition } from './stateDefinitions.js';

export type StateCreationStatus =
  | 'created'
  | 'exists'
  | 'country-missing'
  | 'rejected'
  | 'failed'
  /** `--dry-run`: the state is missing and would be submitted. */
  | 'would-create';

export type StateCreationOutcome = StateDefinition & {
  status: StateCreationStatus;
  /** Salesforce's message, or why the attempt failed. */
  message?: string;
};

export type StateCreationPlan = {
  /** States missing from a country the org has — the ones to submit. */
  pending: StateDefinition[];
  /** States settled without any Setup traffic: `exists` or `country-missing`. */
  settled: StateCreationOutcome[];
};

export type CreateStateOptions = {
  /** Additional attempts after a transport failure (timeout, reset, 5xx). Defaults to 2. */
  retryAttempts?: number;
  /** Delay before the first retry; doubles after each. Defaults to 2 seconds. */
  initialRetryDelay?: Duration;
};

export type CreateStatesOptions = CreateStateOptions & {
  session: SetupSession;
  states: StateDefinition[];
  /** How many states are submitted at once. Defaults to 4. */
  concurrency?: number;
  /** Called as each state finishes, in completion order. */
  onProgress?: (outcome: StateCreationOutcome) => void;
};

export const DEFAULT_CREATE_CONCURRENCY = 4;

/**
 * Sorts definitions into those that need submitting and those the org's current settings already
 * answer for — so a re-run, or a run over a mostly-populated org, sends no Setup traffic for them.
 *
 * @param definitions - The states asked for.
 * @param settings - The org's current AddressSettings.
 * @returns The plan.
 */
export function planStateCreation(definitions: StateDefinition[], settings: AddressSettings): StateCreationPlan {
  const statesByCountry = new Map(
    settings.countries.map((country) => [
      country.isoCode.toUpperCase(),
      new Set(country.states.map((state) => state.isoCode.toUpperCase())),
    ]),
  );

  const plan: StateCreationPlan = { pending: [], settled: [] };
  for (const definition of definitions) {
    const states = statesByCountry.get(definition.country);
    if (!states) {
      plan.settled.push({ ...definition, status: 'country-missing' });
    } else if (states.has(definition.code)) {
      plan.settled.push({ ...definition, status: 'exists' });
    } else {
      plan.pending.push(definition);
    }
  }
  return plan;
}

function isTransportError(error: unknown): boolean {
  if (error instanceof SetupTransportError) return true;
  if (!(error instanceof Error)) return false;
  // undici's `fetch` rejects with `TypeError: fetch failed` for socket-level failures, and
  // `AbortSignal.timeout` with a `TimeoutError` DOMException.
  return (error instanceof TypeError && error.message === 'fetch failed') || error.name === 'TimeoutError';
}

/**
 * Adds one state through Setup's "Configure New State" form: loads the form for the state's
 * country, fills it in, and posts it back.
 *
 * Never throws for a per-state problem — that's reported as a `failed` outcome, so one bad state
 * doesn't stop a run of thousands. Transport failures are retried first; re-posting is safe
 * because a retry of a POST that did land comes back as a duplicate (`exists`).
 *
 * @param session - An open Setup session.
 * @param definition - The state to add.
 * @param options - Retry tuning.
 * @returns The outcome.
 */
export async function createState(
  session: SetupSession,
  definition: StateDefinition,
  options: CreateStateOptions = {},
): Promise<StateCreationOutcome> {
  const retry = <T>(fn: () => Promise<T>): Promise<T> =>
    retryWithBackoff(fn, {
      retryAttempts: options.retryAttempts ?? 2,
      backoffFactor: 2,
      initialDelay: options.initialRetryDelay ?? Duration.seconds(2),
      shouldRetry: isTransportError,
    });

  try {
    const page = await retry(() =>
      session.get(`${NEW_STATE_FORM_PATH}?countryIso=${encodeURIComponent(definition.country)}`),
    );
    const form = parseNewStateForm(page.body);

    if (!form) {
      return {
        ...definition,
        status: 'failed',
        message: isIdentityVerificationPage(page)
          ? IDENTITY_VERIFICATION_MESSAGE
          : isLoginPage(page)
            ? 'The Setup session expired or was rejected.'
            : 'Setup form layout not recognized — Salesforce may have changed the Configure New State page.',
      };
    }

    const response = await retry(() =>
      session.postForm(new URL(form.action || page.url, page.url), fillNewStateForm(form, definition)),
    );
    return { ...definition, ...classifyNewStateResponse(response) };
  } catch (error) {
    return { ...definition, status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Adds many states, `concurrency` at a time. See {@link createState}.
 *
 * @param options - The session, the states, and concurrency/retry/progress options.
 * @returns One outcome per state, in the order `states` was given.
 */
export async function createStates(options: CreateStatesOptions): Promise<StateCreationOutcome[]> {
  const outcomes = new Array<StateCreationOutcome>(options.states.length);
  const indexed = options.states.map((definition, index) => ({ definition, index }));

  for await (const { index, outcome } of mapConcurrent(
    indexed,
    options.concurrency ?? DEFAULT_CREATE_CONCURRENCY,
    async ({ definition, index: position }) => ({
      index: position,
      outcome: await createState(options.session, definition, options),
    }),
  )) {
    outcomes[index] = outcome;
    options.onProgress?.(outcome);
  }

  return outcomes;
}
