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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runApexTestsWithResults } from '@simplysf/simply-apex-core';
import { readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../src/logger.js';
import { hasApexTests, runApexTests } from '../src/sfApex.js';
import { getOrgConnection } from '../src/sfOrg.js';

const actualReadFile = vi.hoisted(() => ({ fn: undefined as unknown as typeof fs.readFile }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  actualReadFile.fn = actual.promises.readFile;
  return {
    ...actual,
    promises: {
      ...actual.promises,
      // Never create ./test-results in the repo; temp fixture directories are created for real.
      mkdir: vi.fn(async (dir: string, options?: { recursive?: boolean }) =>
        String(dir).includes('test-results') ? undefined : actual.promises.mkdir(dir, options),
      ),
      readFile: vi.fn(actual.promises.readFile),
    },
  };
});
vi.mock('@simplysf/simply-apex-core', () => ({ runApexTestsWithResults: vi.fn() }));
vi.mock('@simplysf/simply-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplysf/simply-core')>()),
  readSfdxProject: vi.fn(),
}));
vi.mock('../src/sfOrg.js', () => ({ getOrgConnection: vi.fn() }));
vi.mock('../src/logger.js', () => ({
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

async function packageDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-pkg-'));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    // eslint-disable-next-line no-await-in-loop -- tiny fixture
    await fs.mkdir(path.dirname(file), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(file, content);
  }
  return dir;
}

const resultsDir = './test-results/apex';
const runIdFile = path.join(resultsDir, 'test-run-id.txt');

/** Serves the result files a run "wrote", falling through to the real disk for everything else. */
function serveResultFiles(files: Record<string, string>): void {
  vi.mocked(fs.readFile).mockImplementation((async (file: string, encoding: BufferEncoding) => {
    if (file in files) return files[file];
    if (file.startsWith(path.normalize('test-results'))) {
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    }
    return actualReadFile.fn(file, encoding);
  }) as never);
}

describe('hasApexTests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds an @isTest class anywhere under a package directory, case-insensitively', async () => {
    const dir = await packageDir({ 'main/default/classes/nested/FooTest.cls': '@IsTest\nprivate class FooTest {}' });
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: dir }] });

    expect(await hasApexTests()).toBe(true);
  });

  it('ignores non-.cls files and @isTestVisible', async () => {
    const dir = await packageDir({
      'classes/Foo.cls': 'public class Foo { @TestVisible private Integer x; @isTestVisible Integer y; }',
      'classes/Foo.cls-meta.xml': '<!-- @isTest -->',
    });
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: dir }] });

    expect(await hasApexTests()).toBe(false);
  });

  it('checks every package directory, and treats a missing one as having no tests', async () => {
    const empty = await packageDir({ 'classes/Foo.cls': 'public class Foo {}' });
    const withTests = await packageDir({ 'classes/BarTest.cls': '@isTest class BarTest {}' });
    vi.mocked(readSfdxProject).mockResolvedValue({
      packageDirectories: [{ path: path.join(empty, 'does-not-exist') }, { path: empty }, { path: withTests }],
    });

    expect(await hasApexTests()).toBe(true);
  });
});

describe('runApexTests', () => {
  const connection = { id: 'connection' };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dir = await packageDir({ 'classes/FooTest.cls': '@isTest class FooTest {}' });
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: dir }] });
    vi.mocked(getOrgConnection).mockResolvedValue(connection as never);
    vi.mocked(runApexTestsWithResults).mockResolvedValue({ completed: true } as never);
  });

  it('skips the run when the project has no Apex tests', async () => {
    const dir = await packageDir({ 'classes/Foo.cls': 'public class Foo {}' });
    vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: dir }] });

    await runApexTests({ alias: 'my-org' });

    expect(runApexTestsWithResults).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('No Apex test classes found. Skipping Apex tests.');
  });

  it('runs RunLocalTests with coverage into ./test-results/apex by default, and passes', async () => {
    serveResultFiles({
      [runIdFile]: '707000000000001\n',
      [path.join(resultsDir, 'test-result-707000000000001.json')]: JSON.stringify({ summary: { outcome: 'Passed' } }),
    });

    await runApexTests({ alias: 'my-org' });

    expect(getOrgConnection).toHaveBeenCalledWith('my-org');
    const options = vi.mocked(runApexTestsWithResults).mock.calls[0][0];
    expect(options).toMatchObject({
      connection,
      codeCoverage: true,
      outputDir: resultsDir,
      testLevel: 'RunLocalTests',
    });
    expect(options.wait.minutes).toBe(60);
    expect(logger.success).toHaveBeenCalledWith('Apex tests completed successfully.');
  });

  it('runs a test suite instead of a test level when one is given', async () => {
    serveResultFiles({
      [runIdFile]: '707000000000001',
      [path.join(resultsDir, 'test-result-707000000000001.json')]: JSON.stringify({ summary: { outcome: 'Passed' } }),
    });

    await runApexTests({ testSuite: 'Smoke', wait: '15' });

    expect(getOrgConnection).toHaveBeenCalledWith(undefined);
    const options = vi.mocked(runApexTestsWithResults).mock.calls[0][0];
    expect(options.suiteNames).toEqual(['Smoke']);
    expect(options.testLevel).toBeUndefined();
    expect(options.wait.minutes).toBe(15);
  });

  it('reports each failing test and throws when the run failed', async () => {
    serveResultFiles({
      [runIdFile]: '707000000000002',
      [path.join(resultsDir, 'test-result-707000000000002.json')]: JSON.stringify({
        summary: { outcome: 'Failed' },
        tests: [
          { Outcome: 'Pass', FullName: 'FooTest.ok' },
          { Outcome: 'Fail', FullName: 'FooTest.broken', Message: 'Assertion failed', StackTrace: 'Class.FooTest' },
        ],
      }),
    });

    await expect(runApexTests({ alias: 'my-org' })).rejects.toThrow('Apex test run included failures.');
    expect(logger.raw).toHaveBeenCalledWith('❌ APEX TEST FAILURE REPORT (1 failures found)');
    expect(logger.raw).toHaveBeenCalledWith('\n[1/1] ❌ FooTest.broken');
  });

  it("surfaces the run's own error when it never produced a test run ID", async () => {
    vi.mocked(runApexTestsWithResults).mockRejectedValue(new Error('Invalid test suite: Nope'));
    serveResultFiles({});

    await expect(runApexTests({ testSuite: 'Nope' })).rejects.toThrow('Invalid test suite: Nope');
    expect(logger.error).toHaveBeenCalledWith('Apex test run failed.', 'Invalid test suite: Nope');
  });
});
