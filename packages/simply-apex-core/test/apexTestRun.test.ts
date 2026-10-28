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

import type { TestResult } from '@salesforce/apex-node';
import type { Connection } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTestResultJson, runApexTestsWithResults } from '../src/apexTestRun.js';

const buildAsyncPayloadMock = vi.hoisted(() => vi.fn());
const runTestAsynchronousMock = vi.hoisted(() => vi.fn());
const writeResultFilesMock = vi.hoisted(() => vi.fn());

vi.mock('@salesforce/apex-node', async (importOriginal) => ({
  // ResultFormat, TestLevel and JUnitReporter stay real.
  ...(await importOriginal<typeof import('@salesforce/apex-node')>()),
  TestService: class {
    public buildAsyncPayload = buildAsyncPayloadMock;
    public runTestAsynchronous = runTestAsynchronousMock;
    public writeResultFiles = writeResultFilesMock;
  },
}));

const connection = {} as Connection;

function testResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    summary: {
      failRate: '0%',
      testsRan: 1,
      orgId: '00D000000000001',
      outcome: 'Passed',
      passing: 1,
      failing: 0,
      skipped: 0,
      passRate: '100%',
      skipRate: '0%',
      testStartTime: '2026-10-28T12:00:00.000Z',
      testExecutionTimeInMs: 1200,
      testTotalTimeInMs: 1500,
      commandTimeInMs: 300,
      hostname: 'https://acme.my.salesforce.com',
      username: 'ci@example.com',
      testRunId: '707000000000001',
      userId: '005000000000001',
    },
    tests: [
      {
        id: '07M000000000001',
        queueItemId: '709000000000001',
        stackTrace: null,
        message: null,
        asyncApexJobId: '707000000000001',
        methodName: 'itWorks',
        outcome: 'Pass',
        apexClass: { id: '01p000000000001', name: 'FooTest', namespacePrefix: null, fullName: 'FooTest' },
        runTime: 42,
        testTimestamp: '2026-10-28T12:00:01.000Z',
        fullName: 'FooTest.itWorks',
      },
    ],
    ...overrides,
  } as TestResult;
}

describe('formatTestResultJson', () => {
  it("reproduces sf apex test run's JSON: renamed test fields and ms-suffixed timings", () => {
    const json = formatTestResultJson(testResult());

    expect(json.summary).toEqual({
      failRate: '0%',
      failing: 0,
      hostname: 'https://acme.my.salesforce.com',
      orgId: '00D000000000001',
      outcome: 'Passed',
      passRate: '100%',
      passing: 1,
      skipped: 0,
      testRunId: '707000000000001',
      testStartTime: '2026-10-28T12:00:00.000Z',
      testsRan: 1,
      userId: '005000000000001',
      username: 'ci@example.com',
      commandTime: '300 ms',
      testExecutionTime: '1200 ms',
      testTotalTime: '1500 ms',
    });
    expect(json.tests).toEqual([
      {
        Id: '07M000000000001',
        QueueItemId: '709000000000001',
        StackTrace: null,
        Message: null,
        AsyncApexJobId: '707000000000001',
        MethodName: 'itWorks',
        Outcome: 'Pass',
        ApexClass: { Id: '01p000000000001', Name: 'FooTest', NamespacePrefix: null },
        RunTime: 42,
        FullName: 'FooTest.itWorks',
      },
    ]);
    expect(json.coverage).toBeUndefined();
  });

  it('adds coverage, with per-line maps and per-class records, only when the run collected it', () => {
    const base = testResult();
    const json = formatTestResultJson({
      ...base,
      summary: { ...base.summary, orgWideCoverage: '80%', testRunCoverage: '75%', totalLines: 4, coveredLines: 3 },
      tests: [
        {
          ...base.tests[0],
          perClassCoverage: [
            {
              apexClassOrTriggerName: 'Foo',
              apexClassOrTriggerId: '01p000000000002',
              apexTestClassId: '01p000000000001',
              apexTestMethodName: 'itWorks',
              numLinesCovered: 3,
              numLinesUncovered: 1,
              percentage: '75%',
            },
          ],
        },
      ],
      codecoverage: [
        {
          apexId: '01p000000000002',
          name: 'Foo',
          type: 'ApexClass',
          numLinesCovered: 3,
          numLinesUncovered: 1,
          percentage: '75%',
          coveredLines: [1, 2, 3],
          uncoveredLines: [4],
        },
      ],
    });

    expect(json.summary.orgWideCoverage).toBe('80%');
    expect(json.summary.testRunCoverage).toBe('75%');
    expect(json.coverage?.coverage).toEqual([
      {
        id: '01p000000000002',
        name: 'Foo',
        totalLines: 4,
        lines: { 1: 1, 2: 1, 3: 1, 4: 0 },
        totalCovered: 3,
        coveredPercent: 75,
      },
    ]);
    expect(json.coverage?.records).toEqual([
      {
        ApexTestClass: { Id: '07M000000000001', Name: 'FooTest' },
        TestMethodName: 'itWorks',
        NumLinesCovered: 3,
        ApexClassOrTrigger: { Id: '01p000000000002', Name: 'Foo' },
        NumLinesUncovered: 1,
      },
    ]);
    expect(json.coverage?.summary).toEqual({
      totalLines: 4,
      coveredLines: 3,
      orgWideCoverage: '80%',
      testRunCoverage: '75%',
    });
  });
});

