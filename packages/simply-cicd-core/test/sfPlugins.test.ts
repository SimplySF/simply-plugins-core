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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { configureTrustedPublishers, installDeploymentPlugins, installPlugin } from '../src/sfPlugins.js';

vi.mock('execa');

describe('sfPlugins', () => {
  const tempHomeDir = path.resolve('test-home');
  const tempProjectDir = path.resolve('test-project');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
    vi.spyOn(process, 'cwd').mockReturnValue(tempProjectDir);

    if (fs.existsSync(tempHomeDir)) {
      fs.rmSync(tempHomeDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempProjectDir)) {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempProjectDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempHomeDir)) {
      fs.rmSync(tempHomeDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempProjectDir)) {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('configureTrustedPublishers', () => {
    it('should create configuration directories and allowlist files with default trusted plugins', () => {
      configureTrustedPublishers();

      const sfConfigPath = path.join(tempHomeDir, '.config', 'sf', 'unsignedPluginAllowList.json');
      const sfdxConfigPath = path.join(tempHomeDir, '.config', 'sfdx', 'unsignedPluginAllowList.json');

      expect(fs.existsSync(sfConfigPath)).toBe(true);
      expect(fs.existsSync(sfdxConfigPath)).toBe(true);

      const sfContent = JSON.parse(fs.readFileSync(sfConfigPath, 'utf8')) as string[];
      const sfdxContent = JSON.parse(fs.readFileSync(sfdxConfigPath, 'utf8')) as string[];

      const expectedPlugins = ['@simplysf/simply'];

      expect(sfContent).toEqual(expect.arrayContaining(expectedPlugins));
      expect(sfdxContent).toEqual(expect.arrayContaining(expectedPlugins));
    });

    it('should append to an existing allowlist file without overwriting other plugins', () => {
      const sfConfigDir = path.join(tempHomeDir, '.config', 'sf');
      fs.mkdirSync(sfConfigDir, { recursive: true });
      const sfConfigPath = path.join(sfConfigDir, 'unsignedPluginAllowList.json');

      const existingPlugins = ['some-other-plugin', 'sfdmu'];
      fs.writeFileSync(sfConfigPath, JSON.stringify(existingPlugins, null, 2), 'utf8');

      configureTrustedPublishers();

      const sfContent = JSON.parse(fs.readFileSync(sfConfigPath, 'utf8')) as string[];
      expect(sfContent).toContain('some-other-plugin');
      expect(sfContent).toContain('sfdmu');
      expect(sfContent).toContain('@simplysf/simply');
      expect(sfContent.filter((p) => p === 'sfdmu').length).toBe(1);
    });

    it('should handle invalid existing JSON by overwriting it', () => {
      const sfConfigDir = path.join(tempHomeDir, '.config', 'sf');
      fs.mkdirSync(sfConfigDir, { recursive: true });
      const sfConfigPath = path.join(sfConfigDir, 'unsignedPluginAllowList.json');

      fs.writeFileSync(sfConfigPath, 'invalid-json', 'utf8');

      configureTrustedPublishers();

      const sfContent = JSON.parse(fs.readFileSync(sfConfigPath, 'utf8')) as string[];
      expect(sfContent).toContain('@simplysf/simply');
    });

    it('should catch and log errors if filesystem operations fail', () => {
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
        throw new Error('Filesystem write error');
      });

      expect(() => configureTrustedPublishers()).not.toThrow();
    });

    it('should only emit debug logs when debug parameter is true', () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

      configureTrustedPublishers();
      expect(debugSpy).not.toHaveBeenCalled();

      configureTrustedPublishers(false);
      expect(debugSpy).not.toHaveBeenCalled();

      const sfConfigPath = path.join(tempHomeDir, '.config', 'sf', 'unsignedPluginAllowList.json');
      if (fs.existsSync(sfConfigPath)) {
        fs.unlinkSync(sfConfigPath);
      }

      configureTrustedPublishers(true);
      expect(debugSpy).toHaveBeenCalled();

      debugSpy.mockRestore();
    });
  });

  describe('installPlugin', () => {
    it('should configure trusted publishers and run sf plugins install', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '' } as never);

      await installPlugin('@simplysf/simply');

      expect(execa).toHaveBeenCalledWith('sf', ['plugins', 'install', '@simplysf/simply'], {
        stdio: 'pipe',
        cwd: tempProjectDir,
      });

      const sfConfigPath = path.join(tempHomeDir, '.config', 'sf', 'unsignedPluginAllowList.json');
      expect(fs.existsSync(sfConfigPath)).toBe(true);
    });

    it('should propagate errors if sf plugins install fails', async () => {
      const error = new Error('sf install failed');
      vi.mocked(execa).mockRejectedValue(error);

      await expect(installPlugin('@simplysf/simply')).rejects.toThrow(error);
    });
  });

  describe('installDeploymentPlugins', () => {
    it('should install only default plugins if .sfdevrc does not exist', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
      await installDeploymentPlugins();
      expect(execa).toHaveBeenCalledWith('sf', ['plugins', 'install', '@simplysf/simply'], expect.any(Object));
    });

    it('should install only default plugins if deploymentPlugins is not in .sfdevrc', async () => {
      fs.writeFileSync(path.join(tempProjectDir, '.sfdevrc'), JSON.stringify({}));
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
      await installDeploymentPlugins();
      expect(execa).toHaveBeenCalledWith('sf', ['plugins', 'install', '@simplysf/simply'], expect.any(Object));
    });

    it('should install only default plugins if deploymentPlugins is not an array', async () => {
      fs.writeFileSync(path.join(tempProjectDir, '.sfdevrc'), JSON.stringify({ deploymentPlugins: 'not-an-array' }));
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
      await installDeploymentPlugins();
      expect(execa).toHaveBeenCalledWith('sf', ['plugins', 'install', '@simplysf/simply'], expect.any(Object));
    });

    it('should install both default and project plugins that are not already installed', async () => {
      fs.writeFileSync(
        path.join(tempProjectDir, '.sfdevrc'),
        JSON.stringify({ deploymentPlugins: ['plugin1', 'plugin2'] }),
      );
      vi.mocked(execa).mockResolvedValue({ stdout: 'plugin1\n@simplysf/simply' } as never);
      await installDeploymentPlugins();
      expect(execa).toHaveBeenCalledWith('sf', ['plugins', 'install', 'plugin2'], expect.any(Object));
      expect(execa).not.toHaveBeenCalledWith('sf', ['plugins', 'install', 'plugin1'], expect.any(Object));
      expect(execa).not.toHaveBeenCalledWith('sf', ['plugins', 'install', '@simplysf/simply'], expect.any(Object));
    });
  });
});
