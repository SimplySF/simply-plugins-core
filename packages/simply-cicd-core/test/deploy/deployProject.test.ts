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
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import {
  installDeployPackageDependencies,
  printDeploymentSummary,
  runDeployApexTests,
  runDeploymentSteps,
} from '../../src/deploy/deployCommon.js';
import { deployProject } from '../../src/deploy/deployProject.js';

chalk.level = 0;

vi.mock('execa');
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../src/sfPlugins.js', () => ({ installDeploymentPlugins: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/deploy/deployCommon.js', () => ({
  installDeployPackageDependencies: vi.fn(),
  runDeployApexTests: vi.fn(),
  runDeploymentSteps: vi.fn(),
  printDeploymentSummary: vi.fn(),
}));

const baseOptions = { ciJobToken: 'ci-token', vcsHost: 'gitlab.com', vcsProvider: 'gitlab' as const };

describe('deployProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call installDeployPackageDependencies and installProjectPackage for the 'install-packaged' stage", async () => {
    await deployProject({ ...baseOptions, stage: 'install-packaged' });

    expect(installDeployPackageDependencies).toHaveBeenCalledOnce();
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringMatching(/Completed stage install-packaged in \d+(\.\d+)?s/),
    );
  });

  it("should call runDeployApexTests for the 'run-apex-tests' stage", async () => {
    await deployProject({ ...baseOptions, stage: 'run-apex-tests' });

    expect(runDeployApexTests).toHaveBeenCalledOnce();
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringMatching(/Completed stage run-apex-tests in \d+(\.\d+)?s/),
    );
  });

  it('should call runDeploymentSteps for other stages, defaulting file paths', async () => {
    vi.mocked(runDeploymentSteps).mockResolvedValue({ deployProgress: {} });

    await deployProject({ ...baseOptions, stage: 'pre-destructive' });

    expect(runDeploymentSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'pre-destructive',
        isProjectDeployment: true,
        deployConfigFile: 'config/deploy.json',
        deployProgressFile: 'DEPLOY_PROGRESS.json',
        deployRulesFile: 'config/deploy-rules.json',
      }),
    );
    expect(printDeploymentSummary).toHaveBeenCalledOnce();
  });

  describe('installProjectPackage logic within install-packaged', () => {
    it('should install the project package with a Mixed upgrade type by default', async () => {
      await deployProject({ ...baseOptions, stage: 'install-packaged', subscriberPackageVersionId: '04t123abc' });

      expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--upgrade-type', 'Mixed']), expect.any(Object));
    });

    it('should pass --upgrade-type to both the dependency and the project package installs', async () => {
      await deployProject({
        ...baseOptions,
        stage: 'install-packaged',
        subscriberPackageVersionId: '04t123abc',
        upgradeType: 'DeprecateOnly',
      });

      expect(installDeployPackageDependencies).toHaveBeenCalledWith(
        expect.objectContaining({ upgradeType: 'DeprecateOnly' }),
      );
      expect(execa).toHaveBeenCalledWith(
        'sf',
        expect.arrayContaining(['--upgrade-type', 'DeprecateOnly']),
        expect.any(Object),
      );
    });

    it('should install from subscriberPackageVersionId if valid', async () => {
      await deployProject({ ...baseOptions, stage: 'install-packaged', subscriberPackageVersionId: '04t123abc' });

      expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--package', '04t123abc']), expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith(
        'Installing package version from --subscriber-package-version-id: 04t123abc',
      );
    });

    it('should fall back to git-tag lookup if subscriberPackageVersionId is not a valid 04t id', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);

      await deployProject({ ...baseOptions, stage: 'install-packaged', subscriberPackageVersionId: 'invalid-id' });

      expect(logger.info).toHaveBeenCalledWith('Checking for package version in git tag...');
      expect(execa).not.toHaveBeenCalledWith(
        'sf',
        expect.arrayContaining(['--package', 'invalid-id']),
        expect.any(Object),
      );
    });

    it('should install from git tag if subscriberPackageVersionId is not provided', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: 'v1.2.3' } as never)
        .mockResolvedValueOnce({ stdout: 'v1.2.3 04t456def' } as never)
        .mockResolvedValueOnce({ stdout: '' } as never);

      await deployProject({ ...baseOptions, stage: 'install-packaged' });

      expect(execa).toHaveBeenCalledWith('git', ['tag', '--points-at', 'HEAD']);
      expect(execa).toHaveBeenCalledWith('git', ['tag', '-l', '-n1', 'v1.2.3']);
      expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--package', '04t456def']), expect.any(Object));
      expect(logger.success).toHaveBeenCalledWith('Successfully installed package 04t456def from git tag.');
    });

    it('should skip install if no git tag is found', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);

      await deployProject({ ...baseOptions, stage: 'install-packaged' });

      expect(logger.info).toHaveBeenCalledWith('No git tag found at HEAD. Skipping main package installation.');
      expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['--package']), expect.any(Object));
    });

    it('should skip install if git tag has no annotation', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: 'v1.2.3' } as never)
        .mockResolvedValueOnce({ stdout: 'v1.2.3' } as never);

      await deployProject({ ...baseOptions, stage: 'install-packaged' });

      expect(logger.info).toHaveBeenCalledWith('Git tag v1.2.3 has no annotation. Skipping main package installation.');
      expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['--package']), expect.any(Object));
    });

    it('should skip install if git tag annotation has no packageId', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: 'v1.2.3' } as never)
        .mockResolvedValueOnce({ stdout: 'v1.2.3 Some-message' } as never);

      await deployProject({ ...baseOptions, stage: 'install-packaged' });

      expect(logger.info).toHaveBeenCalledWith(
        'No 04t package version found in git tag annotation. Skipping main package installation.',
      );
      expect(execa).not.toHaveBeenCalledWith('sf', expect.arrayContaining(['--package']), expect.any(Object));
    });

    it('should warn and skip if git commands fail', async () => {
      const gitError = new Error('git failed');
      vi.mocked(execa).mockRejectedValue(gitError);

      await deployProject({ ...baseOptions, stage: 'install-packaged' });

      expect(logger.warn).toHaveBeenCalledWith(
        `Could not determine package version from git tag: ${gitError.message}. Skipping main package installation.`,
      );
    });
  });

  it('should rethrow (with a job-context banner) on failure', async () => {
    const error = new Error('Deployment failed');
    vi.mocked(runDeployApexTests).mockRejectedValue(error);

    await expect(deployProject({ ...baseOptions, stage: 'run-apex-tests' })).rejects.toThrow(error);

    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Failed stage run-apex-tests after \d+(\.\d+)?s/));
    expect(logger.raw).toHaveBeenCalledWith(error.message);
  });
});
