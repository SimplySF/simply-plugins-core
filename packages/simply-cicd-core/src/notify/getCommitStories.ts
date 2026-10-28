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

import { execa } from 'execa';
import { createAlmProvider, type AlmProvider } from '../alm/index.js';
import { getAlmProjectKeys } from '../sfConfig.js';
import { logger } from '../logger.js';

export type CommitStories = { stories: string; storiesWithUrl: string };

export type GetCommitStoriesOptions = {
  debug?: boolean;
  /**
   * Base URL the issue reference is appended to, e.g. `https://jira.example.com/browse` for Jira or
   * `https://gitlab.com/group/project/-/issues` for GitLab Issues. Links are omitted if not provided.
   */
  almBaseUrl?: string;
  /** The tracker to recognize references for. Defaults to Jira. */
  almProvider?: AlmProvider;
};

export const NOT_AVAILABLE: CommitStories = { stories: 'N/A', storiesWithUrl: 'N/A' };

/**
 * Hands a commit log to the configured `AlmProvider` to recognize its own reference format, and
 * returns both a plain string and (if `almBaseUrl` is provided) an HTML list with hyperlinks.
 * Shared by the local-git (`getCommitStories`) and remote-API (`getRemoteCommitStories`) lookups so
 * the ALM-provider glue isn't duplicated between them.
 */
export function renderIssuesFromCommitLog(
  commitLog: string,
  almProjectKey: string | undefined,
  options?: GetCommitStoriesOptions,
): CommitStories {
  const almProvider = options?.almProvider ?? createAlmProvider('jira');
  const issues = almProvider.extractIssues(commitLog, getAlmProjectKeys(almProjectKey));

  if (issues.length === 0) {
    return NOT_AVAILABLE;
  }

  const { plain, html } = almProvider.render(issues, options?.almBaseUrl);
  return { stories: plain, storiesWithUrl: html };
}

/**
 * Retrieves issue references from the commit logs between two tags/commits. Fetches the git
 * history, hands the commit messages to the configured `AlmProvider` to recognize and render its
 * own reference format, and returns both a plain string and (if `almBaseUrl` is provided) an HTML
 * list with hyperlinks.
 */
export async function getCommitStories(
  previousVersion: string | undefined,
  targetVersion: string | undefined,
  almProjectKey: string | undefined,
  options?: GetCommitStoriesOptions,
): Promise<CommitStories> {
  if (
    !previousVersion ||
    !targetVersion ||
    previousVersion === 'N/A' ||
    targetVersion === 'N/A' ||
    previousVersion === targetVersion
  ) {
    return NOT_AVAILABLE;
  }

  try {
    await execa('git', ['fetch', '--unshallow', '--prune', '--tags', '--quiet']);
    const { stdout: commits } = await execa('git', [
      'log',
      '--pretty=oneline',
      `${previousVersion}...${targetVersion}`,
    ]);

    if (!commits) {
      return NOT_AVAILABLE;
    }

    return renderIssuesFromCommitLog(commits, almProjectKey, options);
  } catch (error) {
    logger.error(`Error getting commit stories: ${(error as Error).message}`);
    if (options?.debug) {
      logger.error(String(error));
    }
    return NOT_AVAILABLE;
  }
}
