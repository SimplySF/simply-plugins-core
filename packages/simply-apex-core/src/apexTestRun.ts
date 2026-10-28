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

/*
 * `formatTestResultJson` reproduces the output format of `JsonReporter` in @salesforce/plugin-apex,
 * so the `test-result-<id>.json` written here is the file `sf apex test run --output-dir` writes.
 * That reporter is distributed under the following license:
 *
 * Copyright (c) 2024, Salesforce.com, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted
 * provided that the following conditions are met:
 *
 * - Redistributions of source code must retain the above copyright notice, this list of conditions
 *   and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice, this list of
 *   conditions and the following disclaimer in the documentation and/or other materials provided
 *   with the distribution.
 * - Neither the name of Salesforce.com nor the names of its contributors may be used to endorse or
 *   promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
 * OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { JUnitReporter, ResultFormat, TestLevel, TestService, type TestResult } from '@salesforce/apex-node';
import type { Connection } from '@salesforce/core';
import type { Duration } from '@salesforce/kit';

/** One test in {@link ApexTestResultJson}, with the field names `sf apex test run --json` uses. */
export type ApexTestResultJsonTest = {
  Id: string;
  QueueItemId: string;
  StackTrace: string | null;
  Message: string | null;
  AsyncApexJobId: string;
  MethodName: string;
  Outcome: string;
  ApexClass: { Id: string; Name: string; NamespacePrefix: string | null };
  RunTime: number;
  FullName: string;
};

/** The JSON document `sf apex test run` writes as `test-result-<id>.json` (and returns with `--json`). */
export type ApexTestResultJson = {
  summary: Record<string, unknown> & { outcome: string; testRunId: string };
  tests: ApexTestResultJsonTest[];
  coverage?: {
    coverage: Array<{
      id: string;
      name: string;
      totalLines: number;
      lines: Record<number, 0 | 1>;
      totalCovered: number;
      coveredPercent: number;
    }>;
    records: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  };
};

/** Formats an apex-node test result exactly as `sf apex test run`'s JSON output does. */
export function formatTestResultJson(result: TestResult): ApexTestResultJson {
  const { summary } = result;
  const json: ApexTestResultJson = {
    summary: {
      failRate: summary.failRate,
      failing: summary.failing,
      hostname: summary.hostname,
      orgId: summary.orgId,
      outcome: summary.outcome,
      passRate: summary.passRate,
      passing: summary.passing,
      skipped: summary.skipped,
      testRunId: summary.testRunId,
      testStartTime: summary.testStartTime,
      testsRan: summary.testsRan,
      userId: summary.userId,
      username: summary.username,
      commandTime: `${summary.commandTimeInMs} ms`,
      testExecutionTime: `${summary.testExecutionTimeInMs} ms`,
      testTotalTime: `${summary.testTotalTimeInMs} ms`,
    },
    tests: result.tests.map((test) => ({
      Id: test.id,
      QueueItemId: test.queueItemId,
      StackTrace: test.stackTrace,
      Message: test.message,
      AsyncApexJobId: test.asyncApexJobId,
      MethodName: test.methodName,
      Outcome: test.outcome,
      ApexClass: {
        Id: test.apexClass.id,
        Name: test.apexClass.name,
        NamespacePrefix: test.apexClass.namespacePrefix,
      },
      RunTime: test.runTime,
      FullName: test.fullName,
    })),
    ...(result.codecoverage ? { coverage: formatCoverage(result) } : {}),
  };
  if (summary.orgWideCoverage) {
    json.summary.orgWideCoverage = summary.orgWideCoverage;
  }
  if (summary.testRunCoverage) {
    json.summary.testRunCoverage = summary.testRunCoverage;
  }
  return json;
}

