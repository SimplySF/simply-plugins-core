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

import type { DeployHappySoupOptions } from './deployHappySoup.js';
import type { DeployProjectOptions } from './deployProject.js';

/** The parsed flag values of a "project" deployment stage command, keyed by kebab-case flag name. */
export type ProjectStageFlagValues = {
  'ci-job-token': string;
  alias: string;
  debug: boolean;
  'deploy-config-file': string;
  'deploy-progress-file': string;
  'deploy-rules-file': string;
  'start-from'?: string;
  'test-level'?: string;
  'test-suite'?: string;
  tests?: string;
  'vcs-host'?: string;
  'vcs-provider': DeployProjectOptions['vcsProvider'];
};

/**
 * The parsed flag values of a "happy-soup" deployment stage command, keyed by kebab-case flag name.
 *
 * `--deploy-config-file` is optional here where the project flags make it required, because
 * happy-soup falls back to deriving one from `--source-branch-name`.
 */
export type HappySoupStageFlagValues = Omit<ProjectStageFlagValues, 'deploy-config-file' | 'test-suite'> & {
  'deploy-config-file'?: string;
  'source-branch-name'?: string;
};

/**
 * Map a project stage command's parsed flags onto {@link DeployProjectOptions}.
 *
 * The kebab-case flag names and camelCase option names are a straight one-to-one rename, and it
 * was written out identically in every stage command.
 *
 * @param stage - The stage this command runs.
 * @param flags - The command's parsed flags.
 * @returns The options to hand to `deployProject()`.
 */
export function toProjectStageOptions(stage: string, flags: ProjectStageFlagValues): DeployProjectOptions {
  return {
    stage,
    ciJobToken: flags['ci-job-token'],
    alias: flags.alias,
    debug: flags.debug,
    deployConfigFile: flags['deploy-config-file'],
    deployProgressFile: flags['deploy-progress-file'],
    deployRulesFile: flags['deploy-rules-file'],
    startFrom: flags['start-from'],
    testLevel: flags['test-level'],
    testSuite: flags['test-suite'],
    tests: flags.tests,
    vcsHost: flags['vcs-host'],
    vcsProvider: flags['vcs-provider'],
  };
}

/**
 * Map a happy-soup stage command's parsed flags onto {@link DeployHappySoupOptions}.
 *
 * Same shape as {@link toProjectStageOptions}, trading `--test-suite` (which happy-soup stages
 * don't accept) for `--source-branch-name`.
 *
 * @param stage - The stage this command runs.
 * @param flags - The command's parsed flags.
 * @returns The options to hand to `deployHappySoup()`.
 */
export function toHappySoupStageOptions(stage: string, flags: HappySoupStageFlagValues): DeployHappySoupOptions {
  return {
    stage,
    ciJobToken: flags['ci-job-token'],
    alias: flags.alias,
    debug: flags.debug,
    deployConfigFile: flags['deploy-config-file'],
    deployProgressFile: flags['deploy-progress-file'],
    deployRulesFile: flags['deploy-rules-file'],
    sourceBranchName: flags['source-branch-name'],
    startFrom: flags['start-from'],
    testLevel: flags['test-level'],
    tests: flags.tests,
    vcsHost: flags['vcs-host'],
    vcsProvider: flags['vcs-provider'],
  };
}
