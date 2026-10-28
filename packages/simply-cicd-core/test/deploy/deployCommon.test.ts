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

import { promises as fsPromises } from 'node:fs';
import chalk from 'chalk';
import { execa } from 'execa';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneRepo } from '../../src/git.js';

// Deterministic, non-ANSI log output for exact-string assertions below (chalk.bold(...) is used
// throughout deployCommon.ts for terminal emphasis).
chalk.level = 0;
import { logger } from '../../src/logger.js';
import { runApexTests as runApexTestsCommon } from '../../src/sfApex.js';
import { installPackageDependencies as installPackageDependenciesCommon } from '../../src/sfPackages.js';
import {
  determineDeployConfigFile,
  executeStageScript,
  installDeployPackageDependencies,
  printDeploymentSummary,
  runDeployApexTests,
  runDeploymentSteps,
  validateDeploymentRules,
  validateWithSchema,
} from '../../src/deploy/deployCommon.js';
import type { DeployConfig } from '../../src/schemas/deployConfig.js';

vi.mock('execa');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: { ...actual.promises, access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() },
  };
});
vi.mock('../../src/git.js', () => ({ cloneRepo: vi.fn() }));
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
vi.mock('../../src/sfApex.js', () => ({ runApexTests: vi.fn() }));
vi.mock('../../src/sfPackages.js', () => ({ installPackageDependencies: vi.fn() }));
vi.mock('../../src/sfPlugins.js', () => ({ installDeploymentPlugins: vi.fn() }));

const baseRunConfig = {
  deployConfigFile: 'config/deploy.json',
  deployProgressFile: 'DEPLOY_PROGRESS.json',
  deployRulesFile: 'config/deploy-rules.json',
  alias: 'test-org',
  ciJobToken: 'test-ci-token',
  vcsHost: 'gitlab.com',
  vcsProvider: 'gitlab' as const,
};

function mockDeployFiles(overrides: { deployConfig?: unknown; progress?: unknown; rulesEnoent?: boolean } = {}): void {
  vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
    const p = filePath as string;
    if (p.includes('PROGRESS.json')) {
      return JSON.stringify(overrides.progress ?? {});
    }
    if (p.includes('deploy-rules.json')) {
      if (overrides.rulesEnoent !== false) {
        const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        throw err;
      }
      return JSON.stringify({ rules: [] });
    }
    // Anything else is the deploy config file (default 'config/deploy.json', or overridden per-test).
    if (overrides.deployConfig === undefined) {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw err;
    }
    return JSON.stringify(overrides.deployConfig);
  });
}

