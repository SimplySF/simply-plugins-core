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
import { isSubscriberPackageVersionId } from '@simplysf/simply-core';
import type { VcsProviderKind } from '../vcs/index.js';
import { logger } from '../logger.js';
import { runDeployStage } from './runDeployStage.js';
import {
  installDeployPackageDependencies,
  printDeploymentSummary,
  runDeployApexTests,
  runDeploymentSteps,
  type OrgAuthConfig,
  type RunApexTestsConfig,
} from './deployCommon.js';

type UpgradeType = 'DeprecateOnly' | 'Mixed' | 'Delete';

async function installPackageById(
  packageId: string,
  alias: string | undefined,
  upgradeType: UpgradeType,
): Promise<void> {
  await execa(
    'sf',
    [
      'package',
      'install',
      '--apex-compile',
      'package',
      '--package',
      packageId,
      '--target-org',
      alias ?? '',
      '--wait',
      '120',
      '--upgrade-type',
      upgradeType,
      '--no-prompt',
    ],
    { stdio: 'inherit' },
  );
}

async function installProjectPackageFromSubscriberId(
  subscriberPackageVersionId: string,
  alias: string | undefined,
  upgradeType: UpgradeType,
): Promise<void> {
  logger.info(`Installing package version from --subscriber-package-version-id: ${subscriberPackageVersionId}`);
  await installPackageById(subscriberPackageVersionId, alias, upgradeType);
  logger.success(`Successfully installed package ${subscriberPackageVersionId}.`);
}

async function installProjectPackageFromGitTag(alias: string | undefined, upgradeType: UpgradeType): Promise<void> {
  logger.info('Checking for package version in git tag...');
  try {
    const { stdout: currentTagRaw } = await execa('git', ['tag', '--points-at', 'HEAD']);
    const currentTag = currentTagRaw.split('\n')[0].trim();

    if (!currentTag) {
      logger.info('No git tag found at HEAD. Skipping main package installation.');
      return;
    }

    logger.info(`Found git tag ${currentTag}, checking for package ID...`);
    const { stdout: tagAnnotation } = await execa('git', ['tag', '-l', '-n1', currentTag]);
    const parts = tagAnnotation.trim().split(/\s+/);

    if (parts.length <= 1) {
      logger.info(`Git tag ${currentTag} has no annotation. Skipping main package installation.`);
      return;
    }

    const packageId = parts.slice(1).join(' ');
    if (!isSubscriberPackageVersionId(packageId)) {
      logger.info('No 04t package version found in git tag annotation. Skipping main package installation.');
      return;
    }

    logger.info(`Found package ID ${packageId} in tag. Installing...`);
    await installPackageById(packageId, alias, upgradeType);
    logger.success(`Successfully installed package ${packageId} from git tag.`);
  } catch (error) {
    logger.warn(
      `Could not determine package version from git tag: ${(error as Error).message}. Skipping main package installation.`,
    );
  }
}

export type InstallProjectPackageConfig = OrgAuthConfig & {
  subscriberPackageVersionId?: string;
  debug?: boolean;
  upgradeType?: UpgradeType;
};

/**
 * Installs the project's own package into the target org: prioritizes `--subscriber-package-version-id`
 * if given, else looks for a `04t...` package ID annotated on the git tag pointing at HEAD.
 */
async function installProjectPackage(config: InstallProjectPackageConfig): Promise<void> {
  const { alias, subscriberPackageVersionId, upgradeType = 'Mixed' } = config;
  logger.info('Installing main package...');

  if (subscriberPackageVersionId && isSubscriberPackageVersionId(subscriberPackageVersionId)) {
    await installProjectPackageFromSubscriberId(subscriberPackageVersionId, alias, upgradeType);
  } else {
    await installProjectPackageFromGitTag(alias, upgradeType);
  }
}

export type DeployProjectOptions = OrgAuthConfig &
  RunApexTestsConfig &
  InstallProjectPackageConfig & {
    stage: string;
    deployConfigFile?: string;
    deployRulesFile?: string;
    deployProgressFile?: string;
    startFrom?: string;
    tests?: string;
    ciJobToken: string;
    vcsHost?: string;
    vcsProvider: VcsProviderKind;
    installType?: 'All' | 'Delta' | 'Upgrade';
  };

/**
 * Runs a single-package "project" deployment stage: `install-packaged` installs dependencies plus
 * the project's own package, `run-apex-tests` delegates to the shared Apex test runner, and every
 * other stage runs through the resumable deployment-steps loop against `config/deploy.json`.
 */
export async function deployProject(options: DeployProjectOptions): Promise<void> {
  const { stage, ...config } = options;

  await runDeployStage(stage, options, async () => {
    if (stage === 'install-packaged') {
      await installDeployPackageDependencies(config);
      await installProjectPackage(config);
    } else if (stage === 'run-apex-tests') {
      await runDeployApexTests(config);
    } else {
      const { deployProgress } = await runDeploymentSteps({
        ...config,
        isProjectDeployment: true,
        stage,
        deployConfigFile: config.deployConfigFile ?? 'config/deploy.json',
        deployProgressFile: config.deployProgressFile ?? 'DEPLOY_PROGRESS.json',
        deployRulesFile: config.deployRulesFile ?? 'config/deploy-rules.json',
      });
      printDeploymentSummary(deployProgress, stage);
    }
  });
}