describe('runApexTestsWithResults', () => {
  const wait = Duration.minutes(60);

  beforeEach(() => {
    vi.clearAllMocks();
    buildAsyncPayloadMock.mockResolvedValue({ testLevel: 'RunLocalTests' });
    runTestAsynchronousMock.mockResolvedValue(testResult());
  });

  it('runs RunLocalTests with coverage by default and writes the CLI file set', async () => {
    const result = await runApexTestsWithResults({ connection, wait, outputDir: 'out' });

    expect(buildAsyncPayloadMock).toHaveBeenCalledWith('RunLocalTests', undefined, undefined, undefined);
    expect(runTestAsynchronousMock).toHaveBeenCalledWith(
      { testLevel: 'RunLocalTests', skipCodeCoverage: false },
      true,
      false,
      undefined,
      undefined,
      wait,
    );
    const [, config, codeCoverage] = writeResultFilesMock.mock.calls[0] as [
      unknown,
      { dirPath: string; resultFormats: string[]; fileInfos: Array<{ filename: string; content: unknown }> },
      boolean,
    ];
    expect(codeCoverage).toBe(true);
    expect(config.dirPath).toBe('out');
    expect(config.resultFormats).toEqual(['junit']);
    expect(config.fileInfos.map((f) => f.filename)).toEqual(['test-result-707000000000001.json', 'test-result.xml']);
    expect(config.fileInfos[0].content).toEqual(formatTestResultJson(testResult()));
    expect(String(config.fileInfos[1].content)).toContain('<testsuites>');
    expect(result).toMatchObject({ completed: true, testRunId: '707000000000001', outcome: 'Passed' });
  });

  it('runs the named suites as RunSpecifiedTests, ignoring the test level', async () => {
    await runApexTestsWithResults({
      connection,
      wait,
      outputDir: 'out',
      testLevel: 'RunAllTestsInOrg',
      suiteNames: ['Smoke', 'Regression'],
    });

    expect(buildAsyncPayloadMock).toHaveBeenCalledWith('RunSpecifiedTests', undefined, undefined, 'Smoke,Regression');
  });

  it('writes the coverage summary file only when the run returned coverage', async () => {
    runTestAsynchronousMock.mockResolvedValue(
      testResult({
        codecoverage: [
          {
            apexId: '01p000000000002',
            name: 'Foo',
            type: 'ApexClass',
            numLinesCovered: 1,
            numLinesUncovered: 0,
            percentage: '100%',
            coveredLines: [1],
            uncoveredLines: [],
          },
        ],
      }),
    );

    await runApexTestsWithResults({ connection, wait, outputDir: 'out' });

    const config = writeResultFilesMock.mock.calls[0][1] as { fileInfos: Array<{ filename: string }> };
    expect(config.fileInfos.map((f) => f.filename)).toContain('test-result-codecoverage.json');
  });

  it('does not treat failing tests as an error', async () => {
    const base = testResult();
    runTestAsynchronousMock.mockResolvedValue({ ...base, summary: { ...base.summary, outcome: 'Failed' } });

    await expect(runApexTestsWithResults({ connection, wait, outputDir: 'out' })).resolves.toMatchObject({
      completed: true,
      outcome: 'Failed',
    });
  });

  it('reports a run still going at the wait as incomplete, writing only its ID', async () => {
    runTestAsynchronousMock.mockResolvedValue({ testRunId: '707000000000009' });

    const result = await runApexTestsWithResults({ connection, wait, outputDir: 'out', codeCoverage: false });

    expect(result).toEqual({ completed: false, testRunId: '707000000000009' });
    expect(writeResultFilesMock).toHaveBeenCalledWith({ testRunId: '707000000000009' }, { dirPath: 'out' }, false);
  });

  it('propagates a failure to start the run', async () => {
    buildAsyncPayloadMock.mockRejectedValue(new Error('Invalid test suite: Nope'));

    await expect(runApexTestsWithResults({ connection, wait, outputDir: 'out', suiteNames: ['Nope'] })).rejects.toThrow(
      'Invalid test suite: Nope',
    );
  });
});
