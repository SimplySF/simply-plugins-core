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
import { isSubscriberPackageVersionId, readSfdxProject } from '@simplysf/simply-core';
import { createAlmProvider, type AlmProviderKind } from '../alm/index.js';
import { VersionTagFormat } from '../build/versionTagFormat.js';
import { logger } from '../logger.js';
import { NOT_AVAILABLE, renderIssuesFromCommitLog, type CommitStories } from './getCommitStories.js';
import { renderNotifyTemplate } from './renderTemplate.js';
import { sendNotification } from './sendNotification.js';
import type { NotifyTemplateName } from './templates.js';

/** The file `build create-package-version` writes the new version's `04t` ID to. */
export const SUBSCRIBER_PACKAGE_VERSION_ID_FILE = 'subscriberPackageVersionId.env';

export type NotifyBuildResult = { sent: boolean };

export type NotifyBuildOptions = {
  ciCommitRefName?: string;
  ciJobName?: string;
  ciJobStage?: string;
  ciJobStatus?: string;
  ciPipelineId?: string;
  ciPipelineUrl?: string;
  ciProjectTitle?: string;
  subscriberPackageVersionId?: string;
  almBaseUrl?: string;
  almProjectKey?: string;
  almProvider?: AlmProviderKind;
  teamsWebhookUrl?: string[];
  debug: boolean;
};

/** The new package version's git tag and the issue references since the previous one. */
export type PackageVersionHistory = CommitStories & { versionTag: string; previousVersionTag: string };

/**
 * The `04t` ID of a package version created in this job: the explicit value if given, otherwise the
 * one `build create-package-version` wrote to {@link SUBSCRIBER_PACKAGE_VERSION_ID_FILE}. `undefined`
 * when the job created none.
 */
export async function resolveBuiltSubscriberPackageVersionId(explicit?: string): Promise<string | undefined> {
  if (explicit) {
    return explicit;
  }
  let content: string;
  try {
    content = await fs.readFile(SUBSCRIBER_PACKAGE_VERSION_ID_FILE, 'utf8');
  } catch {
    return undefined;
  }
  const value = /^SUBSCRIBER_PACKAGE_VERSION_ID=(?<id>\S+)\s*$/m.exec(content)?.groups?.id;
  return value && isSubscriberPackageVersionId(value) ? value : undefined;
}

/** Fetches the tags, and the full history when the CI clone is shallow, so tags can be described and diffed. */
export async function fetchVersionHistory(): Promise<void> {
  const { stdout } = await execa('git', ['rev-parse', '--is-shallow-repository']);
  const unshallow = stdout.trim() === 'true' ? ['--unshallow'] : [];
  await execa('git', ['fetch', ...unshallow, '--tags', '--quiet']);
}

/**
 * The tag at `HEAD` that `build create-package-version` annotated with `subscriberPackageVersionId`.
 * Matching on the annotation rather than the name works for any version tag format or suffix.
 */