describe('deployCommon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWithSchema', () => {
    const schema = z.object({ name: z.string() });

    it('should not throw for valid data', () => {
      expect(() => validateWithSchema(schema, { name: 'test' }, 'test-file')).not.toThrow();
    });

    it('should throw for invalid data', () => {
      expect(() => validateWithSchema(schema, { age: 20 }, 'test-file')).toThrow('Invalid format for test-file');
    });

    it('should include detailed error messages', () => {
      expect(() => validateWithSchema(schema, {}, 'test-file')).toThrow(/name/);
    });
  });

  describe('validateDeploymentRules', () => {
    const rulesFile = 'deploy-rules.json';

    it('should pass if deployment config satisfies the rules', async () => {
      const deploymentConfig: DeployConfig = { deployments: [{ name: 'my-deploy', unpackagedDeploy: true }] };
      const rulesConfig = { rules: [{ deploymentName: 'my-deploy', requireStages: ['unpackagedDeploy'] }] };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(rulesConfig));

      await expect(validateDeploymentRules(deploymentConfig, rulesFile)).resolves.toBeUndefined();
      expect(logger.success).toHaveBeenCalledWith(
        'Deployment configuration passed validation against deployment rules.',
      );
    });

    it('should throw an error if a required stage is missing', async () => {
      const deploymentConfig: DeployConfig = { deployments: [{ name: 'my-deploy' }] };
      const rulesConfig = { rules: [{ deploymentName: 'my-deploy', requireStages: ['unpackagedDeploy'] }] };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(rulesConfig));

      await expect(validateDeploymentRules(deploymentConfig, rulesFile)).rejects.toThrow(
        "Deployment with name 'my-deploy' is missing required stage 'unpackagedDeploy'.",
      );
    });

    it('should skip validation if rules file is not found', async () => {
      const deploymentConfig: DeployConfig = { deployments: [] };
      const error = Object.assign(new Error('File not found'), { code: 'ENOENT' });
      vi.mocked(fsPromises.readFile).mockRejectedValue(error);

      await expect(validateDeploymentRules(deploymentConfig, rulesFile)).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        `Deployment rules file not found at ${rulesFile}. Skipping rules validation.`,
      );
    });

    it('should throw an error for invalid JSON in rules file', async () => {
      const deploymentConfig: DeployConfig = { deployments: [] };
      vi.mocked(fsPromises.readFile).mockResolvedValue('invalid json');

      await expect(validateDeploymentRules(deploymentConfig, rulesFile)).rejects.toThrow();
    });

    it('should find deployment by slug', async () => {
      const deploymentConfig: DeployConfig = { deployments: [{ name: 'some-name', slug: 'my-slug' }] };
      const rulesConfig = { rules: [{ deploymentSlug: 'my-slug', requireStages: ['postDeploy'] }] };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(rulesConfig));

      await expect(validateDeploymentRules(deploymentConfig, rulesFile)).rejects.toThrow(
        "Deployment with slug 'my-slug' is missing required stage 'postDeploy'.",
      );
    });
  });

  describe('installDeployPackageDependencies', () => {
    it('should install dependencies against the given alias', async () => {
      await installDeployPackageDependencies({ alias: 'my-org', wait: '60' });

      expect(installPackageDependenciesCommon).toHaveBeenCalledWith({
        alias: 'my-org',
        wait: '60',
        installType: 'Upgrade',
      });
    });

    it('should pass the upgrade type through', async () => {
      await installDeployPackageDependencies({ alias: 'my-org', upgradeType: 'Delete' });

      expect(installPackageDependenciesCommon).toHaveBeenCalledWith(expect.objectContaining({ upgradeType: 'Delete' }));
    });
  });

  describe('runDeployApexTests', () => {
    it('should run tests against the given alias', async () => {
      await runDeployApexTests({ alias: 'my-org', testLevel: 'RunSpecifiedTests' });

      expect(runApexTestsCommon).toHaveBeenCalledWith(
        expect.objectContaining({ alias: 'my-org', testLevel: 'RunSpecifiedTests', wait: '360' }),
      );
    });
  });

  describe('executeStageScript', () => {
    const deployment = { name: 'test-deploy' };
    const stage = 'pre-destructive';
    const repoDir = '/path/to/repo';
    const config = { alias: 'test-org' };

    it('should prepare, make executable, and execute script on success', async () => {
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'success' } as never);

      await executeStageScript(deployment, stage, repoDir, config);

      expect(execa).toHaveBeenCalledWith('chmod', ['-R', '+rx', './bin'], { cwd: repoDir });
      expect(execa).toHaveBeenCalledWith(
        expect.stringContaining('preDestructive.sh'),
        ['--target-org', 'test-org', '--test-level', 'RunLocalTests'],
        expect.objectContaining({ cwd: repoDir }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[TEST-DEPLOY] Preparing to run preDestructive.sh'),
      );
    });

    it('should throw error if execa fails', async () => {
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockImplementation((async (cmd: string) => {
        if (cmd === 'chmod') {
          return { stdout: 'chmod success' };
        }
        throw new Error('Script execution failed');
      }) as never);

      await expect(executeStageScript(deployment, stage, repoDir, config)).rejects.toThrow('Script execution failed');
    });

    it('should modify permissions for specified directories if they exist', async () => {
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'success' } as never);

      await executeStageScript(deployment, stage, repoDir, config);

      expect(execa).toHaveBeenCalledWith('chmod', ['-R', '+rw', './logs'], { cwd: repoDir });
      expect(execa).toHaveBeenCalledWith('chmod', ['-R', '+rw', './data'], { cwd: repoDir });
      expect(execa).toHaveBeenCalledWith('chmod', ['-R', '+rx', './bin'], { cwd: repoDir });
      expect(execa).toHaveBeenCalledWith('chmod', ['-R', '+rw', './scripts'], { cwd: repoDir });
    });

    it('should skip modifying permissions for directories that do not exist', async () => {
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('preDestructive.sh')) {
          return undefined;
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'success' } as never);

      await executeStageScript(deployment, stage, repoDir, config);

      expect(execa).not.toHaveBeenCalledWith('chmod', expect.any(Array), expect.any(Object));
    });
  });

  describe('runDeploymentSteps', () => {
    it('should record overall execution time in DEPLOY_PROGRESS.json', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [{ name: 'step-one', slug: 'repo-slug', unpackagedDeploy: true }],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });
      vi.mocked(cloneRepo).mockResolvedValue('/path/to/step-one');
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged' });

      expect(cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ name: 'step-one' }), expect.any(Object));
      expect(logger.success).toHaveBeenCalledWith(expect.stringMatching(/Completed Job: STEP-ONE in \d+(\.\d+)?s/));

      const writeFileCalls = vi.mocked(fsPromises.writeFile).mock.calls;
      const progressContentCall = writeFileCalls.find((call) => (call[0] as string).includes('DEPLOY_PROGRESS.json'));
      expect(progressContentCall).toBeDefined();
      const writtenObj = JSON.parse(progressContentCall?.[1] as string) as {
        unpackagedDeploy: string;
        durations: Record<string, Record<string, number>>;
      };
      expect(writtenObj.unpackagedDeploy).toBe('step-one');
      expect(writtenObj.durations).toBeDefined();
      expect(writtenObj.durations['step-one']).toBeDefined();
      expect(writtenObj.durations['step-one'].unpackagedDeploy).toEqual(expect.any(Number));
    });

    it('should execute the local repository script after config deployments when isProjectDeployment is true', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [{ name: 'step-one', slug: 'repo-slug', unpackagedDeploy: true }],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });
      vi.mocked(cloneRepo).mockResolvedValue('/path/to/step-one');
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged', isProjectDeployment: true });

      expect(cloneRepo).toHaveBeenCalledTimes(1);
      expect(cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ name: 'step-one' }), expect.any(Object));
      expect(fsPromises.access).toHaveBeenCalledWith(expect.stringContaining('unpackagedDeploy.sh'));

      const writeFileCalls = vi.mocked(fsPromises.writeFile).mock.calls;
      const progressContentCalls = writeFileCalls.filter((call) =>
        (call[0] as string).includes('DEPLOY_PROGRESS.json'),
      );
      const progressContentCall = progressContentCalls[progressContentCalls.length - 1];
      const writtenObj = JSON.parse(progressContentCall[1] as string) as {
        unpackagedDeploy: string;
        durations: Record<string, Record<string, number>>;
      };
      expect(writtenObj.unpackagedDeploy).toBe('COMPLETE');
      expect(writtenObj.durations['step-one']).toBeDefined();
      expect(writtenObj.durations.local).toBeDefined();
    });

    it('should run the local repository script even if config file is missing', async () => {
      mockDeployFiles();
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged', isProjectDeployment: true });

      expect(cloneRepo).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Deployment config file not found'));
      expect(fsPromises.access).toHaveBeenCalledWith(expect.stringContaining('unpackagedDeploy.sh'));
    });

    it("should process a deployment in the config file as local if name is 'local' or 'Local', skipping cloneRepo", async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [
          { name: 'local', unpackagedDeploy: true },
          { name: 'Local', unpackagedDeploy: true },
        ],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });
      vi.mocked(fsPromises.access).mockImplementation(async (p) => {
        if (String(p).includes('package.json')) {
          throw new Error('package.json not found');
        }
        return undefined;
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged' });

      expect(cloneRepo).not.toHaveBeenCalled();

      const writeFileCalls = vi.mocked(fsPromises.writeFile).mock.calls;
      const progressContentCalls = writeFileCalls.filter((call) =>
        (call[0] as string).includes('DEPLOY_PROGRESS.json'),
      );
      const progressContentCall = progressContentCalls[progressContentCalls.length - 1];
      const writtenObj = JSON.parse(progressContentCall[1] as string) as {
        unpackagedDeploy: string;
        durations: Record<string, Record<string, number>>;
      };
      expect(writtenObj.unpackagedDeploy).toBe('COMPLETE');
      expect(writtenObj.durations.local).toBeDefined();
      expect(writtenObj.durations.Local).toBeDefined();
    });

    it('should return successfully without crashing when no deployments are configured for a stage', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [{ name: 'step-one', slug: 'repo-slug', preDestructive: false }],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });

      const result = await runDeploymentSteps({ ...baseRunConfig, stage: 'pre-destructive' });

      expect(logger.info).toHaveBeenCalledWith('No deployments configured for pre-destructive.');
      expect(result).toEqual({ deployProgress: {} });
    });

    it('should return successfully when config file is missing and isProjectDeployment is false', async () => {
      mockDeployFiles();

      const result = await runDeploymentSteps({
        ...baseRunConfig,
        stage: 'pre-destructive',
        deployConfigFile: 'non-existent.json',
        isProjectDeployment: false,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Deployment config file not found'));
      expect(result).toEqual({ deployProgress: {} });
    });

    it('should resume from the correct step based on the progress file', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [
          { name: 'job-A', slug: 'slug-A', unpackagedDeploy: true },
          { name: 'job-B', slug: 'slug-B', unpackagedDeploy: true },
          { name: 'job-C', slug: 'slug-C', unpackagedDeploy: true },
        ],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig, progress: { unpackagedDeploy: 'job-A' } });
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged' });

      expect(logger.info).toHaveBeenCalledWith(
        'Resuming deploy-unpackaged from job: job-A (offset 1) based on progress file',
      );
      expect(cloneRepo).toHaveBeenCalledTimes(2);
      expect(cloneRepo).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'job-A' }), expect.any(Object));
      expect(cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ name: 'job-B' }), expect.any(Object));
      expect(cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ name: 'job-C' }), expect.any(Object));
    });

    it('should start from the step specified by startFrom, ignoring the progress file', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [
          { name: 'job-A', slug: 'slug-A', unpackagedDeploy: true },
          { name: 'job-B', slug: 'slug-B', unpackagedDeploy: true },
          { name: 'job-C', slug: 'slug-C', unpackagedDeploy: true },
        ],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig, progress: { unpackagedDeploy: 'job-A' } });
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockResolvedValue({ stdout: 'done' } as never);

      await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged', startFrom: 'job-C' });

      expect(logger.info).toHaveBeenCalledWith('Starting deploy-unpackaged from job: job-C (forced by CLI option)');
      expect(cloneRepo).toHaveBeenCalledTimes(1);
      expect(cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ name: 'job-C' }), expect.any(Object));
    });

    it('should throw an error with the job name when a script execution fails', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [{ name: 'job-fail', slug: 'slug-fail', unpackagedDeploy: true }],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });
      vi.mocked(cloneRepo).mockResolvedValue('/path/to/job-fail');
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      const scriptError = new Error('Script execution failed!');
      vi.mocked(execa).mockImplementation((async (cmd: string) => {
        if (cmd === 'chmod') {
          return { stdout: '' };
        }
        throw scriptError;
      }) as never);

      await expect(runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged' })).rejects.toThrow(scriptError);

      try {
        await runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged' });
      } catch (e) {
        expect((e as Error & { job?: string }).job).toBe('JOB-FAIL');
      }

      const wasCompleted = vi.mocked(fsPromises.writeFile).mock.calls.some((call) => {
        const progress = JSON.parse(call[1] as string) as { unpackagedDeploy?: string };
        return progress.unpackagedDeploy === 'COMPLETE';
      });
      expect(wasCompleted).toBe(false);
    });

    it('should throw an error if the startFrom job does not exist in the config', async () => {
      const mockDeployConfig: DeployConfig = {
        deployments: [{ name: 'job-A', slug: 'slug-A', unpackagedDeploy: true }],
      };
      mockDeployFiles({ deployConfig: mockDeployConfig });

      await expect(
        runDeploymentSteps({ ...baseRunConfig, stage: 'deploy-unpackaged', startFrom: 'job-D' }),
      ).rejects.toThrow('Start job job-D not found in deployments configuration.');
    });
  });

  describe('printDeploymentSummary', () => {
    it('should print a summary when durations exist for the stage', () => {
      const mockProgress = {
        durations: { 'step-one': { unpackagedDeploy: 12.34 }, local: { unpackagedDeploy: 5.67 } },
      };

      printDeploymentSummary(mockProgress, 'deploy-unpackaged');

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Job Summary:'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Job: STEP-ONE | Duration: 12.34s'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Job: LOCAL | Duration: 5.67s'));
    });

    it('should do nothing if progress file lacks durations for the stage', () => {
      const mockProgress = { durations: { 'step-one': { preDestructive: 12.34 } } };

      printDeploymentSummary(mockProgress, 'deploy-unpackaged');

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should do nothing if progress data is missing', () => {
      printDeploymentSummary({}, 'deploy-unpackaged');

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('determineDeployConfigFile', () => {
    it('returns the explicit file if provided', () => {
      expect(determineDeployConfigFile('release/uat', 'config/deploy.json')).toBe('config/deploy.json');
    });

    it('derives from a branch name with a slash', () => {
      expect(determineDeployConfigFile('release/uat', undefined)).toBe('deployment-configs/uat.json');
    });

    it('derives from a branch name without a slash', () => {
      expect(determineDeployConfigFile('uat', undefined)).toBe('deployment-configs/uat.json');
    });

    it('returns undefined if neither is provided', () => {
      expect(determineDeployConfigFile(undefined, undefined)).toBeUndefined();
    });
  });
});
