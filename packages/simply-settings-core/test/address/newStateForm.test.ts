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

import { describe, expect, it } from 'vitest';
import { classifyNewStateResponse, fillNewStateForm, parseNewStateForm } from '../../src/address/newStateForm.js';
import { fixture } from './fixtures.js';

const PREFIX = 'configurenew:j_id1:blockNew';

describe('parseNewStateForm', () => {
  it('finds the new-state form among others and collects what a browser would submit', () => {
    const form = parseNewStateForm(fixture('new-state-form.html'));

    expect(form).toBeDefined();
    expect(form!.action).toBe('/i18n/ConfigureNewState.apexp');
    expect(form!.nameField).toBe(`${PREFIX}:j_id9:nameSectionItem:editName`);
    expect(form!.codeField).toBe(`${PREFIX}:j_id9:codeSectionItem:editIsoCode`);
    expect(form!.integrationValueField).toBe(`${PREFIX}:j_id9:intValSectionItem:editIntVal`);
    expect(form!.addButton).toStrictEqual([`${PREFIX}:j_id43:addButton`, 'Add']);
    expect(form!.fields).toStrictEqual([
      ['configurenew:j_id1', 'configurenew:j_id1'],
      // The checked checkbox is sent; the unchecked one, the disabled input, and Cancel aren't.
      [`${PREFIX}:j_id9:visibleSectionItem:editVisible`, 'on'],
      [`${PREFIX}:j_id9:sortSectionItem:sortOrder`, '2'],
      [`${PREFIX}:j_id9:notesSectionItem:notes`, 'a & b'],
      [
        'com.salesforce.visualforce.ViewState',
        'i:AAAAWXsidCI6IjAwRDAwMDAwMDAwMDAwMCIsInYiOiIwMkcwMDAwMDAwMDAwMDAifQ==+/x=',
      ],
      ['com.salesforce.visualforce.ViewStateVersion', '202610140000000000'],
      ['com.salesforce.visualforce.ViewStateMAC', 'AGV5SnViMjVqWlNJNklrUmtUVlZ1'],
      ['com.salesforce.visualforce.ViewStateCSRF', 'VmpFOVZrWklWMVJyTkVwVk5WRlFk'],
    ]);
  });

  it('picks up the view state Salesforce renders after the form closes', () => {
    // A real org's page puts `ajax-view-state-page-container` after `</form>`, and Visualforce's
    // script copies it in on submit.
    const html = fixture('new-state-form.html');
    const viewStateStart = html.indexOf('<span id="ajax-view-state-page-container"');
    const formEnd = html.indexOf('</form>');
    const outside = `${html.slice(0, viewStateStart)}</form>${html.slice(viewStateStart, formEnd)}${html.slice(formEnd + '</form>'.length)}`;

    const inside = parseNewStateForm(html)!.fields;
    expect(parseNewStateForm(outside)!.fields).toStrictEqual(inside);
  });

  it('finds fields by suffix whatever the generated ids are', () => {
    const renumbered = fixture('new-state-form.html').replaceAll('j_id9', 'j_id12').replaceAll('j_id43', 'j_id51');

    expect(parseNewStateForm(renumbered)?.addButton[0]).toBe(`${PREFIX}:j_id51:addButton`);
  });

  it.each([':editName', ':editIsoCode', ':editIntVal', ':addButton'])(
    'returns undefined when the %s field is missing',
    (suffix) => {
      const html = fixture('new-state-form.html').replaceAll(suffix, ':somethingElse');
      expect(parseNewStateForm(html)).toBeUndefined();
    },
  );

  it('returns undefined for a login page', () => {
    expect(parseNewStateForm(fixture('login.html'))).toBeUndefined();
  });
});

describe('fillNewStateForm', () => {
  it('adds the name, code, name-as-integration-value, and the Add button after the form fields', () => {
    const form = parseNewStateForm(fixture('new-state-form.html'))!;
    const fields = fillNewStateForm(form, { country: 'US', code: 'ZZ', name: 'Zed & Co' });

    expect(fields.slice(0, form.fields.length)).toStrictEqual(form.fields);
    expect(fields.slice(form.fields.length)).toStrictEqual([
      [form.nameField, 'Zed & Co'],
      [form.codeField, 'ZZ'],
      [form.integrationValueField, 'Zed & Co'],
      form.addButton,
    ]);
  });
});

describe('classifyNewStateResponse', () => {
  it('treats an "already exists" error as exists, with the message', () => {
    expect(classifyNewStateResponse({ status: 200, body: fixture('post-errors.html') })).toStrictEqual({
      status: 'exists',
      message: 'A state with this ISO code already exists for this country.',
    });
  });

  it('treats any other error list as rejected, decoding the message', () => {
    expect(classifyNewStateResponse({ status: 200, body: fixture('post-rejected.html') })).toStrictEqual({
      status: 'rejected',
      message: "State Name: Value can't exceed 80 characters",
    });
  });

  it('reads a single "Error:" message that follows the heading', () => {
    expect(classifyNewStateResponse({ status: 200, body: fixture('post-error-single.html') })).toStrictEqual({
      status: 'rejected',
      message: 'Invalid ISO code. Use only letters and numbers.',
    });
  });

  it('recognizes a missing country', () => {
    expect(classifyNewStateResponse({ status: 200, body: fixture('post-missing-country.html') })).toStrictEqual({
      status: 'country-missing',
    });
  });

  it('recognizes success from the page body', () => {
    expect(classifyNewStateResponse({ status: 200, body: fixture('post-success.html') })).toStrictEqual({
      status: 'created',
    });
  });

  it('recognizes success from a redirect', () => {
    expect(
      classifyNewStateResponse({
        status: 302,
        location: '/i18n/ConfigureCountry.apexp?countryIso=US&success=true',
        body: '',
      }),
    ).toStrictEqual({ status: 'created' });
  });

  it('reports anything else as failed with the HTTP status', () => {
    expect(classifyNewStateResponse({ status: 200, body: '<html>Something else</html>' })).toStrictEqual({
      status: 'failed',
      message: 'Unrecognized response from Setup (HTTP 200).',
    });
  });
});

// CodeQL flagged quadratic regex behavior on inputs like these. Each must stay linear: at the old
// patterns' O(n²), 100k characters takes many seconds; linear scans take milliseconds.
describe('pathological input', () => {
  const huge = 100_000;

  it.each([
    ['many "<"', '<'.repeat(huge)],
    ['many unclosed forms', '<form '.repeat(huge / 6)],
    ['many unclosed selects in a form', `<form>${'<select name="s">'.repeat(huge / 17)}</form>`],
    ['many unclosed textareas in a form', `<form>${'<textarea name="t">'.repeat(huge / 19)}</form>`],
  ])('parses %s quickly', (_label, html) => {
    const started = performance.now();
    parseNewStateForm(html);
    classifyNewStateResponse({ status: 200, body: `<h4>Errors</h4>${html}` });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('still reads controls after an unclosed textarea', () => {
    const form = parseNewStateForm(
      fixture('new-state-form.html').replace(
        '<textarea name="configurenew:j_id1:blockNew:j_id9:notesSectionItem:notes">a &amp; b</textarea>',
        '<textarea name="broken">',
      ),
    );

    expect(form?.addButton[1]).toBe('Add');
    expect(form?.fields).toContainEqual(['broken', '']);
  });
});
