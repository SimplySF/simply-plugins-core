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
import { execa } from 'execa';
import { getDefaultPackageDirectory, readSfdxProject } from '@simplysf/simply-core';
import type { VcsProvider } from './vcs/index.js';
import { logger } from './logger.js';
import { VersionTagFormat, VersionTagFormatError } from './build/versionTagFormat.js';

export type Deployment = {
  name: string;
  slug: string;
  ref?: string;
};

export type CloneRepoOptions = {
  ciJobToken: string;
  vcsProvider: VcsProvider;
};

/**
 * The git tag a dependency pinned at `versionPart` was recorded under. `1.2.3-4` and `1.2.3.4` are
 * rendered through the project's version tag format, on the assumption that dependencies share the
 * project's tag convention (a deployment's explicit `ref` covers one that doesn't). Anything else,
 * e.g. `1.2.3-LATEST`, keeps the original `v<pin>` reading.
 */
export function toDependencyRef(versionPart: string, versionTagFormat: VersionTagFormat): string {
  const match = /^(?<version>\d+\.\d+\.\d+)[-.](?<build>\d+)$/.exec(versionPart);
  if (match?.groups) {
    return versionTagFormat.render(`${match.groups.version}.${match.groups.build}`);
  }
  return `v${versionPart}`;
}

/**
 * Clones a repository based on deployment metadata and options. If a specific branch or tag
 * (ref) is not specified, it attempts to deduce the ref from package dependencies in
 * `sfdx-project.json` in the current working directory.
 */
export async function cloneRepo(deployment: Deployment, options: CloneRepoOptions): Promise<string> {
  const { name, slug } = deployment;
  let { ref } = deployment;

  if (!ref) {
    try {
      const project = await readSfdxProject();
      const defaultPackageDir = getDefaultPackageDirectory(project);
      if (defaultPackageDir?.dependencies) {
        const dependency = defaultPackageDir.dependencies.find((dep) => dep.package?.startsWith(`${name}@`));
        if (dependency?.package) {
          const versionPart = dependency.package.split('@')[1];
          if (versionPart) {
            ref = toDependencyRef(versionPart, VersionTagFormat.fromProject(project));
          }
        }
      }
    } catch (e) {
      // A misconfigured format is the project's error to fix, not a reason to quietly clone the
      // dependency's default branch instead.
      if (e instanceof VersionTagFormatError) {
        throw e;
      }
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not deduce ref from sfdx-project.json for ${name}: ${err.message}`);
      }
    }
  }

  const repoUrl = options.vcsProvider.buildCiCloneUrl(options.ciJobToken, slug);
  const targetDir = path.join(process.cwd(), name);
  await fs.rm(targetDir, { recursive: true, force: true });

  const refMessage = ref ? `#${ref}` : ' (default branch)';
  logger.info(`Cloning ${slug}${refMessage} into ${name}`);
  try {
    const cloneArgs = ['clone', '--depth', '1'];
    if (ref) {
      cloneArgs.push('-b', ref);
    }
    cloneArgs.push(repoUrl, name);
    await execa('git', cloneArgs);
    return targetDir;
  } catch (e) {
    logger.error(`Failed to clone ${slug}${refMessage}.`);
    throw e;
  }
}

/**
 * Adds a temporary authenticated git remote for CI push/tag operations. Returns the remote's alias.
 *
 * The alias is keyed on the pipeline ID, so a retried job, or a later job in the same pipeline that
 * lands on a runner reusing the working copy (`GIT_STRATEGY: fetch`), finds it already present. In
 * that case the existing remote's URL is overwritten instead, which also refreshes the token.
 */
export async function addGitRemote(
  ciPipelineId: string,
  accessToken: string,
  ciProjectPath: string,
  vcsProvider: VcsProvider,
): Promise<string> {
  if (!accessToken) {
    throw new Error('accessToken is required for Git remote operations.');
  }
  const remoteAlias = `GITREMOTE${ciPipelineId}`;
  const remoteUrl = vcsProvider.buildAuthenticatedRemoteUrl(accessToken, ciProjectPath);
  const { stdout: existingRemotes } = await execa('git', ['remote']);
  const remoteExists = existingRemotes.split(/\r?\n/).includes(remoteAlias);
  await execa('git', ['remote', remoteExists ? 'set-url' : 'add', remoteAlias, remoteUrl]);
  return remoteAlias;
}
