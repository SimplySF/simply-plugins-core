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
import path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import type { z } from 'zod';
import { createVcsProvider, type VcsProvider, type VcsProviderKind } from '../vcs/index.js';
import { cloneRepo } from '../git.js';
import { logger } from '../logger.js';
import { runApexTests as runApexTestsCommon } from '../sfApex.js';
import { installPackageDependencies as installPackageDependenciesCommon } from '../sfPackages.js';
import { installDeploymentPlugins } from '../sfPlugins.js';
import { deployConfigSchema, type DeployConfig } from '../schemas/deployConfig.js';
import { deployProgressSchema, type DeployProgress } from '../schemas/deployProgress.js';
import { deployRulesSchema, type DeployRules } from '../schemas/deployRules.js';

/**
 * A Salesforce org this command operates on, referenced by an alias the calling pipeline has
 * already authenticated — `simply-cicd` never authenticates orgs itself. Optional here because not
 * every stage needs one (e.g. `deployment-close-out`); commands that do require it declare
 * `alias` as `required: true` on the flag itself.
 */
export type OrgAuthConfig = {
  alias?: string;
};

/** A deployment entry from `deploy.json`, plus the synthetic `{ name: 'local' }` project deployment. */
export type StageDeployment = {
  [key: string]: unknown;
  name: string;
  slug?: string;
  ref?: string;
  postDeploy?: boolean;
  postDestructive?: boolean;
  preDestructive?: boolean;
  unpackagedDeploy?: boolean;
  testLevel?: string;
  tests?: string;
};

export type StageProperty = 'postDeploy' | 'postDestructive' | 'preDestructive' | 'unpackagedDeploy';

/** Validates `data` against a zod schema, throwing a formatted error (one bullet per issue) if it fails. */
export function validateWithSchema<T>(schema: z.ZodType<T>, data: unknown, fileName: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('');
    throw new Error(`Invalid format for ${fileName}: ${errorMessages}`);
  }
  return result.data;
}

/**
 * Read a JSON file and validate it against a zod schema.
 *
 * @param filePath - The file to read. Its name appears in the error on a schema violation.
 * @param schema - The schema to validate against.
 * @returns The validated contents.
 * @throws {Error} With one bullet per schema issue, via {@link validateWithSchema}.
 * @throws {NodeJS.ErrnoException} If the file can't be read — callers check for `ENOENT` to
 * treat a missing file as non-fatal.
 * @throws {SyntaxError} If the file isn't valid JSON.
 */
export async function loadValidatedJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const contents = await fs.readFile(filePath, 'utf-8');

  return validateWithSchema(schema, JSON.parse(contents) as unknown, filePath);
}

