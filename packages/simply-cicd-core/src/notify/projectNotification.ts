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
import { execa } from 'execa';
import { getDefaultPackageDirectory, isSubscriberPackageVersionId, readSfdxProject } from '@simplysf/simply-core';
import { createAlmProvider, type AlmProviderKind } from '../alm/index.js';
import { runSf, runSfJson } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { appendToEnvFile } from '../env.js';
import { getCommitStories } from './getCommitStories.js';
import { renderNotifyTemplate } from './renderTemplate.js';
import { sendNotification } from './sendNotification.js';
import type { NotifyTemplateName } from './templates.js';

export type NotifyProjectResult = { sent: boolean };

type PrevInstalledPackageVersionParams = {
  alias?: string;
  debug: boolean;
};

type TargetPackageVersionParams = {
  /** The packaging DevHub's alias. Must already be authenticated. */
  packagingDevhub?: string;
  subscriberPackageVersionId?: string;
  debug: boolean;
};

export type NotifyProjectOptions = {
  alias?: string;
  ciCommitRefName?: string;
  ciEnvironmentName?: string;
  ciJobName?: string;
  ciJobStage?: string;
  ciJobStatus?: string;
  ciPipelineId?: string;
  ciPipelineUrl?: string;
  ciProjectTitle?: string;
  packagingDevhub?: string;
  almBaseUrl?: string;
  almProjectKey?: string;
  almProvider?: AlmProviderKind;
  prevInstalledPackageVersion?: string;
  subscriberPackageVersionId?: string;
  targetPackageVersion?: string;
  teamsWebhookUrl?: string[];
  debug: boolean;
};

/** Queries the target org's installed package version. The org must already be authenticated. */
export async function resolvePrevInstalledPackageVersion(params: PrevInstalledPackageVersionParams): Promise<string> {
  const { alias, debug } = params;
  if (!alias) {
    logger.warn('No --alias given. Skipping installed package version check.');
    return 'N/A';
  }

  try {
    const packageName = getDefaultPackageDirectory(await readSfdxProject())?.package;

    logger.info(`Get installed package version from alias ${alias} for package ${packageName ?? 'unknown'}...`);
    const installedList = await runSfJson<{
      result: Array<{ SubscriberPackageName?: string; SubscriberPackageVersionNumber?: string }>;
    }>(['package', 'installed', 'list', '--target-org', alias, '--json']);
    const pkg = installedList.result.find((p) => p.SubscriberPackageName === packageName);
    return pkg?.SubscriberPackageVersionNumber ? `v${pkg.SubscriberPackageVersionNumber}` : 'N/A';
  } catch (error) {
    logger.warn(`Could not query installed package version: ${(error as Error).message}`);
    if (debug) {
      logger.error(String(error));
    }
    return 'N/A';
  }
}

/** Resolves the released package's version from the packaging DevHub. Returns `undefined` on any failure. */
export async function resolveTargetPackageVersionFromDevHub(
  params: TargetPackageVersionParams,
): Promise<string | undefined> {
  const { packagingDevhub, subscriberPackageVersionId, debug } = params;

  if (!packagingDevhub) {
    logger.warn('No --packaging-devhub given. Skipping target package version check from DevHub.');
    return undefined;
  }

  if (!subscriberPackageVersionId || !isSubscriberPackageVersionId(subscriberPackageVersionId)) {
    return undefined;
  }

  try {
    logger.info(`Get latest package version for package version ID ${subscriberPackageVersionId}...`);
    const { stdout } = await runSf([
      'package',
      'version',
      'report',
      '--package',
      subscriberPackageVersionId,
      '--target-dev-hub',
      packagingDevhub,
      '--json',
    ]);
    const versionReport = JSON.parse(stdout) as { result: { Version?: string } };
    return versionReport.result.Version ? `v${versionReport.result.Version}` : undefined;
  } catch (error) {
    logger.warn(`Could not get target package version from DevHub: ${(error as Error).message}`);
    if (debug) {
      logger.error(String(error));
    }
    return undefined;
  }
}

/** Falls back to the git tag pointing at HEAD when the DevHub can't resolve a target version. */
export async function resolveTargetPackageVersionFromGitTag(debug: boolean): Promise<string> {
  logger.info('Falling back to git tag for target version...');
  try {
    const { stdout } = await execa('git', ['tag', '--points-at', 'HEAD']);
    if (stdout) {
      return stdout.trim().split('\n')[0];
    }
    logger.warn('No git tag found at HEAD.');
  } catch (error) {
    logger.warn(`Could not get git tag: ${(error as Error).message}`);
    if (debug) {
      logger.error(String(error));
    }
  }
  return 'N/A';
}

