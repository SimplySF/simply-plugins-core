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

import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { logger } from '../logger.js';

/** Where aer's releases are published, for the not-found hint. */
const AER_DIST_REPO = 'https://github.com/octoberswimmer/aer-dist';

export type ResolveAerBinaryOptions = {
  /** `--aer-path`. Must exist when given. */
  aerPath?: string;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `os.homedir()`. */
  homeDir?: string;
};

async function isExecutable(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
      return false;
    }
    // Windows has no execute bit; existence is the best available check there.
    await fs.access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `@octoberswimmer/aer-sf-plugin` keeps the aer binary it downloads. Mirrors the plugin's own
 * `defaultStorageDir`, so a job that already ran `sf aer apex run test --install-aer` is covered.
 */
export function aerPluginBinaryPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  const binary = platform === 'win32' ? 'aer.exe' : 'aer';
  let dataDir = env.XDG_DATA_HOME ?? path.join(homeDir, '.local', 'share');
  if (platform === 'win32') {
    dataDir = env.LOCALAPPDATA ?? path.join(homeDir, 'AppData', 'Local');
  } else if (platform === 'darwin') {
    dataDir = path.join(homeDir, 'Library', 'Application Support');
  }

  return path.join(dataDir, 'aer-sf-plugin', 'aer-bin', binary);
}

async function findOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | undefined> {
  const pathValue = env.PATH ?? env.Path ?? '';
  const names = platform === 'win32' ? ['aer.exe', 'aer'] : ['aer'];

  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      // eslint-disable-next-line no-await-in-loop -- first match wins, so the search is sequential
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Find the aer binary, in the order `@octoberswimmer/aer-sf-plugin` uses: `--aer-path`, then
 * `AER_BIN`, then the plugin's download cache, then `aer` on `PATH`.
 *
 * Unlike the plugin, this never downloads aer. The plugin always takes the latest release, which
 * would let the published package format change under a pipeline with no change to the pipeline.
 *
 * @throws {Error} If `--aer-path` doesn't exist, or no aer binary is found anywhere.
 */
export async function resolveAerBinary(options: ResolveAerBinaryOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();

  if (options.aerPath) {
    if (await isExecutable(options.aerPath)) {
      return options.aerPath;
    }
    throw new Error(`--aer-path is set to "${options.aerPath}", but no executable file is there.`);
  }

  if (env.AER_BIN) {
    if (await isExecutable(env.AER_BIN)) {
      return env.AER_BIN;
    }
    logger.warn(`AER_BIN is set to "${env.AER_BIN}", but no executable file is there. Looking elsewhere.`);
  }

  const pluginBinary = aerPluginBinaryPath(env, platform, homeDir);
  if (await isExecutable(pluginBinary)) {
    return pluginBinary;
  }

  const fromPath = await findOnPath(env, platform);
  if (fromPath) {
    return fromPath;
  }

  throw new Error(
    `Could not find the aer binary. Install a pinned release from ${AER_DIST_REPO} and set AER_BIN (or --aer-path) to it, or put aer on PATH.`,
  );
}

/**
 * @returns The version `aer --version` reports, e.g. `v1.4.45`, or `undefined` if it reports
 * nothing recognisable. Only used for the log and the result, so it never fails the run.
 */
export async function readAerVersion(aerBinary: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa(aerBinary, ['--version'], { env: { AER_AUTOUPDATE_DISABLED: '1' } });
    return /v?\d+\.\d+\.\d+\S*/.exec(stdout)?.[0];
  } catch {
    return undefined;
  }
}
