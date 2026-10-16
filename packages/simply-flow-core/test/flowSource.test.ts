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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { developerNameFromFlowFile, findFlowNamesInSource } from '../src/flowSource.js';

function writeFlow(...segments: string[]): void {
  const filePath = path.join(...segments);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '<Flow/>');
}

describe('developerNameFromFlowFile', () => {
  it('strips the directory and the .flow-meta.xml suffix', () => {
    expect(developerNameFromFlowFile('force-app/main/default/flows/Account_Before_Save.flow-meta.xml')).toBe(
      'Account_Before_Save',
    );
  });
});

describe('findFlowNamesInSource', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-flow-core-source-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('finds flows in nested folders across several directories, deduplicated in first-occurrence order', async () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    writeFlow(dirA, 'main', 'default', 'flows', 'Flow_One.flow-meta.xml');
    writeFlow(dirB, 'flows', 'Flow_Two.flow-meta.xml');
    writeFlow(dirB, 'deep', 'nested', 'Flow_One.flow-meta.xml');
    writeFlow(dirB, 'flows', 'Not_A_Flow.object-meta.xml');

    const names = await findFlowNamesInSource([dirA, dirB]);

    expect(names).toStrictEqual(['Flow_One', 'Flow_Two']);
  });

  it('accepts Windows-style separators', async () => {
    writeFlow(tmpDir, 'flows', 'My_Flow.flow-meta.xml');

    const names = await findFlowNamesInSource([tmpDir.replaceAll('/', '\\')]);

    expect(names).toStrictEqual(['My_Flow']);
  });

  it('returns [] for a directory with no flows', async () => {
    expect(await findFlowNamesInSource([tmpDir])).toStrictEqual([]);
  });
});
