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
import { execa } from 'execa';
import { getDefaultPackageDirectory, readSfdxProject } from '@simplysf/simply-core';
import { logger } from '../logger.js';
import { VersionTagFormat } from './versionTagFormat.js';

async function resolveLastTag(tagMatchPattern: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['describe', '--tags', '--abbrev=0', '--match', tagMatchPattern]);
    return stdout.trim();
  } catch {
    logger.info(`No previous release tag (${tagMatchPattern}) found. A full package build is required.`);
    return '';
  }
}

async function detectChangesSincePackagePath(packagePath: string, lastTag: string): Promise<boolean> {
  logger.info(`Running git diff on path: "${packagePath}" and "sfdx-project.json"`);
  const { stdout: diffOutput } = await execa('git', [
    'diff',
    '--name-only',
    lastTag,
    'HEAD',
    '--',
    packagePath,
    'sfdx-project.json',
  ]);
  if (diffOutput.trim().length > 0) {
    logger.info(`Changes detected in package directory or project config:\n${diffOutput}`);
    return true;
  }
  logger.success('No changes detected in package directory or project config.');
  return false;
}

type PackageChangeDetection = { packageChanged: boolean; lastTag: string };

async function detectPackageChanges(): Promise<PackageChangeDetection> {
  const projectJson = await readSfdxProject();
  const defaultDir = getDefaultPackageDirectory(projectJson);
  if (!defaultDir?.path) {
    logger.warn('No default package directory found in sfdx-project.json. Defaulting to PACKAGE_CHANGED=FALSE.');
    return { packageChanged: false, lastTag: '' };
  }

  logger.info('Fetching remote tags...');
  await execa('git', ['fetch', '--tags']);

  const tagMatchPattern = VersionTagFormat.fromProject(projectJson).matchPattern(defaultDir.versionNumber);
  const lastTag = await resolveLastTag(tagMatchPattern);
  if (!lastTag) {
    return { packageChanged: true, lastTag: '' };
  }

  logger.info(`Last package tag found: ${lastTag}`);
  const packageChanged = await detectChangesSincePackagePath(defaultDir.path, lastTag);
  return { packageChanged, lastTag };
}

export type DeterminePackageChangesOptions = {
  out?: string;
  debug?: boolean;
};

/**
 * Detects whether any files under the default package directory (or `sfdx-project.json` itself)
 * have changed since the last release tag, and writes the result as a dotenv file. Any failure
 * during detection (missing/invalid sfdx-project.json, git errors) defaults to `PACKAGE_CHANGED=TRUE`
 * so a build never silently skips work it should have done.
 */
export async function determinePackageChanges(options: DeterminePackageChangesOptions): Promise<void> {
  logger.info('Determining package changes...');
  const outFile = options.out ?? 'changes.env';

  let packageChanged: boolean;
  let lastTag: string;
  try {
    ({ packageChanged, lastTag } = await detectPackageChanges());
  } catch (err) {
    logger.error(`Error during change detection: ${(err as Error).message}. Defaulting to full build.`);
    packageChanged = true;
    lastTag = '';
  }

  const envContent = `PACKAGE_CHANGED=${packageChanged ? 'TRUE' : 'FALSE'}\nLAST_TAG=${lastTag}\n`;
  await fs.writeFile(outFile, envContent, 'utf-8');
  logger.success(`Wrote change detection results to ${outFile}`);
}
