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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toDescribeView } from '../../src/generate/describe.js';

describe('aep describe mapper', () => {
  it('filters out IsDeleted, textarea, and non-filterable fields', () => {
    const raw = JSON.parse(readFileSync(join('test', 'fixtures', 'generate', 'describe', 'account.json'), 'utf8')) as {
      name: string;
      custom: boolean;
      fields: Array<{ name: string; type: string; filterable: boolean }>;
    };
    const view = toDescribeView(raw);
    expect(view.apiName).to.equal('Account');
    expect(view.isCustom).to.equal(false);
    expect(view.fieldNames).to.deep.equal(['Id', 'Name', 'OwnerId']);
  });
});