/** Validates a deployment configuration against a set of deployment rules (e.g. "prod must run postDeploy"). */
export async function validateDeploymentRules(deploymentConfig: DeployConfig, rulesFile: string): Promise<void> {
  let rulesConfig: DeployRules;
  try {
    rulesConfig = await loadValidatedJsonFile(rulesFile, deployRulesSchema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info(`Deployment rules file not found at ${rulesFile}. Skipping rules validation.`);
      return;
    }
    logger.error(`Failed to read or validate ${rulesFile}: ${(error as Error).message}`);
    throw error;
  }

  const errors: string[] = [];
  for (const rule of rulesConfig.rules) {
    const deployment = deploymentConfig.deployments.find((d) => {
      const matchesName = Boolean(rule.deploymentName) && d.name === rule.deploymentName;
      const matchesSlug = Boolean(rule.deploymentSlug) && d.slug === rule.deploymentSlug;
      return matchesName || matchesSlug;
    });

    if (deployment) {
      for (const requiredStage of rule.requireStages) {
        if (!deployment[requiredStage]) {
          let identifier: string;
          if (rule.deploymentName && rule.deploymentSlug) {
            identifier = `name '${rule.deploymentName}' or slug '${rule.deploymentSlug}'`;
          } else if (rule.deploymentName) {
            identifier = `name '${rule.deploymentName}'`;
          } else {
            identifier = `slug '${rule.deploymentSlug ?? 'unknown'}'`;
          }
          errors.push(`Deployment with ${identifier} is missing required stage '${requiredStage}'.`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Deployment configuration failed validation against deployment rules:\n${errors.join('\n')}`);
  }

  logger.success('Deployment configuration passed validation against deployment rules.');
}

export const STAGE_TO_SCRIPT_NAME_MAP: Record<string, string> = {
  'pre-destructive': 'preDestructive.sh',
  'deploy-unpackaged': 'unpackagedDeploy.sh',
  'post-deploy': 'postDeploy.sh',
  'post-destructive': 'postDestructive.sh',
};

export const STAGE_TO_PROPERTY_MAP: Record<string, string> = {
  'pre-destructive': 'preDestructive',
  'install-packaged': 'installPackaged',
  'deploy-unpackaged': 'unpackagedDeploy',
  'post-deploy': 'postDeploy',
  'post-destructive': 'postDestructive',
};

export const STAGE_CONFIG: Record<string, { property: StageProperty }> = {
  'pre-destructive': { property: 'preDestructive' },
  'deploy-unpackaged': { property: 'unpackagedDeploy' },
  'post-deploy': { property: 'postDeploy' },
  'post-destructive': { property: 'postDestructive' },
};

/** Atomically updates a progress file: writes to a temp file first, then renames it into place. */
export async function updateProgress(deployProgressFile: string, newProgress: DeployProgress): Promise<void> {
  const tempFile = `${deployProgressFile}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(newProgress, null, 2));
  await fs.rename(tempFile, deployProgressFile);
}

const DIRS_TO_CHMOD: Array<{ dir: string; mode: string }> = [
  { dir: 'logs', mode: '+rw' },
  { dir: 'data', mode: '+rw' },
  { dir: 'bin', mode: '+rx' },
  { dir: 'scripts', mode: '+rw' },
];

async function chmodStageDirectories(repoDir: string, jobName: string): Promise<void> {
  for (const { dir, mode } of DIRS_TO_CHMOD) {
    const dirPath = path.join(repoDir, dir);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(dirPath);
    } catch {
      continue;
    }

    try {
      logger.info(`[${jobName}] Modifying permissions of ${dir} to ${mode}...`);
      // eslint-disable-next-line no-await-in-loop
      await execa('chmod', ['-R', mode, `./${dir}`], { cwd: repoDir });
    } catch {
      logger.warn(
        `[${jobName}] Could not modify permissions for ${dir}. This might cause issues on non-Windows systems.`,
      );
    }
  }
}

export type ExecuteStageScriptConfig = {
  alias?: string;
  testLevel?: string;
  tests?: string;
};

/**
 * Executes a stage-specific script (e.g. `bin/preDestructive.sh`) for a deployment: installs npm
 * production dependencies if a `package.json` exists, sets executable/writable permissions on the
 * repo's working directories, and runs the script with `--target-org`/`--test-level`/`--tests`.
 */
export async function executeStageScript(
  deployment: StageDeployment,
  stage: string,
  repoDir: string,
  config: ExecuteStageScriptConfig,
): Promise<void> {
  const { alias } = config;
  const jobName = deployment.name.toUpperCase();
  const scriptName = STAGE_TO_SCRIPT_NAME_MAP[stage];
  if (!scriptName) {
    logger.info(`No script configured for stage ${stage}, skipping script execution.`);
    return;
  }
  const scriptPath = path.join(repoDir, 'bin', scriptName);

  try {
    await fs.access(scriptPath);
  } catch {
    logger.info(`Script ${scriptPath} not found for deployment ${deployment.name}, skipping.`);
    return;
  }

  logger.info(`[${jobName}] Preparing to run ${scriptName}`);
  const packageJsonPath = path.join(repoDir, 'package.json');
  try {
    await fs.access(packageJsonPath);
    logger.info(`[${jobName}] Installing npm dependencies...`);
    await execa('npm', ['install', '--omit=dev'], { cwd: repoDir, env: { HUSKY_SKIP_INSTALL: '1' } });
  } catch {
    // No package.json for this repo; nothing to install.
  }

  await chmodStageDirectories(repoDir, jobName);

  const testLevel = deployment.testLevel ?? config.testLevel ?? 'RunLocalTests';
  const tests = deployment.tests ?? config.tests ?? '';

  const scriptArgs = ['--target-org', alias ?? '', '--test-level', testLevel];
  if (tests) {
    scriptArgs.push('--tests', tests);
  }

  logger.info(`[${jobName}] Executing: ./${path.join('bin', scriptName)} ${scriptArgs.join(' ')}`);

  await execa(path.resolve(scriptPath), scriptArgs, { cwd: repoDir, stdio: 'inherit' });
}

export type DeployInstallPackageDependenciesConfig = OrgAuthConfig & {
  wait?: string;
  installType?: 'All' | 'Delta' | 'Upgrade';
  upgradeType?: 'DeprecateOnly' | 'Mixed' | 'Delete';
};

/** Installs the target org's packaged dependencies. The org must already be authenticated. */
export async function installDeployPackageDependencies(config: DeployInstallPackageDependenciesConfig): Promise<void> {
  const { alias, wait = '120', installType = 'Upgrade', upgradeType } = config;
  await installPackageDependenciesCommon({ alias, wait, installType, upgradeType });
}

/** Logs a per-job duration summary for the given stage, from the recorded progress file durations. */
export function printDeploymentSummary(deployProgress: DeployProgress, stage: string): void {
  try {
    const stageConfig = STAGE_CONFIG[stage];
    if (!stageConfig) {
      return;
    }
    const stageProperty = stageConfig.property;

    if (!deployProgress.durations) {
      return;
    }

    const jobs: Array<{ name: string; duration: number }> = [];
    for (const [jobName, durations] of Object.entries(deployProgress.durations)) {
      if (durations?.[stageProperty] !== undefined) {
        jobs.push({ name: jobName.toUpperCase(), duration: durations[stageProperty] });
      }
    }

    if (jobs.length === 0) {
      return;
    }

    logger.raw('\n');
    logger.info(`Job Summary: ${chalk.bold(stage)}`);
    for (const job of jobs) {
      logger.info(`  - Job: ${job.name} | Duration: ${job.duration}s`);
    }
  } catch (error) {
    logger.warn(`Could not generate deployment summary: ${(error as Error).message}`);
  }
}

export type RunApexTestsConfig = OrgAuthConfig & {
  testLevel?: string;
  testSuite?: string;
  wait?: string;
  debugMode?: boolean;
};

/** Runs Apex tests on the target org. The org must already be authenticated. */
export async function runDeployApexTests(config: RunApexTestsConfig): Promise<void> {
  const { alias, testLevel = 'RunLocalTests', testSuite, wait = '360' } = config;

  logger.info(`Running Apex tests on org ${alias ?? 'unknown'}...`);
  await runApexTestsCommon({ alias, testLevel, testSuite, wait, debugMode: config.debugMode });
}

export async function loadProgress(deployProgressFile: string): Promise<DeployProgress> {
  try {
    return await loadValidatedJsonFile(deployProgressFile, deployProgressSchema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    logger.warn(`Could not read or validate ${deployProgressFile}: ${(error as Error).message}. Starting fresh.`);
    return {};
  }
}

type LoadDeployConfigResult = { found: true; config: DeployConfig } | { found: false };

async function loadDeployConfig(deployConfigFile: string, deployRulesFile: string): Promise<LoadDeployConfigResult> {
  try {
    const deploymentConfig = await loadValidatedJsonFile(deployConfigFile, deployConfigSchema);
    await validateDeploymentRules(deploymentConfig, deployRulesFile);
    return { found: true, config: deploymentConfig };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(
        `Deployment config file not found at ${deployConfigFile}. Skipping deployments from config for this stage.`,
      );
      return { found: false };
    }
    logger.error(`Failed to read or validate ${deployConfigFile}: ${(error as Error).message}`);
    throw error;
  }
}

function resolveStartFrom(
  progress: DeployProgress,
  stage: string,
  stageProperty: StageProperty,
  startFrom?: string,
): { effectiveStartFrom?: string; idxOffset: number } {
  if (startFrom) {
    logger.info(`Starting ${chalk.bold(stage)} from job: ${chalk.bold(startFrom)} (forced by CLI option)`);
    return { effectiveStartFrom: startFrom, idxOffset: 0 };
  }

  const resumePoint = progress[stageProperty];
  if (resumePoint && resumePoint !== 'COMPLETE') {
    logger.info(`Resuming ${chalk.bold(stage)} from job: ${chalk.bold(resumePoint)} (offset 1) based on progress file`);
    return { effectiveStartFrom: resumePoint, idxOffset: 1 };
  }

  return { idxOffset: 0 };
}

function buildDeploymentsToRun(
  deploymentConfig: DeployConfig | undefined,
  isProjectDeployment: boolean | undefined,
  stageProperty: StageProperty,
  effectiveStartFrom: string | undefined,
  idxOffset: number,
): StageDeployment[] {
  let deploymentsToRun: StageDeployment[] = deploymentConfig?.deployments ?? [];

  if (isProjectDeployment) {
    const localDeployment: StageDeployment = { name: 'local' };
    localDeployment[stageProperty] = true;
    deploymentsToRun = [...deploymentsToRun, localDeployment];
  }

  if (effectiveStartFrom) {
    const startIndex = deploymentsToRun.findIndex((d) => d.name === effectiveStartFrom);
    if (startIndex === -1) {
      throw new Error(`Start job ${chalk.bold(effectiveStartFrom)} not found in deployments configuration.`);
    }
    deploymentsToRun = deploymentsToRun.slice(startIndex + idxOffset);
  }

  return deploymentsToRun.filter((d) => Boolean(d[stageProperty]));
}

export type RunDeploymentStepsConfig = OrgAuthConfig & {
  deployConfigFile: string;
  deployRulesFile: string;
  deployProgressFile: string;
  stage: string;
  startFrom?: string;
  isProjectDeployment?: boolean;
  debug?: boolean;
  testLevel?: string;
  tests?: string;
  ciJobToken: string;
  vcsHost?: string;
  vcsProvider: VcsProviderKind;
};

export type RunDeploymentStepsResult = { deployProgress: DeployProgress };

async function runDeploymentJob(
  deployment: StageDeployment,
  stage: string,
  stageProperty: StageProperty,
  progress: DeployProgress,
  deployProgressFile: string,
  config: RunDeploymentStepsConfig,
  vcsProvider: VcsProvider,
): Promise<void> {
  const jobName = deployment.name.toUpperCase();

  logger.raw('\n' + '='.repeat(80));
  logger.info(`>>> Starting Job: ${chalk.bold(jobName)} <<<`);
  logger.raw('='.repeat(80) + '\n');

  const startTime = Date.now();
  try {
    const repoDir =
      deployment.name.toLowerCase() === 'local'
        ? process.cwd()
        : await cloneRepo(
            { name: deployment.name, slug: deployment.slug ?? '', ref: deployment.ref },
            { ciJobToken: config.ciJobToken, vcsProvider },
          );

    await installDeploymentPlugins(config.debug, repoDir);
    await executeStageScript(deployment, stage, repoDir, config);

    const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

    progress[stageProperty] = deployment.name;
    progress.durations ??= {};
    progress.durations[deployment.name] ??= {};
    progress.durations[deployment.name][stageProperty] = durationSeconds;

    await updateProgress(deployProgressFile, progress);

    logger.raw('\n' + '='.repeat(80));
    logger.success(`Completed Job: ${chalk.bold(jobName)} in ${durationSeconds}s`);
    logger.raw('='.repeat(80) + '\n');
  } catch (error) {
    (error as Error & { job?: string }).job = jobName;
    throw error;
  }
}

/**
 * Runs a complete set of deployment jobs for a stage: loads (and validates) the progress and
 * config files, determines where to resume from, then clones/prepares/executes each job in order
 * — persisting progress after every job so a mid-run crash can resume cleanly. The target org
 * (`config.alias`) must already be authenticated.
 */
export async function runDeploymentSteps(config: RunDeploymentStepsConfig): Promise<RunDeploymentStepsResult> {
  const { deployConfigFile, deployRulesFile, isProjectDeployment, deployProgressFile, stage, startFrom } = config;

  const progress = await loadProgress(deployProgressFile);
  const deployConfigResult = await loadDeployConfig(deployConfigFile, deployRulesFile);

  if (!deployConfigResult.found && !isProjectDeployment) {
    return { deployProgress: progress };
  }

  const stageConfig = STAGE_CONFIG[stage];
  if (!stageConfig) {
    throw new Error(`Invalid or unsupported stage for deployment jobs: ${chalk.bold(stage)}`);
  }
  const stageProperty = stageConfig.property;

  const { effectiveStartFrom, idxOffset } = resolveStartFrom(progress, stage, stageProperty, startFrom);
  const deploymentsToRun = buildDeploymentsToRun(
    deployConfigResult.found ? deployConfigResult.config : undefined,
    isProjectDeployment,
    stageProperty,
    effectiveStartFrom,
    idxOffset,
  );

  if (deploymentsToRun.length === 0) {
    logger.info(`No deployments configured for ${chalk.bold(stage)}.`);
    return { deployProgress: progress };
  }

  const vcsProvider = createVcsProvider(config.vcsProvider, { host: config.vcsHost, token: config.ciJobToken });

  for (const deployment of deploymentsToRun) {
    // eslint-disable-next-line no-await-in-loop
    await runDeploymentJob(deployment, stage, stageProperty, progress, deployProgressFile, config, vcsProvider);
  }

  progress[stageProperty] = 'COMPLETE';
  await updateProgress(deployProgressFile, progress);

  return { deployProgress: progress };
}

/** Determines the deploy config file path: explicit path wins, else derived from the branch name. */
export function determineDeployConfigFile(sourceBranchName?: string, deployConfigFile?: string): string | undefined {
  if (deployConfigFile) {
    return deployConfigFile;
  }
  if (!sourceBranchName) {
    return undefined;
  }
  const branchNamePart = sourceBranchName.includes('/') ? sourceBranchName.split('/')[1] : sourceBranchName;
  return `deployment-configs/${branchNamePart}.json`;
}
