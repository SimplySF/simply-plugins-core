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

import type { AlmProviderKind } from '@simplysf/simply-core';

/**
 * The set of application-lifecycle-management tools `simply-cicd` knows how to reference. Defined
 * in `@simplysf/simply-core` (so `.sfdevrc.json` can be validated without this package) and
 * re-exported here unchanged.
 */
export type { AlmProviderKind };

/** A single issue reference found in a commit log, normalized across ALM tools. */
export type AlmIssueRef = {
  /** The reference exactly as it was matched, e.g. `ABC-123` or `#42`. */
  key: string;
  /** How the reference is shown to a reader. */
  label: string;
  /** Path segment appended to the base URL to link the issue, e.g. `ABC-123` or `42`. */
  urlSegment: string;
};

/** A rendered set of issue references: always plain text, plus HTML links when a base URL is known. */
export type AlmIssueRendering = {
  plain: string;
  html: string;
};

/**
 * An issue-tracker integration, abstracted so that the notification path never encodes one tool's
 * key format or link shape. Only the parts that genuinely differ between trackers live here: how a
 * reference is recognized in a commit message, and how it is displayed and linked.
 */
export interface AlmProvider {
  readonly kind: AlmProviderKind;

  /** What this tool calls the things it tracks, for user-facing text. */
  readonly issueNoun: string;

  /**
   * Finds issue references in a commit log. `projectKeys` is only meaningful for prefix-keyed
   * trackers such as Jira; trackers that number issues per repository ignore it.
   */
  extractIssues(commitLog: string, projectKeys: string[]): AlmIssueRef[];

  /** Renders references as plain text, and as HTML links when `baseUrl` is provided. */
  render(issues: AlmIssueRef[], baseUrl?: string): AlmIssueRendering;
}

/** Constructs a provider for one ALM tool. */
export type AlmProviderFactory = () => AlmProvider;
