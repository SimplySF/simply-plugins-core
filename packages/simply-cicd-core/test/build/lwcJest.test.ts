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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { buildJunitJestConfig, runLwcJest } from '../../src/build/lwcJest.js';

vi.mock('execa');
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));

const junitEnv = { JEST_JUNIT_OUTPUT_DIR: './test-results/lwc', JEST_JUNIT_OUTPUT_NAME: 'test-result.xml' };

describe('runLwcJest', () => {
  let projectDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lwc-jest-project-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('should install LWC Jest libraries and run tests with coverage and the JUnit reporter', async () => {
    const result = await runLwcJest({ projectDir });

    expect(result).toEqual({ skipped: false, success: true });
    expect(logger.info).toHaveBeenCalledWith('Running LWC Jest tests...');
    expect(execa).toHaveBeenCalledWith('npm', ['install', '@salesforce/sfdx-lwc-jest', '@sa11y/jest', 'jest-junit'], {
      cwd: projectDir,
      stdio: 'pipe',
    });
    expect(execa).toHaveBeenCalledWith(
      'npx',
      ['sfdx-lwc-jest', '--coverage', '--', '--passWithNoTests', '--reporters=default', '--reporters=jest-junit'],
      { cwd: projectDir, stdio: 'inherit', env: junitEnv },
    );
    expect(logger.success).toHaveBeenCalledWith('LWC Jest tests completed.');
  });

  it('should create the results directory before running, so it exists even if Jest never starts', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('npm install failed'));

    await runLwcJest({ projectDir });

    expect((await fs.stat(path.join(projectDir, 'test-results', 'lwc'))).isDirectory()).toBe(true);
  });

  it("should keep the project's own Jest config and reporters via a wrapper config", async () => {
    await fs.writeFile(path.join(projectDir, 'jest.config.js'), "module.exports = { reporters: ['default'] };\n");
    let wrapperConfig: string | undefined;
    vi.mocked(execa).mockImplementation(((_cmd: string, args: string[]) => {
      wrapperConfig = args.find((arg) => arg.startsWith('--config='))?.slice('--config='.length);
      return Promise.resolve({ stdout: '' });
    }) as never);

    await runLwcJest({ projectDir });

    expect(wrapperConfig).toMatch(/jest\.config\.mjs$/);
    expect(execa).toHaveBeenLastCalledWith(
      'npx',
      ['sfdx-lwc-jest', '--coverage', '--', '--passWithNoTests', `--config=${wrapperConfig}`],
      { cwd: projectDir, stdio: 'inherit', env: junitEnv },
    );
    await expect(fs.access(path.dirname(wrapperConfig!))).rejects.toThrow();
  });

  it('should skip lwc-jest if disabled, even with failOnTestFailure', async () => {
    const result = await runLwcJest({ projectDir, disabled: true, failOnTestFailure: true });

    expect(result).toEqual({ skipped: true, success: false });
    expect(logger.warn).toHaveBeenCalledWith('lwc-jest is disabled. Skipping.');
    expect(execa).not.toHaveBeenCalled();
  });

  it('should log an error (not throw) when the tests fail', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '' } as never)
      .mockRejectedValueOnce(new Error('jest failed'));

    const result = await runLwcJest({ projectDir });

    expect(result).toEqual({ skipped: false, success: false });
    expect(logger.error).toHaveBeenCalledWith('LWC Jest tests failed.');
  });

  it('should log and throw when the tests fail and failOnTestFailure is set', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: '' } as never)
      .mockRejectedValueOnce(new Error('jest failed'));

    await expect(runLwcJest({ projectDir, failOnTestFailure: true })).rejects.toThrow('LWC Jest tests failed.');
    expect(logger.error).toHaveBeenCalledWith('LWC Jest tests failed.');
  });

  it('should report an install failure distinctly, without running the tests', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('npm install failed'));

    await expect(runLwcJest({ projectDir, failOnTestFailure: true })).rejects.toThrow(
      'Failed to install the LWC Jest test libraries.',
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to install the LWC Jest test libraries.');
    expect(execa).toHaveBeenCalledTimes(1);
  });
});

describe('buildJunitJestConfig', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lwc-jest-config-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  async function loadWrapped(projectConfig: string, file = 'jest.config.cjs'): Promise<Record<string, unknown>> {
    const projectConfigFile = path.join(projectDir, file);
    await fs.writeFile(projectConfigFile, projectConfig);
    const wrapperFile = path.join(projectDir, `wrapper-${Math.random().toString(36).slice(2)}.mjs`);
    await fs.writeFile(wrapperFile, buildJunitJestConfig(projectConfigFile, projectDir));
    const wrapper = (await import(pathToFileURL(wrapperFile).href)) as {
      default: () => Promise<Record<string, unknown>>;
    };
    return wrapper.default();
  }

  it("should append jest-junit to the project's reporters, keeping their options and other settings", async () => {
    const config = await loadWrapped(
      "module.exports = { testTimeout: 5000, reporters: ['default', ['jest-html-reporter', { pageTitle: 'LWC' }]] };",
    );

    expect(config.testTimeout).toBe(5000);
    expect(config.reporters).toEqual(['default', ['jest-html-reporter', { pageTitle: 'LWC' }], 'jest-junit']);
    expect(config.rootDir).toBe(projectDir);
  });

  it('should use the default reporter when the project sets none', async () => {
    const config = await loadWrapped('module.exports = {};');

    expect(config.reporters).toEqual(['default', 'jest-junit']);
  });

  it('should not add jest-junit twice when the project already uses it', async () => {
    const config = await loadWrapped(
      "module.exports = { reporters: ['default', ['jest-junit', { suiteName: 'x' }]] };",
    );

    expect(config.reporters).toEqual(['default', ['jest-junit', { suiteName: 'x' }]]);
  });

  it('should resolve a relative rootDir against the project, and support ESM and function configs', async () => {
    const config = await loadWrapped("export default async () => ({ rootDir: 'force-app' });", 'jest.config.mjs');

    expect(config.rootDir).toBe(path.join(projectDir, 'force-app'));
    expect(config.reporters).toEqual(['default', 'jest-junit']);
  });
});
