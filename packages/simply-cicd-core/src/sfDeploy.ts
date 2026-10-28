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

import { SfError, SfProject } from '@salesforce/core';
import type { Duration } from '@salesforce/kit';
import { ComponentSet, ComponentSetBuilder, ComponentStatus, RequestStatus } from '@salesforce/source-deploy-retrieve';
import { SourceTracking } from '@salesforce/source-tracking';
import { logger } from './logger.js';
import { resolveOrg } from './resolveOrg.js';

export type DeployProjectSourceOptions = {
  /** The org to deploy to. Omit to use the default target org. */
  aliasOrUsername?: string;
  /**
   * Deploy these directories instead of the tracked local changes (`--source-dir`). Source tracking
   * still records what was deployed.
   */
  sourceDirs?: string[];
  /** `--ignore-warnings`: don't fail the deploy on warnings. */
  ignoreWarnings?: boolean;
  /** How long to wait for the deploy to finish. */
  wait: Duration;
};

export type DeployProjectSourceResult = {
  /** `undefined` when there were no local changes to deploy. */
  deployId?: string;
  status: RequestStatus | 'NothingToDeploy';
  componentCount: number;
};

/**
 * Deploys project source to an org with source tracking, as
 * `sf project deploy start --ignore-conflicts [--source-dir …] [--ignore-warnings] --wait <wait>` does:
 * without `sourceDirs`, it deploys the tracked local changes (deletes included), and nothing to
 * deploy is not an error; with `sourceDirs`, it deploys those, and an empty set is.
 *
 * Remote conflicts are ignored and tracking is updated after the deploy, as `--ignore-conflicts`
 * does. Anything short of a full success (partial success, failure, cancellation, or still running
 * at `wait`) throws, as the CLI exits non-zero for each of them.
 *
 * @throws {SfError} `NothingToDeploy` for empty `sourceDirs`; `DeployFailed` for any non-success.
 */
export async function deployProjectSource(options: DeployProjectSourceOptions): Promise<DeployProjectSourceResult> {
  const { aliasOrUsername, sourceDirs, ignoreWarnings = false, wait } = options;
  const org = await resolveOrg(aliasOrUsername);
  const project = await SfProject.resolve();
  const tracking = await SourceTracking.create({ org, project, subscribeSDREvents: true, ignoreConflicts: true });

  const componentSet = sourceDirs?.length
    ? await ComponentSetBuilder.build({
        sourcepath: sourceDirs,
        sourceapiversion: project.getSfProjectJson().getContents().sourceApiVersion,
        projectDir: tracking.projectPath,
      })
    : ((await tracking.localChangesAsComponentSet(false))[0] ?? new ComponentSet(undefined, tracking.registry));

  if (componentSet.size === 0) {
    if (sourceDirs?.length) {
      throw new SfError(`No local changes to deploy in ${sourceDirs.join(', ')}.`, 'NothingToDeploy');
    }
    logger.info('No local changes to deploy.');
    return { status: 'NothingToDeploy', componentCount: 0 };
  }

  logger.info(`Deploying ${componentSet.size} components...`);
  const deploy = await componentSet.deploy({
    usernameOrConnection: org.getConnection(),
    apiOptions: { checkOnly: false, ignoreWarnings, rest: false, rollbackOnError: true, purgeOnDelete: false },
  });
  let lastProgress = '';
  deploy.onUpdate((response) => {
    const progress = `Deploy ${response.id}: ${response.status} (${response.numberComponentsDeployed}/${response.numberComponentsTotal} components, ${response.numberTestsCompleted}/${response.numberTestsTotal} tests)`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      logger.info(progress);
    }
  });

  const result = await deploy.pollStatus({ timeout: wait });
  const { status } = result.response;
  if (status !== RequestStatus.Succeeded) {
    const failures = result.getFileResponses().filter((file) => file.state === ComponentStatus.Failed);
    for (const failure of failures) {
      const reason = 'error' in failure ? failure.error : '';
      logger.error(`${failure.type} ${failure.fullName}: ${reason}`);
    }
    const errorMessage = result.response.errorMessage ? ` ${result.response.errorMessage}` : '';
    throw new SfError(
      `Deploy ${deploy.id ?? ''} finished with status ${status} (${failures.length} component failures).${errorMessage}`,
      'DeployFailed',
    );
  }

  return { deployId: deploy.id, status, componentCount: componentSet.size };
}
