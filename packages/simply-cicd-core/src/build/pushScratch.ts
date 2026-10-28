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
import { getDefaultPackageDirectory, readSfdxProject } from '@simplysf/simply-core';
import { runSf } from '../exec/sfCli.js';
import { logger } from '../logger.js';
import { ensureScratchOrgSession } from './scratchOrgAuth.js';
import { readScratchOrgInfo } from './scratchOrgInfo.js';

const INCOMPATIBLE_METADATA_PATTERNS = [
  '*.eca-meta.xml',
  '*.ecaGlblOauth-meta.xml',
  '*.ecaOauth-meta.xml',
  '*.ecaOauthPlcy-meta.xml',
  '*.ecaPlcy-meta.xml',
];

async function removeIncompatibleMetadata(): Promise<void> {
  logger.info('Removing incompatible metadata before push...');
  for (const pattern of INCOMPATIBLE_METADATA_PATTERNS) {
    // eslint-disable-next-line no-await-in-loop -- deletions must not race each other on the same tree
    await execa('find', [process.cwd(), '-type', 'f', '-name', pattern, '-delete']);
  }
}

export type PushScratchOptions = {
  /** Required only when the scratch org's Dev Hub was JWT-authenticated (no refresh token available). */
  jwtKeyFile?: string;
  debug?: boolean;
  ignoreWarnings?: boolean;
  scratchOrgSourceDir?: string;
};

/** Authenticates to the scratch org, strips ECA-related metadata, and pushes source to it. */
export async function pushToScratch(options: PushScratchOptions): Promise<void> {
  logger.info('Pushing source to scratch org...');
  const scratchOrgInfo = await readScratchOrgInfo();
  await ensureScratchOrgSession(scratchOrgInfo.authFields, {
    jwtKeyFile: options.jwtKeyFile,
    setDefault: true,
    debug: options.debug,
  });

  await removeIncompatibleMetadata();

  const pushArgs = ['project', 'deploy', 'start', '--ignore-conflicts', '--wait', '120'];
  if (options.ignoreWarnings) {
    pushArgs.push('--ignore-warnings');
  }
  if (options.scratchOrgSourceDir) {
    pushArgs.push('--source-dir', options.scratchOrgSourceDir);
    const seedMetadataDir = getDefaultPackageDirectory(await readSfdxProject())?.seedMetadata?.path;
    if (seedMetadataDir) {
      pushArgs.push('--source-dir', seedMetadataDir);
    }
  }

  await runSf(pushArgs, { stdio: 'inherit' });
  logger.success('Source pushed to scratch org.');
}
