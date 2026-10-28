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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { validateDeployFiles } from '../../src/deploy/validate.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn() } };
});
vi.mock('../../src/logger.js', () => ({
  logger: { success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const VALID_CONFIG = JSON.stringify({ deployments: [{ name: 'local', unpackagedDeploy: true }] });
const VALID_RULES = JSON.stringify({ rules: [] });
const notFound = (): never => {
  throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
};

/** Serves the given file contents (or a thrower) by exact path; anything else is an unexpected read. */
function mockFiles(files: Record<string, string | (() => never)>): void {
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    const content = files[file as string];
    if (content === undefined) {
      throw new Error(`unexpected read: ${file as string}`);
    }
    return typeof content === 'function' ? content() : content;
  });
}

describe('validateDeployFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates both files successfully', async () => {
    mockFiles({ 'deploy.json': VALID_CONFIG, 'deploy-rules.json': VALID_RULES });

    await validateDeployFiles({ deployConfigFile: 'deploy.json', deployRulesFile: 'deploy-rules.json' });

    expect(logger.success).toHaveBeenCalledWith('Validation successful for deploy.json');
    expect(logger.success).toHaveBeenCalledWith('Validation successful for deploy-rules.json');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('derives the deploy config file from sourceBranchName', async () => {
    mockFiles({ 'deployment-configs/my-branch.json': VALID_CONFIG, 'deploy-rules.json': VALID_RULES });

    await validateDeployFiles({ sourceBranchName: 'feature/my-branch', deployRulesFile: 'deploy-rules.json' });

    expect(logger.success).toHaveBeenCalledWith('Validation successful for deployment-configs/my-branch.json');
    expect(logger.success).toHaveBeenCalledWith('Validation successful for deploy-rules.json');
  });

  it('prefers an explicit deployConfigFile over sourceBranchName', async () => {
    mockFiles({ 'deployment-configs/custom.json': VALID_CONFIG, 'config/deploy-rules.json': VALID_RULES });

    await validateDeployFiles({
      deployConfigFile: 'deployment-configs/custom.json',
      deployRulesFile: 'config/deploy-rules.json',
      sourceBranchName: 'release/uat',
    });

    expect(logger.success).toHaveBeenCalledWith('Validation successful for deployment-configs/custom.json');
  });

  it('fails validation for an invalid deploy config file', async () => {
    mockFiles({
      'deploy.json': JSON.stringify({ deployments: [{ slug: 'invalid' }] }),
      'deploy-rules.json': VALID_RULES,
    });

    await expect(
      validateDeployFiles({ deployConfigFile: 'deploy.json', deployRulesFile: 'deploy-rules.json' }),
    ).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Validation failed for deploy.json:'));
  });

  it('fails validation for an invalid deploy rules file', async () => {
    mockFiles({ 'deploy.json': VALID_CONFIG, 'deploy-rules.json': JSON.stringify({ invalid: 'rules' }) });

    await expect(
      validateDeployFiles({ deployConfigFile: 'deploy.json', deployRulesFile: 'deploy-rules.json' }),
    ).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Validation failed for deploy-rules.json:'));
  });

  it('warns if the deploy config file is not found', async () => {
    mockFiles({ 'deploy.json': notFound, 'deploy-rules.json': VALID_RULES });

    await validateDeployFiles({ deployConfigFile: 'deploy.json', deployRulesFile: 'deploy-rules.json' });

    expect(logger.warn).toHaveBeenCalledWith('Skipping validation for deploy.json as it was not found.');
    expect(logger.success).toHaveBeenCalledWith('Validation successful for deploy-rules.json');
  });

  it('warns if the deploy rules file is not found', async () => {
    mockFiles({ 'deploy.json': VALID_CONFIG, 'deploy-rules.json': notFound });

    await validateDeployFiles({ deployConfigFile: 'deploy.json', deployRulesFile: 'deploy-rules.json' });

    expect(logger.warn).toHaveBeenCalledWith('Skipping validation for deploy-rules.json as it was not found.');
    expect(logger.success).toHaveBeenCalledWith('Validation successful for deploy.json');
  });

  it('warns that the rules file is unset when only a config file is given', async () => {
    mockFiles({ 'config/deploy.json': VALID_CONFIG });

    await validateDeployFiles({ deployConfigFile: 'config/deploy.json' });

    expect(logger.success).toHaveBeenCalledWith('Validation successful for config/deploy.json');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No deployment rules file'));
  });

  it('warns (not throws) if neither file is specified and no sourceBranchName is given', async () => {
    await validateDeployFiles({});

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No deployment config file'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No deployment rules file'));
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