export async function resolveTargetPackageVersion(params: TargetPackageVersionParams): Promise<string> {
  const fromDevHub = await resolveTargetPackageVersionFromDevHub(params);
  return fromDevHub ?? resolveTargetPackageVersionFromGitTag(params.debug);
}

/** Resolves and records the previously installed and target package versions for later stages. */
export async function projectNotifyBeforeScript(options: NotifyProjectOptions): Promise<void> {
  logger.info('Initializing before-script for project notification...');

  if (options.ciJobStage !== 'pre-destructive' || options.ciJobStatus === 'canceled') {
    logger.info(
      `No notify before-script logic for job stage: ${options.ciJobStage ?? 'unknown'}, status: ${options.ciJobStatus ?? 'unknown'}`,
    );
    return;
  }

  logger.info('Running before_script for project notification...');
  await fs.writeFile('project-build.env', `CREATED_BY_JOB_NAME=${options.ciJobName ?? ''}\n`);

  const prevInstalledPackageVersion = await resolvePrevInstalledPackageVersion({
    alias: options.alias,
    debug: options.debug,
  });

  const targetPackageVersion = await resolveTargetPackageVersion({
    packagingDevhub: options.packagingDevhub,
    subscriberPackageVersionId: options.subscriberPackageVersionId,
    debug: options.debug,
  });

  appendToEnvFile(
    'project-build.env',
    { PREV_INSTALLED_PACKAGE_VERSION: prevInstalledPackageVersion, TARGET_PACKAGE_VERSION: targetPackageVersion },
    logger,
  );

  logger.success('before_script for project notification finished.');
  logger.log(`PREV_INSTALLED_PACKAGE_VERSION=${prevInstalledPackageVersion}`);
  logger.log(`TARGET_PACKAGE_VERSION=${targetPackageVersion}`);
}

/** Posts the deployment result card (with Jira stories on success) to Teams. */
export async function projectNotifyAfterScript(options: NotifyProjectOptions): Promise<NotifyProjectResult> {
  const { ciJobStage, ciJobStatus } = options;

  const templateData: Record<string, unknown> = {
    environmentName: options.ciEnvironmentName,
    refName: options.ciCommitRefName,
    pipelineUrl: options.ciPipelineUrl,
    pipelineId: options.ciPipelineId,
    projectTitle: options.ciProjectTitle,
    storiesLinked: 'N/A',
    stage: ciJobStage,
  };
  let notifyCommitStories = 'N/A';
  let templateName: NotifyTemplateName;

  if (ciJobStage === 'post-destructive' && ciJobStatus === 'success') {
    templateName = 'project-success-notification';
    logger.info('Gathering stories for successful deployment...');
    const { stories, storiesWithUrl } = await getCommitStories(
      options.prevInstalledPackageVersion,
      options.targetPackageVersion,
      options.almProjectKey,
      {
        debug: options.debug,
        almBaseUrl: options.almBaseUrl,
        almProvider: createAlmProvider(options.almProvider ?? 'jira'),
      },
    );
    notifyCommitStories = stories;
    templateData.storiesLinked = storiesWithUrl;
  } else if (ciJobStatus === 'failed') {
    templateName = 'project-failure-notification';
  } else {
    logger.info(`No notification logic for job status: ${ciJobStatus ?? 'unknown'}`);
    return { sent: false };
  }

  const notifyMessage = renderNotifyTemplate(templateName, templateData);

  const payload = {
    content: notifyMessage,
    environmentName: options.ciEnvironmentName,
    refName: options.ciCommitRefName,
    pipelineId: options.ciPipelineId,
    pipelineUrl: options.ciPipelineUrl,
    projectTitle: options.ciProjectTitle,
    jobName: options.ciJobName,
    jobStage: ciJobStage,
    jobStatus: ciJobStatus,
    stories: notifyCommitStories,
    storiesLinked: templateData.storiesLinked,
    packageVersionPrevious: options.prevInstalledPackageVersion,
    packageVersion: options.targetPackageVersion,
  };

  await sendNotification(options.teamsWebhookUrl, payload);
  return { sent: true };
}
