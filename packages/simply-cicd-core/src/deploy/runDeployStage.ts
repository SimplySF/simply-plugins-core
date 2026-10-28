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

import chalk from 'chalk';
import { logger } from '../logger.js';
import { installDeploymentPlugins } from '../sfPlugins.js';

/** Width of the `=` rules that bracket each stage's banner in the job log. */
const BANNER_WIDTH = 80;

/** @returns Seconds elapsed since `startTime`, to two decimal places. */
function elapsedSeconds(startTime: number): number {
  return Number(((Date.now() - startTime) / 1000).toFixed(2));
}

/** Writes a rule-bracketed banner, the shape every stage boundary uses in the job log. */
function banner(write: (message: string) => void, message: string): void {
  logger.raw('\n' + '='.repeat(BANNER_WIDTH));
  write(message);
  logger.raw('='.repeat(BANNER_WIDTH) + '\n');
}

/**
 * Run one deployment stage inside the shared banner/timing/error frame.
 *
 * Both deployment styles bracket a stage the same way: announce it, install the deployment
 * plugins, run it, then report how long it took — or, on failure, report the elapsed time and the
 * failing job before rethrowing. Only the middle step differs between them.
 *
 * @param stage - The stage name, as it appears in the banner.
 * @param options - The stage's full options, logged verbatim when `debug` is set.
 * @param runStage - The stage's actual work.
 * @throws Whatever `runStage` throws, after logging it. The error is never swallowed — the CI job
 * still has to fail.
 */
export async function runDeployStage(
  stage: string,
  options: { debug?: boolean },
  runStage: () => Promise<void>,
): Promise<void> {
  banner(logger.info, `>>> Starting Deployment Stage: ${chalk.bold(stage)} <<<`);

  const startTime = Date.now();

  try {
    if (options.debug) {
      logger.debug(`Incoming parameters: ${stage}`, options);
    }

    await installDeploymentPlugins(options.debug);
    await runStage();

    banner(logger.success, `Completed stage ${chalk.bold(stage)} in ${elapsedSeconds(startTime)}s`);
  } catch (error) {
    // Deployment-step failures carry the job they came from; anything else just has a message.
    const job = (error as Error & { job?: string }).job;

    logger.raw('\n' + '='.repeat(BANNER_WIDTH));
    logger.error(
      `Failed stage ${chalk.bold(stage)}${job ? ` for ${chalk.bold(job)}` : ''} after ${elapsedSeconds(startTime)}s`,
    );
    logger.raw((error as Error).message);
    logger.raw('='.repeat(BANNER_WIDTH) + '\n');

    throw error;
  }
}
