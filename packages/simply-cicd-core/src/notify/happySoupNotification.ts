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

import { createAlmProvider, type AlmProvider, type AlmProviderKind } from '../alm/index.js';
import { createVcsProvider } from '../vcs/index.js';
import { loadProgress } from '../deploy/deployCommon.js';
import { resolvePackageOrigin } from '../happySoup/resolveOriginProject.js';
import { logger } from '../logger.js';
import type { UpgradedPackage } from '../schemas/deployProgress.js';
import { NOT_AVAILABLE, type CommitStories } from './getCommitStories.js';

/** Compares by value rather than by reference, so a mocked/reconstructed `NOT_AVAILABLE` still counts. */
function isNotAvailable(result: CommitStories): boolean {
  return result.stories === NOT_AVAILABLE.stories && result.storiesWithUrl === NOT_AVAILABLE.storiesWithUrl;
}
import { getRemoteCommitStories } from './getRemoteCommitStories.js';
import { renderNotifyTemplate } from './renderTemplate.js';
import { sendNotification } from './sendNotification.js';
import type { NotifyTemplateName } from './templates.js';

export type NotifyHappySoupResult = { sent: boolean };

export type NotifyHappySoupOptions = {
  ciCommitRefName?: string;
  ciEnvironmentName?: string;
  ciJobName?: string;
  ciJobStage?: string;
  ciJobStatus?: string;
  ciPipelineId?: string;
  ciPipelineUrl?: string;
  teamsWebhookUrl?: string[];
  notifyOnCompletion: boolean;
  deployProgressFile?: string;
  almBaseUrl?: string;
  almProjectKey?: string;
  almProvider?: AlmProviderKind;
  ciJobToken?: string;
  projectAccessToken?: string;
  debug?: boolean;
};

type UpgradedPackageStories = { packageName: string; storiesLinked: string };

/**
 * Resolves stories for one upgraded package: tries the CI job token first, falling back to a
 * personal/project access token if the job token can't read the origin repo (a job token is
 * typically scoped to its own project only, unless the target project has explicitly allowlisted
 * it). Since a "no stories found" result is indistinguishable from "couldn't read the repo" once
 * `getRemoteCommitStories` has swallowed the error, any non-`NOT_AVAILABLE` result from either
 * attempt wins; if both come back `NOT_AVAILABLE`, that's the final answer either way.
 */
async function resolvePackageStories(
  upgradedPackage: UpgradedPackage,
  options: NotifyHappySoupOptions,
  almProvider: AlmProvider,
): Promise<CommitStories> {
  const origin = resolvePackageOrigin(upgradedPackage.packageName, upgradedPackage.targetDescription);
  if (!origin) {
    if (options.debug) {
      logger.debug(`Could not resolve the origin repo for package ${upgradedPackage.packageName}.`);
    }
    return NOT_AVAILABLE;
  }

  const tokens: Array<{ token: string; tokenKind: 'job' | 'personal' }> = [];
  if (options.ciJobToken) {
    tokens.push({ token: options.ciJobToken, tokenKind: 'job' });
  }
  if (options.projectAccessToken) {
    tokens.push({ token: options.projectAccessToken, tokenKind: 'personal' });
  }

  let result: CommitStories = NOT_AVAILABLE;
  for (const { token, tokenKind } of tokens) {
    const vcsProvider = createVcsProvider(origin.vcsProvider, { host: origin.host, token, tokenKind });
    // eslint-disable-next-line no-await-in-loop -- try the job token first; only fall back to a personal/project access token if it came back empty
    result = await getRemoteCommitStories(
      vcsProvider,
      origin.projectPath,
      upgradedPackage.prevTag,
      upgradedPackage.targetTag,
      options.almProjectKey,
      { almProvider, almBaseUrl: options.almBaseUrl, debug: options.debug },
    );
    if (!isNotAvailable(result)) {
      break;
    }
  }

  return result;
}

/** Resolves stories for every upgraded package recorded in the deploy progress file. */
async function resolveUpgradedPackageStories(options: NotifyHappySoupOptions): Promise<UpgradedPackageStories[]> {
  const deployProgressFile = options.deployProgressFile ?? 'DEPLOY_PROGRESS.json';
  const progress = await loadProgress(deployProgressFile);
  const upgradedPackages = progress.upgradedPackages ?? [];

  if (upgradedPackages.length === 0) {
    return [];
  }

  const almProvider = createAlmProvider(options.almProvider ?? 'jira');
  const results: UpgradedPackageStories[] = [];

  for (const upgradedPackage of upgradedPackages) {
    // eslint-disable-next-line no-await-in-loop -- each package's origin repo may require a separate token/provider; resolving one at a time keeps the fallback logic simple
    const { storiesWithUrl } = await resolvePackageStories(upgradedPackage, options, almProvider);
    results.push({ packageName: upgradedPackage.packageName, storiesLinked: storiesWithUrl });
  }

  return results;
}

/** Posts a "starting stage" card to Teams. */
export async function happySoupNotifyBeforeScript(options: NotifyHappySoupOptions): Promise<NotifyHappySoupResult> {
  const stage = options.ciJobStage ?? 'N/A';
  const templateData = {
    stage,
    environmentName: options.ciEnvironmentName ?? 'N/A',
    refName: options.ciCommitRefName ?? 'N/A',
    pipelineUrl: options.ciPipelineUrl ?? '#',
    pipelineId: options.ciPipelineId ?? 'N/A',
  };

  const message = renderNotifyTemplate('happy-soup-starting-stage-notification', templateData);

  const payload = {
    content: message,
    environmentName: options.ciEnvironmentName,
    refName: options.ciCommitRefName,
    pipelineId: options.ciPipelineId,
    pipelineUrl: options.ciPipelineUrl,
    jobName: options.ciJobName,
    jobStage: stage,
    jobStatus: options.ciJobStatus ?? 'running',
  };

  await sendNotification(options.teamsWebhookUrl, payload);
  return { sent: true };
}

/** Posts a stage (or final) success/failure card to Teams, depending on `--notify-on-completion`. */
export async function happySoupNotifyAfterScript(options: NotifyHappySoupOptions): Promise<NotifyHappySoupResult> {
  const stage = options.ciJobStage ?? 'N/A';
  const failed = options.ciJobStatus === 'failed';

  const templateData: Record<string, unknown> = {
    stage,
    environmentName: options.ciEnvironmentName ?? 'N/A',
    refName: options.ciCommitRefName ?? 'N/A',
    pipelineUrl: options.ciPipelineUrl ?? '#',
    pipelineId: options.ciPipelineId ?? 'N/A',
  };

  if (!failed) {
    templateData.upgradedPackages = await resolveUpgradedPackageStories(options);
  }

  const templateName: NotifyTemplateName = options.notifyOnCompletion
    ? failed
      ? 'happy-soup-final-failure-notification'
      : 'happy-soup-final-success-notification'
    : failed
      ? 'happy-soup-failure-notification'
      : 'happy-soup-success-notification';

  const message = renderNotifyTemplate(templateName, templateData);

  const payload = {
    content: message,
    environmentName: options.ciEnvironmentName,
    refName: options.ciCommitRefName,
    pipelineId: options.ciPipelineId,
    pipelineUrl: options.ciPipelineUrl,
    jobName: options.ciJobName,
    jobStage: options.ciJobStage,
    jobStatus: options.ciJobStatus,
    upgradedPackages: templateData.upgradedPackages,
  };

  await sendNotification(options.teamsWebhookUrl, payload);
  return { sent: true };
}