export async function findPackageVersionTag(subscriberPackageVersionId: string): Promise<string | undefined> {
  const { stdout } = await execa('git', [
    'tag',
    '--points-at',
    'HEAD',
    '--format=%(refname:short)%09%(contents:subject)',
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .find(([, subject]) => subject?.trim() === subscriberPackageVersionId)?.[0];
}

/** The nearest version tag, in the project's format, before `versionTag`. `undefined` for a package's first version. */
export async function findPreviousVersionTag(versionTag: string): Promise<string | undefined> {
  const project = await readSfdxProject().catch(() => undefined);
  const glob = VersionTagFormat.fromProject(project).matchPattern();
  try {
    const { stdout } = await execa('git', ['describe', '--tags', '--abbrev=0', '--match', glob, `${versionTag}^`]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the new version's tag, the previous version's tag, and the issue references in between.
 * Never throws: anything it can't resolve comes back as `N/A`, because a notification shouldn't be
 * what fails a build.
 */
export async function getPackageVersionHistory(
  subscriberPackageVersionId: string,
  options: Pick<NotifyBuildOptions, 'almBaseUrl' | 'almProjectKey' | 'almProvider' | 'debug'>,
): Promise<PackageVersionHistory> {
  const history: PackageVersionHistory = { ...NOT_AVAILABLE, versionTag: 'N/A', previousVersionTag: 'N/A' };
  try {
    await fetchVersionHistory();

    const versionTag = await findPackageVersionTag(subscriberPackageVersionId);
    if (!versionTag) {
      logger.warn(`No tag at HEAD is annotated with ${subscriberPackageVersionId}.`);
      return history;
    }
    history.versionTag = versionTag;

    const previousVersionTag = await findPreviousVersionTag(versionTag);
    if (!previousVersionTag) {
      logger.info(`No version tag before ${versionTag}. Skipping stories.`);
      return history;
    }
    history.previousVersionTag = previousVersionTag;

    const { stdout: commits } = await execa('git', ['log', '--pretty=oneline', `${previousVersionTag}..${versionTag}`]);
    if (commits) {
      Object.assign(
        history,
        renderIssuesFromCommitLog(commits, options.almProjectKey, {
          almBaseUrl: options.almBaseUrl,
          almProvider: createAlmProvider(options.almProvider ?? 'jira'),
        }),
      );
    }
  } catch (error) {
    logger.warn(`Could not resolve package version history: ${(error as Error).message}`);
    if (options.debug) {
      logger.error(String(error));
    }
  }
  return history;
}

/**
 * Posts a failure card for a failed build job, or a package version card for a successful job that
 * created a package version. Any other job result sends nothing.
 */
export async function sendBuildNotification(options: NotifyBuildOptions): Promise<NotifyBuildResult> {
  const { ciJobStatus } = options;

  const templateData: Record<string, unknown> = {
    refName: options.ciCommitRefName,
    pipelineUrl: options.ciPipelineUrl,
    pipelineId: options.ciPipelineId,
    projectTitle: options.ciProjectTitle,
    jobName: options.ciJobName,
    stage: options.ciJobStage,
    stories: 'N/A',
    storiesLinked: 'N/A',
  };
  let templateName: NotifyTemplateName;

  if (ciJobStatus === 'failed') {
    templateName = 'build-failure-notification';
  } else if (ciJobStatus === 'success') {
    const subscriberPackageVersionId = await resolveBuiltSubscriberPackageVersionId(options.subscriberPackageVersionId);
    if (!subscriberPackageVersionId) {
      logger.info('No package version was created in this job. Skipping notification.');
      return { sent: false };
    }
    templateName = 'build-package-version-notification';
    logger.info(`Gathering stories for package version ${subscriberPackageVersionId}...`);
    const history = await getPackageVersionHistory(subscriberPackageVersionId, options);
    Object.assign(templateData, {
      subscriberPackageVersionId,
      packageVersion: history.versionTag,
      packageVersionPrevious: history.previousVersionTag,
      stories: history.stories,
      storiesLinked: history.storiesWithUrl,
    });
  } else {
    logger.info(`No notification logic for job status: ${ciJobStatus ?? 'unknown'}`);
    return { sent: false };
  }

  const payload = {
    content: renderNotifyTemplate(templateName, templateData),
    refName: options.ciCommitRefName,
    pipelineId: options.ciPipelineId,
    pipelineUrl: options.ciPipelineUrl,
    projectTitle: options.ciProjectTitle,
    jobName: options.ciJobName,
    jobStage: options.ciJobStage,
    jobStatus: ciJobStatus,
    stories: templateData.stories,
    storiesLinked: templateData.storiesLinked,
    packageVersionPrevious: templateData.packageVersionPrevious,
    packageVersion: templateData.packageVersion,
    subscriberPackageVersionId: templateData.subscriberPackageVersionId,
  };

  await sendNotification(options.teamsWebhookUrl, payload);
  return { sent: true };
}
