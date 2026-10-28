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

import type { z } from 'zod';
import { logger } from '../logger.js';
import { deployConfigSchema } from '../schemas/deployConfig.js';
import { deployRulesSchema } from '../schemas/deployRules.js';
import { determineDeployConfigFile, loadValidatedJsonFile } from './deployCommon.js';

export type ValidateDeployFilesOptions = {
  deployConfigFile?: string;
  deployRulesFile?: string;
  sourceBranchName?: string;
};

async function validateFile<T>(filePath: string, schema: z.ZodType<T>): Promise<void> {
  try {
    await loadValidatedJsonFile(filePath, schema);
    logger.success(`Validation successful for ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`Skipping validation for ${filePath} as it was not found.`);
      return;
    }
    logger.error(`Validation failed for ${filePath}: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Validates the deployment config and deployment rules files against their JSON schemas.
 * Each is validated independently: a missing file is skipped (warned, not fatal), but a malformed
 * or schema-invalid file throws.
 */
export async function validateDeployFiles(options: ValidateDeployFilesOptions): Promise<void> {
  const resolvedDeployConfigFile = determineDeployConfigFile(options.sourceBranchName, options.deployConfigFile);

  if (resolvedDeployConfigFile) {
    await validateFile(resolvedDeployConfigFile, deployConfigSchema);
  } else {
    logger.warn('No deployment config file specified or derivable from --source-branch-name. Skipping validation.');
  }

  if (options.deployRulesFile) {
    await validateFile(options.deployRulesFile, deployRulesSchema);
  } else {
    logger.warn('No deployment rules file specified. Skipping validation.');
  }
}
