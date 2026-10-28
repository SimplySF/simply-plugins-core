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
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendToEnvFile, type EnvLogger } from '../src/env.js';

type MockEnvLogger = {
  info: ReturnType<typeof vi.fn<EnvLogger['info']>>;
  error: ReturnType<typeof vi.fn<EnvLogger['error']>>;
};

describe('appendToEnvFile', () => {
  const tempEnvFile = path.resolve('test.env');
  let mockLogger: MockEnvLogger;

  beforeEach(() => {
    mockLogger = { info: vi.fn(), error: vi.fn() };
    if (fs.existsSync(tempEnvFile)) {
      fs.unlinkSync(tempEnvFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempEnvFile)) {
      fs.unlinkSync(tempEnvFile);
    }
    vi.restoreAllMocks();
  });

  it('should create a new env file and write keys when file does not exist', () => {
    appendToEnvFile(
      tempEnvFile,
      {
        KEY_A: 'valueA',
        KEY_B: 'valueB',
        KEY_C: undefined,
      },
      mockLogger,
    );

    const content = fs.readFileSync(tempEnvFile, 'utf8');
    expect(content).toBe('KEY_A=valueA\nKEY_B=valueB\n');
    expect(mockLogger.info).toHaveBeenCalledWith(`Variables successfully appended to ${tempEnvFile}!`);
  });

  it('should append keys with a leading newline if the existing file does not end with a newline', () => {
    fs.writeFileSync(tempEnvFile, 'EXISTING_KEY=existing_val', 'utf8');

    appendToEnvFile(tempEnvFile, { NEW_KEY: 'new_val' }, mockLogger);

    const content = fs.readFileSync(tempEnvFile, 'utf8');
    expect(content).toBe('EXISTING_KEY=existing_val\nNEW_KEY=new_val\n');
  });

  it('should append keys without a leading newline if the existing file already ends with a newline', () => {
    fs.writeFileSync(tempEnvFile, 'EXISTING_KEY=existing_val\n', 'utf8');

    appendToEnvFile(tempEnvFile, { NEW_KEY: 'new_val' }, mockLogger);

    const content = fs.readFileSync(tempEnvFile, 'utf8');
    expect(content).toBe('EXISTING_KEY=existing_val\nNEW_KEY=new_val\n');
  });

  it('should do nothing if variables object has no entries or only undefined entries', () => {
    appendToEnvFile(tempEnvFile, { KEY_UNDEFINED: undefined }, mockLogger);

    expect(fs.existsSync(tempEnvFile)).toBe(false);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('should throw and log an error if writing fails', () => {
    const mockError = new Error('Disk full');
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw mockError;
    });

    expect(() => {
      appendToEnvFile(tempEnvFile, { KEY: 'val' }, mockLogger);
    }).toThrow(mockError);

    expect(mockLogger.error).toHaveBeenCalledWith(`Error appending to ${tempEnvFile}: ${mockError.message}`);
  });
});
