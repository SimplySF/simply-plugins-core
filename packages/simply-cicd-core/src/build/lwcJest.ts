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
import { logger } from '../logger.js';

/** Where `runLwcJest` writes the JUnit report, mirroring `runApexTests`'s `./test-results/apex`. */
export const LWC_JEST_RESULTS_DIR = './test-results/lwc';
export const LWC_JEST_RESULTS_FILE = 'test-result.xml';

/** The project config files `sfdx-lwc-jest` recognizes; with none present it passes its own default `--config`. */
const PROJECT_JEST_CONFIG_FILES = ['jest.config.js', 'jest.config.mjs', 'jest.config.cjs'];

export type RunLwcJestOptions = { disabled?: boolean; failOnTestFailure?: boolean; projectDir?: string };
export type RunLwcJestResult = { skipped: boolean; success: boolean };

async function findProjectJestConfig(projectDir: string): Promise<string | undefined> {
  for (const file of PROJECT_JEST_CONFIG_FILES) {
    const configPath = path.join(projectDir, file);
    try {
      // eslint-disable-next-line no-await-in-loop -- first match wins, in sfdx-lwc-jest's order
      await fs.access(configPath);
      return configPath;
    } catch {
      // not present; try the next name
    }
  }

  return undefined;
}

/**
 * Builds an ES module Jest config that loads the project's own config and adds `jest-junit` to its
 * reporters, rather than replacing them the way a CLI `--reporters` would. `rootDir` is pinned to the
 * project, since Jest would otherwise default it to the wrapper's own (temporary) directory.
 */
export function buildJunitJestConfig(projectConfigFile: string, projectDir: string): string {
  // A config function rather than top-level await: Jest loads config files with require() first, and
  // require() can't load an ES module that uses top-level await.
  return `import path from 'node:path';

export default async () => {
  const mod = await import(${JSON.stringify(pathToFileURL(projectConfigFile).href)});
  let config = mod.default ?? mod;
  if (typeof config === 'function') {
    config = await config();
  }

  const reporters = config.reporters ?? ['default'];
  const hasJunit = reporters.some((reporter) => (Array.isArray(reporter) ? reporter[0] : reporter) === 'jest-junit');

  return {
    ...config,
    rootDir: path.resolve(${JSON.stringify(projectDir)}, config.rootDir ?? '.'),
    reporters: hasJunit ? reporters : [...reporters, 'jest-junit'],
  };
};
`;
}

function failRun(options: RunLwcJestOptions, message: string, error: unknown): RunLwcJestResult {
  logger.error(message);
  if (options.failOnTestFailure) {
    throw new Error(message, { cause: error });
  }

  return { skipped: false, success: false };
}

/**
 * Installs the LWC Jest test libraries and runs the project's LWC Jest tests with coverage, writing
 * a JUnit report to `./test-results/lwc/test-result.xml` alongside any reporters the project's own
 * Jest config sets. A failure is logged and returned, unless `failOnTestFailure` is set, in which
 * case it also throws.
 */
export async function runLwcJest(options: RunLwcJestOptions): Promise<RunLwcJestResult> {
  if (options.disabled) {
    logger.warn('lwc-jest is disabled. Skipping.');
    return { skipped: true, success: false };
  }

  const projectDir = options.projectDir ?? process.cwd();
  logger.info('Running LWC Jest tests...');
  // Created up front so a pipeline's `when: always` artifact path exists even if Jest never starts.
  await fs.mkdir(path.join(projectDir, LWC_JEST_RESULTS_DIR), { recursive: true });

  try {
    await execa('npm', ['install', '@salesforce/sfdx-lwc-jest', '@sa11y/jest', 'jest-junit'], {
      cwd: projectDir,
      stdio: 'pipe',
    });
  } catch (error) {
    return failRun(options, 'Failed to install the LWC Jest test libraries.', error);
  }

  const projectConfig = await findProjectJestConfig(projectDir);
  const wrapperDir = projectConfig ? await fs.mkdtemp(path.join(os.tmpdir(), 'lwc-jest-')) : undefined;
  try {
    let reporterArgs = ['--reporters=default', '--reporters=jest-junit'];
    if (projectConfig && wrapperDir) {
      const wrapperConfig = path.join(wrapperDir, 'jest.config.mjs');
      await fs.writeFile(wrapperConfig, buildJunitJestConfig(projectConfig, projectDir));
      reporterArgs = [`--config=${wrapperConfig}`];
    }

    await execa('npx', ['sfdx-lwc-jest', '--coverage', '--', '--passWithNoTests', ...reporterArgs], {
      cwd: projectDir,
      stdio: 'inherit',
      env: { JEST_JUNIT_OUTPUT_DIR: LWC_JEST_RESULTS_DIR, JEST_JUNIT_OUTPUT_NAME: LWC_JEST_RESULTS_FILE },
    });
  } catch (error) {
    return failRun(options, 'LWC Jest tests failed.', error);
  } finally {
    if (wrapperDir) {
      await fs.rm(wrapperDir, { recursive: true, force: true });
    }
  }

  logger.success('LWC Jest tests completed.');
  return { skipped: false, success: true };
}