function formatCoverage(result: TestResult): NonNullable<ApexTestResultJson['coverage']> {
  const coverage: NonNullable<ApexTestResultJson['coverage']> = {
    coverage: [],
    records: [],
    summary: {
      totalLines: result.summary.totalLines,
      coveredLines: result.summary.coveredLines,
      orgWideCoverage: result.summary.orgWideCoverage,
      testRunCoverage: result.summary.testRunCoverage,
    },
  };
  coverage.coverage = (result.codecoverage ?? []).map((cov) => {
    const lines: Record<number, 0 | 1> = {};
    cov.coveredLines.forEach((line) => (lines[line] = 1));
    cov.uncoveredLines.forEach((line) => (lines[line] = 0));
    return {
      id: cov.apexId,
      name: cov.name,
      totalLines: cov.numLinesCovered + cov.numLinesUncovered,
      lines,
      totalCovered: cov.numLinesCovered,
      coveredPercent: parseInt(cov.percentage, 10),
    };
  });
  for (const test of result.tests) {
    for (const perClass of test.perClassCoverage ?? []) {
      coverage.records.push({
        ApexTestClass: { Id: test.id, Name: test.apexClass.name },
        ...(perClass.coverage ? { Coverage: perClass.coverage } : {}),
        TestMethodName: test.methodName,
        NumLinesCovered: perClass.numLinesCovered,
        ApexClassOrTrigger: { Id: perClass.apexClassOrTriggerId, Name: perClass.apexClassOrTriggerName },
        NumLinesUncovered: perClass.numLinesUncovered,
      });
    }
  }
  return coverage;
}

export type RunApexTestsWithResultsOptions = {
  connection: Connection;
  /** Ignored when `suiteNames` is given (the run is then `RunSpecifiedTests`). Defaults to `RunLocalTests`. */
  testLevel?: `${TestLevel}`;
  suiteNames?: string[];
  /** Collect code coverage. Defaults to true. */
  codeCoverage?: boolean;
  /** How long to wait for the run to finish. */
  wait: Duration;
  /** Directory to write the result files to. */
  outputDir: string;
};

export type RunApexTestsWithResultsResult =
  | { completed: true; testRunId: string; outcome: string; result: ApexTestResultJson }
  | { completed: false; testRunId: string };

/**
 * Runs Apex tests asynchronously and writes the same result files
 * `sf apex test run --result-format junit --output-dir <dir> [--code-coverage]` writes:
 * `test-run-id.txt`, `test-result-<id>.json`, `test-result-<id>-junit.xml`, `test-result.xml`, and
 * with coverage, `test-result-<id>-codecoverage.json` and `test-result-codecoverage.json`.
 *
 * Failing tests are not an error: check `outcome`. A run still going when `wait` runs out returns
 * `completed: false` (only `test-run-id.txt` is written), as the CLI does.
 *
 * @throws If the run can't be started or polled (bad suite name, auth failure, …).
 */
export async function runApexTestsWithResults(
  options: RunApexTestsWithResultsOptions,
): Promise<RunApexTestsWithResultsResult> {
  const { connection, suiteNames, codeCoverage = true, wait, outputDir } = options;
  const testLevel = suiteNames?.length ? TestLevel.RunSpecifiedTests : (options.testLevel ?? TestLevel.RunLocalTests);
  const testService = new TestService(connection);

  const payload = {
    ...(await testService.buildAsyncPayload(testLevel as TestLevel, undefined, undefined, suiteNames?.join(','))),
    skipCodeCoverage: !codeCoverage,
  };
  const result = await testService.runTestAsynchronous(payload, codeCoverage, false, undefined, undefined, wait);

  if (!('summary' in result)) {
    await testService.writeResultFiles(result, { dirPath: outputDir }, codeCoverage);
    return { completed: false, testRunId: result.testRunId };
  }

  const json = formatTestResultJson(result);
  const { testRunId, outcome } = result.summary;
  await testService.writeResultFiles(
    result,
    {
      dirPath: outputDir,
      resultFormats: [ResultFormat.junit],
      fileInfos: [
        { filename: testRunId ? `test-result-${testRunId}.json` : 'test-result.json', content: json },
        ...(json.coverage ? [{ filename: 'test-result-codecoverage.json', content: json.coverage.coverage }] : []),
        { filename: 'test-result.xml', content: new JUnitReporter().format(result) },
      ],
    },
    codeCoverage,
  );
  return { completed: true, testRunId, outcome, result: json };
}
