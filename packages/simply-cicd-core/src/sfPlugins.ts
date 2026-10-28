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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { DEFAULT_DEPLOYMENT_PLUGINS } from './config/defaultDeploymentPlugins.js';
import { TRUSTED_PLUGINS } from './config/trustedPlugins.js';
import { runSf } from './exec/sfCli.js';
import { logger } from './logger.js';

/** Installs a Salesforce CLI plugin. */
export async function installPlugin(plugin: string, debug = false, cwd: string = process.cwd()): Promise<void> {
  logger.info(`Installing ${plugin} plugin...`);
  try {
    configureTrustedPublishers(debug);
    await runSf(['plugins', 'install', plugin], { stdio: 'pipe', cwd });
    logger.success(`Successfully installed ${plugin} plugin.`);
  } catch (error) {
    logger.error(`Failed to install ${plugin} plugin.`);
    logger.error(String(error));
    throw error;
  }
}

type SfDevRc = {
  deploymentPlugins?: unknown;
};

/** Installs all plugins listed in the `deploymentPlugins` array of the `.sfdevrc` file, plus this package's defaults. */
export async function installDeploymentPlugins(debug = false, cwd: string = process.cwd()): Promise<void> {
  const sfdevrcPath = path.join(cwd, '.sfdevrc');
  let projectPlugins: string[] = [];

  if (fs.existsSync(sfdevrcPath)) {
    const sfdevrc = JSON.parse(fs.readFileSync(sfdevrcPath, 'utf8')) as SfDevRc;
    if (Array.isArray(sfdevrc.deploymentPlugins)) {
      projectPlugins = sfdevrc.deploymentPlugins as string[];
    } else if (debug) {
      logger.debug('No deploymentPlugins array found in .sfdevrc. Skipping project-specific plugins.');
    }
  } else if (debug) {
    logger.debug('No .sfdevrc file found. Skipping project-specific plugins.');
  }

  const allPlugins = [...new Set<string>([...DEFAULT_DEPLOYMENT_PLUGINS, ...projectPlugins])];

  if (allPlugins.length === 0) {
    if (debug) {
      logger.debug('No deployment plugins to install.');
    }
    return;
  }

  const { stdout } = await runSf(['plugins'], { cwd });
  const installedPlugins = stdout.split('\n').map((line) => line.split(' ')[0]);

  for (const plugin of allPlugins) {
    if (!installedPlugins.includes(plugin)) {
      // eslint-disable-next-line no-await-in-loop
      await installPlugin(plugin, debug, cwd);
    } else if (debug) {
      logger.debug(`${plugin} is already installed. Skipping.`);
    }
  }
}

/**
 * Automatically configures the trusted unsigned plugin allowlist for both the modern `sf` and
 * legacy `sfdx` CLI configurations, to prevent interactive installation prompts.
 */
export function configureTrustedPublishers(debug = false): void {
  const homeDir = os.homedir();
  if (!homeDir) {
    logger.warn('Could not determine user home directory. Skipping trusted publisher configuration.');
    return;
  }

  const configDirs = [path.join(homeDir, '.config', 'sf'), path.join(homeDir, '.config', 'sfdx')];

  for (const configDir of configDirs) {
    const allowListPath = path.join(configDir, 'unsignedPluginAllowList.json');
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      let currentAllowList: string[] = [];
      if (fs.existsSync(allowListPath)) {
        try {
          const content = fs.readFileSync(allowListPath, 'utf8');
          const parsed: unknown = JSON.parse(content);
          currentAllowList = Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          logger.warn(`Failed to parse existing allowlist at ${allowListPath}. Overwriting.`);
        }
      }

      let modified = false;
      for (const plugin of TRUSTED_PLUGINS) {
        if (!currentAllowList.includes(plugin)) {
          currentAllowList.push(plugin);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(allowListPath, JSON.stringify(currentAllowList, null, 2), 'utf8');
        if (debug) {
          logger.debug(`Configured trusted plugins in ${allowListPath}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to configure trusted publisher allowlist at ${configDir}: ${(error as Error).message}`);
    }
  }
}

/** Installs the `@syntax-syllogism/flow-delta` plugin globally via npm. */
export async function installFlowDeltaPlugin(debug = false): Promise<void> {
  logger.info('Installing @syntax-syllogism/flow-delta via npm...');
  try {
    configureTrustedPublishers(debug);
    await execa('npm', ['install', '@syntax-syllogism/flow-delta', '--global'], { stdio: 'pipe' });
    logger.success('Successfully installed @syntax-syllogism/flow-delta plugin.');
  } catch (error) {
    logger.error('Failed to install @syntax-syllogism/flow-delta plugin.');
    logger.error(String(error));
    throw error;
  }
}
