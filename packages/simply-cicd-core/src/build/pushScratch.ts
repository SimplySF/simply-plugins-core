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
import { Duration } from '@salesforce/kit';
import { getDefaultPackageDirectory, readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../logger.js';
import { deployProjectSource } from '../sfDeploy.js';
import { ensureScratchOrgSession } from './scratchOrgAuth.js';
import { readScratchOrgInfo } from './scratchOrgInfo.js';

/** File name suffixes of External Client App metadata, which scratch orgs reject. */
const INCOMPATIBLE_METADATA_SUFFIXES = [
  '.eca-meta.xml',
  '.ecaGlblOauth-meta.xml',
  '.ecaOauth-meta.xml',
  '.ecaOauthPlcy-meta.xml',
  '.ecaPlcy-meta.xml',
];

/** Never searched: neither holds project metadata, and node_modules can be huge. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

async function findFiles(dir: string, matches: (name: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      // eslint-disable-next-line no-await-in-loop -- a depth-first walk; the tree is small once node_modules is skipped
      found.push(...(await findFiles(entryPath, matches)));
    } else if (entry.isFile() && matches(entry.name)) {
      found.push(entryPath);
    }
  }
  return found;
}

/** What `find . -type f -name '*.eca*-meta.xml' -delete` did, without depending on find. */
async function removeIncompatibleMetadata(): Promise<void> {
  logger.info('Removing incompatible metadata before push...');
  const files = await findFiles(process.cwd(), (name) =>
    INCOMPATIBLE_METADATA_SUFFIXES.some((suffix) => name.endsWith(suffix)),
  );
  await Promise.all(files.map((file) => fs.rm(file)));
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

  // What `sf project deploy start --ignore-conflicts --wait 120 [--ignore-warnings] [--source-dir …]`
  // did, against the scratch org ensureScratchOrgSession just made the default target org.
  const sourceDirs: string[] = [];
  if (options.scratchOrgSourceDir) {
    sourceDirs.push(options.scratchOrgSourceDir);
    const seedMetadataDir = getDefaultPackageDirectory(await readSfdxProject())?.seedMetadata?.path;
    if (seedMetadataDir) {
      sourceDirs.push(seedMetadataDir);
    }
  }

  await deployProjectSource({
    sourceDirs,
    ignoreWarnings: options.ignoreWarnings ?? false,
    wait: Duration.minutes(120),
  });
  logger.success('Source pushed to scratch org.');
}
