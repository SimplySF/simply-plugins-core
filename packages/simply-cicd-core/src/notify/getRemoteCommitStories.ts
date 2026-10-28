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

import type { VcsProjectRef, VcsProvider } from '../vcs/index.js';
import { logger } from '../logger.js';
import {
  NOT_AVAILABLE,
  renderIssuesFromCommitLog,
  type CommitStories,
  type GetCommitStoriesOptions,
} from './getCommitStories.js';

/**
 * Retrieves issue references from the commit log between two refs in a *remote* VCS project —
 * the happy-soup equivalent of `getCommitStories`, for packaged dependencies whose source isn't
 * the current pipeline's own repo, so there's no local git history to read. Fetches the commit
 * log via `vcsProvider.compareRefs`, then hands it to the same `AlmProvider` rendering used by the
 * local-git lookup.
 */
export async function getRemoteCommitStories(
  vcsProvider: VcsProvider,
  project: VcsProjectRef,
  prevTag: string | undefined,
  targetTag: string | undefined,
  almProjectKey: string | undefined,
  options?: GetCommitStoriesOptions,
): Promise<CommitStories> {
  if (!prevTag || !targetTag || prevTag === targetTag) {
    return NOT_AVAILABLE;
  }

  try {
    const commits = await vcsProvider.compareRefs(project, prevTag, targetTag);

    if (commits.length === 0) {
      return NOT_AVAILABLE;
    }

    const commitLog = commits.map((commit) => commit.message).join('\n');
    return renderIssuesFromCommitLog(commitLog, almProjectKey, options);
  } catch (error) {
    logger.error(`Error getting remote commit stories: ${(error as Error).message}`);
    if (options?.debug) {
      logger.error(String(error));
    }
    return NOT_AVAILABLE;
  }
}
