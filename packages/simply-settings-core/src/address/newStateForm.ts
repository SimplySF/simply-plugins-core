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

import type { StateDefinition } from './stateDefinitions.js';

/** Setup's "Configure New State" form, as found in the page. */
export type NewStateForm = {
  /** The form's `action`, as written in the page (may be relative). */
  action: string;
  /**
   * Every field a browser would submit before the user touches anything — hidden inputs (the
   * Visualforce view state among them), checked checkboxes, and text inputs at their default.
   */
  fields: Array<[string, string]>;
  /** The `name`s of the inputs `fillNewStateForm` sets. */
  nameField: string;
  codeField: string;
  integrationValueField: string;
  /** The Add button's `name` and `value`. */
  addButton: [string, string];
};

export type NewStateResponseStatus = 'created' | 'exists' | 'rejected' | 'country-missing' | 'failed';

export type NewStateResponseClassification = {
  status: NewStateResponseStatus;
  /** Salesforce's own message, where it gave one. */
  message?: string;
};

// The Visualforce component ids are generated (`configurenew:j_id1:blockNew:j_id9:…`) and shift
// whenever Salesforce changes the page, so fields are recognized by their stable suffixes only.
const NAME_SUFFIX = ':editName';
const CODE_SUFFIX = ':editIsoCode';
const INTEGRATION_VALUE_SUFFIX = ':editIntVal';
const ADD_BUTTON_SUFFIX = ':addButton';

const FORM_PATTERN = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
// Either a `<textarea>`/`<select>` with its content (groups 1-3), or a void `<input>` (group 4).
const CONTROL_PATTERN = /<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<input\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const OPTION_PATTERN = /<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/select>|$)/gi;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, body: string) => {
    if (body.startsWith('#')) {
      const codePoint = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
    }
  }
  return attributes;
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function selectedOption(optionsHtml: string): string | undefined {
  let first: string | undefined;
  for (const match of optionsHtml.matchAll(OPTION_PATTERN)) {
    const attributes = parseAttributes(match[1]);
    const value = attributes.get('value') ?? htmlToText(match[2]);
    if (attributes.has('selected')) return value;
    first ??= value;
  }
  return first;
}

/**
 * What a browser submits for a form control nobody touched, or `undefined` if it submits nothing
 * (an unchecked box, a button other than the one clicked).
 */
function defaultSubmission(tag: string, attributes: Map<string, string>, content: string): string | undefined {
  if (tag === 'textarea') return decodeEntities(content);
  if (tag === 'select') return selectedOption(content);

  const type = (attributes.get('type') ?? 'text').toLowerCase();
  if (type === 'checkbox' || type === 'radio') {
    return attributes.has('checked') ? (attributes.get('value') ?? 'on') : undefined;
  }
  if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return undefined;
  return attributes.get('value') ?? '';
}

/**
 * Finds the "Configure New State" form in a `/i18n/ConfigureNewState.apexp` page.
 *
 * @param html - The page.
 * @returns The form, or `undefined` if no form has all four expected fields — the signal that
 * Salesforce changed the page (or that this isn't the page at all, e.g. a login page).
 */
export function parseNewStateForm(html: string): NewStateForm | undefined {
  for (const [, formAttributes, formBody] of html.matchAll(FORM_PATTERN)) {
    const fields: Array<[string, string]> = [];
    let nameField: string | undefined;
    let codeField: string | undefined;
    let integrationValueField: string | undefined;
    let addButton: [string, string] | undefined;

    for (const [, contentTag, contentAttributes, content, inputAttributes] of formBody.matchAll(CONTROL_PATTERN)) {
      const attributes = parseAttributes(contentAttributes ?? inputAttributes);
      const name = attributes.get('name');
      if (!name || attributes.has('disabled')) continue;

      if (name.endsWith(NAME_SUFFIX)) nameField = name;
      else if (name.endsWith(CODE_SUFFIX)) codeField = name;
      else if (name.endsWith(INTEGRATION_VALUE_SUFFIX)) integrationValueField = name;
      else if (name.endsWith(ADD_BUTTON_SUFFIX)) addButton = [name, attributes.get('value') ?? ''];
      else {
        const value = defaultSubmission(contentTag?.toLowerCase() ?? 'input', attributes, content);
        if (value !== undefined) fields.push([name, value]);
      }
    }

    if (nameField && codeField && integrationValueField && addButton) {
      return {
        action: parseAttributes(formAttributes).get('action') ?? '',
        fields,
        nameField,
        codeField,
        integrationValueField,
        addButton,
      };
    }
  }

  return undefined;
}

/**
 * The fields to POST to add one state: the form's own fields, the state's name, code, and
 * integration value (the name, as the upstream Apex does), and the Add button.
 *
 * @param form - From {@link parseNewStateForm}.
 * @param definition - The state to add.
 * @returns Name/value pairs in submission order.
 */
export function fillNewStateForm(form: NewStateForm, definition: StateDefinition): Array<[string, string]> {
  return [
    ...form.fields,
    [form.nameField, definition.name],
    [form.codeField, definition.code],
    [form.integrationValueField, definition.name],
    form.addButton,
  ];
}

/**
 * The text right after `marker`: skips any closing tags that immediately follow it (the
 * `<h4>Error:</h4></span>` case), then reads up to the next closing block-level tag.
 */
function textAfter(body: string, marker: string): string | undefined {
  const start = body.indexOf(marker);
  if (start === -1) return undefined;
  const rest = body.slice(start + marker.length).replace(/^(?:\s*<\/[^>]+>)+/, '');
  const end = rest.search(/<\/(?:li|div|td|span|p)\s*>/i);
  const message = htmlToText(rest.slice(0, end === -1 ? 500 : end));
  return message || undefined;
}

const ALREADY_EXISTS_PATTERN = /already (?:exists|in use|used)|duplicate/i;
const ERRORS_MARKER = '<h4>Errors</h4>';
const ERROR_MARKER = '<h4>Error:</h4>';

/**
 * Classifies the response to a "Configure New State" POST. The markers are the ones the
 * mattandneil/statecodes Apex batch matched on, checked in the same order.
 *
 * @param response - The POST's status, unfollowed redirect `location`, and body.
 * @returns The outcome, with Salesforce's message where there was one.
 */
export function classifyNewStateResponse(response: {
  status: number;
  location?: string;
  body: string;
}): NewStateResponseClassification {
  const { body } = response;

  // A validation failure re-renders the form with the error(s) in a page message.
  if (body.includes(ERRORS_MARKER) || body.includes(ERROR_MARKER)) {
    const message =
      (body.includes(ERRORS_MARKER)
        ? (textAfter(body, '<li style="padding-top:5px">') ?? textAfter(body, ERRORS_MARKER))
        : textAfter(body, ERROR_MARKER)) ?? 'Salesforce rejected the state without a message.';
    return { status: ALREADY_EXISTS_PATTERN.test(message) ? 'exists' : 'rejected', message };
  }

  if (body.includes('You are missing information')) {
    return { status: 'country-missing' };
  }

  if (response.location?.includes('success=true') || body.includes('success=true')) {
    return { status: 'created' };
  }

  return { status: 'failed', message: `Unrecognized response from Setup (HTTP ${response.status}).` };
}
