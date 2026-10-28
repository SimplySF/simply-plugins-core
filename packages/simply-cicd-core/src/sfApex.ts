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
import path from 'node:path';
import { execa } from 'execa';
import { readSfdxProject } from '@simplysf/simply-core';
import { runSf } from './exec/sfCli.js';
import { logger } from './logger.js';

export type HasApexTestsOptions = {
  debugMode?: boolean;
};

export type RunApexTestsOptions = {
  alias?: string;
  testLevel?: string;
  testSuite?: string;
  wait?: string;
  debugMode?: boolean;
};

type ApexTestResult = {
  summary?: { outcome?: string; passing?: number; failing?: number; skipped?: number };
  tests?: Array<{ Outcome?: string; FullName?: string; Message?: string; StackTrace?: string }>;
};

/**
 * Checks if there are any Apex test classes defined in the package directories, by reading
 * `sfdx-project.json` to identify the package directories and searching each recursively
 * (case-insensitively) for `@isTest` in `.cls` files.
 */
export async function hasApexTests(options?: HasApexTestsOptions): Promise<boolean> {
  let packageDirs = ['force-app'];
  try {
    const sfdxProjectJson = await readSfdxProject();
    packageDirs = sfdxProjectJson.packageDirectories.map((d) => d.path).filter((p): p is string => Boolean(p));
  } catch {
    if (options?.debugMode) {
      logger.warn('Could not read sfdx-project.json to identify package directories. Using default force-app.');
    }
  }

  for (const dir of packageDirs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- stops at the first directory with a match
      await execa('grep', ['-q', '-r', '-i', '--include=*.cls', '@isTest\\b', dir]);
      return true;
    } catch (error) {
      if (options?.debugMode) {
        const err = error as { shortMessage?: string };
        logger.log(`No Apex tests found in ${dir} or an error occurred during search.`, err.shortMessage);
      }
    }
  }

  return false;
}

/** Kicks off the `sf apex test run`, swallowing any failure so the run's artifacts (namely the
 * test run ID file) can still be inspected afterward to distinguish an execution failure from a
 * genuine test failure. */
async function executeTestRun(args: string[]): Promise<Error | undefined> {
  try {
    await runSf(args, { stdio: 'pipe' });
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

/** Reads the test run ID that `sf apex test run` writes out. If that fails, prefers surfacing
 * the run's own execution error (if any) since a missing ID file is usually just a symptom of it. */
async function resolveTestRunId(testRunIdFile: string, execError: Error | undefined): Promise<string> {
  try {
    return (await fs.readFile(testRunIdFile, 'utf-8')).trim();
  } catch (readIdError) {
    if (execError) {
      logger.error('Apex test run failed.', (execError as { shortMessage?: string }).shortMessage);
      throw execError;
    }

    logger.error(`Failed to read test run ID from ${testRunIdFile}.`, (readIdError as Error).message);
    throw readIdError;
  }
}

function reportFailingTests(failingTests: NonNullable<ApexTestResult['tests']>): void {
  logger.raw('\n' + '='.repeat(80));
  logger.raw(`❌ APEX TEST FAILURE REPORT (${failingTests.length} failures found)`);
  logger.raw('='.repeat(80));

  failingTests.forEach((t, index) => {
    logger.raw(`\n[${index + 1}/${failingTests.length}] ❌ ${t.FullName ?? 'Unknown test'}`);
    logger.raw(`    Message:     ${t.Message ? t.Message.trim().replace(/\n/g, '\n                 ') : 'N/A'}`);
    if (t.StackTrace) {
      logger.raw(`    Stack Trace: ${t.StackTrace.trim().replace(/\n/g, '\n                 ')}`);
    }
    logger.raw('-'.repeat(80));
  });
  logger.raw();
}

/** Reads and reports on the JUnit/JSON result file for a completed test run, returning the run's
 * outcome. A read/parse failure here prefers surfacing the run's own execution error (if any). */
async function processTestResults(resultFilePath: string, execError: Error | undefined): Promise<string | undefined> {
  try {
    const resultsContent = await fs.readFile(resultFilePath, 'utf-8');
    const results = JSON.parse(resultsContent) as ApexTestResult;
    const testRunOutcome = results.summary?.outcome;

    if (testRunOutcome !== 'Failed') {
      logger.success('Apex tests completed successfully.');
      return testRunOutcome;
    }

    logger.error('Apex test run failed.');
    const failingTests = results.tests ? results.tests.filter((t) => t.Outcome === 'Fail') : [];

    if (failingTests.length > 0) {
      reportFailingTests(failingTests);
    } else {
      logger.warn(
        'Test run was marked as failed, but no individual test failures were found. This could indicate a compile error or issue.',
      );
    }

    return testRunOutcome;
  } catch (fileError) {
    logger.error(`Failed to read or parse test result file at ${resultFilePath}.`, (fileError as Error).message);
    if (execError) {
      throw execError;
    }

    throw fileError;
  }
}

/**
 * Runs Apex tests in the specified target Salesforce organization. First checks that any Apex
 * tests exist before initiating the run. Test results are written to `./test-results/apex` in
 * JUnit and JSON formats. If tests fail, a detailed failure report is printed and this throws.
 */
export async function runApexTests(options: RunApexTestsOptions): Promise<void> {
  const { alias, testLevel = 'RunLocalTests', testSuite, wait = '60' } = options;

  if (!(await hasApexTests(options))) {
    logger.warn('No Apex test classes found. Skipping Apex tests.');
    return;
  }

  logger.info('Running Apex tests...');
  const testResultsDir = './test-results/apex';
  await fs.mkdir(testResultsDir, { recursive: true });

  const args = [
    'apex',
    'test',
    'run',
    '--code-coverage',
    '--result-format',
    'junit',
    '--output-dir',
    testResultsDir,
    '--wait',
    wait,
  ];

  if (alias) {
    args.push('--target-org', alias);
  }

  if (testSuite) {
    args.push('--suite-names', testSuite);
  } else {
    args.push('--test-level', testLevel);
  }

  const execError = await executeTestRun(args);
  const testRunId = await resolveTestRunId(path.join(testResultsDir, 'test-run-id.txt'), execError);

  let testRunOutcome: string | undefined;
  if (testRunId) {
    const resultFilePath = path.join(testResultsDir, `test-result-${testRunId}.json`);
    testRunOutcome = await processTestResults(resultFilePath, execError);
  }

  if (testRunOutcome === 'Failed') {
    throw new Error('Apex test run included failures.');
  }
}
