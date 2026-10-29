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
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject, type SfdxProject } from '@simplysf/simply-core';
import { appendToEnvFile } from '../../src/env.js';
import { logger } from '../../src/logger.js';
import { getPackageVersionReport } from '../../src/sfPackages.js';
import { publishUtamPageObjects } from '../../src/build/publishUtamPageObjects.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('../../src/env.js', () => ({ appendToEnvFile: vi.fn() }));
vi.mock('../../src/sfPackages.js', () => ({ getPackageVersionReport: vi.fn() }));
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));

const VALID_ID = '04t000000000000AAA';
const UTAM_INSTALLED_VERSION = '3.3.0';

/** Where the fixture project's page objects live, and where the process runs from. */
let projectDir: string;
let packageDir: string;
let originalCwd: string;
/** Every staging directory the run created, so assertions can look at what was written into it. */
let stagingDirs: string[];

const baseOptions = {
  packagingDevhub: 'packaging-devhub',
  subscriberPackageVersionId: VALID_ID,
  npmPackageName: '@acme/my-package-pageobjects',
};

function project(overrides: Partial<SfdxProject> = {}): SfdxProject {
  return {
    packageDirectories: [{ default: true, path: packageDir, package: 'MyPackage' }],
    ...overrides,
  };
}

/**
 * Stand in for the UTAM compiler: write the four files it emits for every `.utam.json` under its
 * root, the two it emits for every `.utam.js` utility, and optionally the profiles config.
 *
 * Resolves paths exactly as `utam@3` does — output as `path.join(pageObjectsRootDir, outputDir)`,
 * which appends rather than honours an absolute output directory, and the profiles config as
 * `<root>/<outputDir>/../<module>.config.json` without creating its folder — so a config that only
 * works on paper fails where the real compiler would. It compiles only what it finds under its
 * root, so a run that hasn't staged the sources first compiles nothing.
 */
async function fakeCompile(configPath: string, writesProfiles: boolean): Promise<void> {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
    pageObjectsRootDir: string;
    pageObjectsOutputDir: string;
    extensionsOutputDir: string;
    module: string;
  };
  const entries = await fs.readdir(config.pageObjectsRootDir, { recursive: true }).catch(() => [] as string[]);
  const emit = async (outputKey: string, extension: string, outputExts: string[]): Promise<void> => {
    const outputDir = path.join(config.pageObjectsRootDir, outputKey);
    const names = entries.filter((entry) => entry.endsWith(extension)).map((entry) => path.basename(entry, extension));
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all(
      names.flatMap((name) =>
        outputExts.map((ext) => fs.writeFile(path.join(outputDir, `${name}.${ext}`), `// ${name}\n`)),
      ),
    );
  };

  await emit(config.pageObjectsOutputDir, '.utam.json', ['js', 'cjs', 'd.ts', 'd.cts']);
  await emit(config.extensionsOutputDir, '.utam.js', ['js', 'cjs']);
  const outputDir = path.join(config.pageObjectsRootDir, config.pageObjectsOutputDir);
  if (writesProfiles) {
    await fs.writeFile(path.join(outputDir, '..', `${config.module}.config.json`), '{"platform":{}}\n');
  }
}

/**
 * Stand in for every `npm`/compiler process the run shells out to.
 *
 * `npm install` writes the compiler manifest the real code reads back for its version and bin
 * entry, the compiler writes its output, and `npm pack` writes the tarball it copies — so the
 * module's own filesystem plumbing runs for real and only the processes are faked.
 */
function mockExeca(
  options: { alreadyPublished?: boolean; compilesNothing?: boolean; writesProfiles?: boolean } = {},
): void {
  vi.mocked(execa).mockImplementation((async (
    file: string,
    args: readonly string[] = [],
    execaOptions?: { cwd?: string },
  ) => {
    const cwd = execaOptions?.cwd ?? process.cwd();

    if (file === 'npm' && args[0] === 'install') {
      if (!stagingDirs.includes(cwd)) {
        stagingDirs.push(cwd);
      }
      const moduleDir = path.join(cwd, 'node_modules', 'utam');
      await fs.mkdir(path.join(moduleDir, 'bin'), { recursive: true });
      await fs.writeFile(
        path.join(moduleDir, 'package.json'),
        JSON.stringify({ version: UTAM_INSTALLED_VERSION, bin: { utam: './bin/utam.js' } }),
      );
      return { stdout: '' };
    }

    if (file === 'npm' && args[0] === 'view') {
      if (options.alreadyPublished) {
        return { stdout: '1.2.3-4\n' };
      }
      throw new Error('npm ERR! 404 Not Found');
    }

    if (file === 'npm' && args[0] === 'pack') {
      const filename = 'acme-my-package-pageobjects-1.2.3-4.tgz';
      await fs.writeFile(path.join(cwd, filename), 'tarball');
      return { stdout: JSON.stringify([{ filename }]) };
    }

    if (file === process.execPath && !options.compilesNothing) {
      await fakeCompile(args[2], options.writesProfiles ?? false);
    }

    if (!stagingDirs.includes(cwd) && cwd !== process.cwd()) {
      stagingDirs.push(cwd);
    }
    return { stdout: '' };
  }) as never);
}

function mockReport(overrides: Record<string, unknown> = {}): void {
  vi.mocked(getPackageVersionReport).mockResolvedValue({
    Version: '1.2.3.4',
    Tag: 'abc123',
    Description: 'https://gitlab.example.com/pipelines/999',
    ...overrides,
  } as Awaited<ReturnType<typeof getPackageVersionReport>>);
}

async function writePageObject(relative: string): Promise<void> {
  const file = path.join(packageDir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{"root": true}');
}

/** The staging directory a successful run used — kept alive because `--debug` skips the cleanup. */
function lastStagingDir(): string {
  const dir = stagingDirs.at(-1);
  if (!dir) {
    throw new Error('No staging directory was created.');
  }
  return dir;
}

async function readStaged(relative: string): Promise<string> {
  return fs.readFile(path.join(lastStagingDir(), relative), 'utf8');
}

/** Arguments of the `execa` call for `<file> <subcommand> …`. */
function execaCall(file: string, subcommand: string): readonly string[] | undefined {
  // execa's overloads type the second argument as its options object, not the argument array.
  const call = vi
    .mocked(execa)
    .mock.calls.find((c) => c[0] === file && (c[1] as readonly string[] | undefined)?.[0] === subcommand);

  return call?.[1] as readonly string[] | undefined;
}

describe('publishUtamPageObjects', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    stagingDirs = [];
    delete process.env.PACKAGE_CHANGED;

    originalCwd = process.cwd();
    // Resolved, so it matches `process.cwd()` once chdir'd into — macOS's tmpdir is a symlink.
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'utam-project-')));
    packageDir = path.join(projectDir, 'force-app');
    await fs.mkdir(packageDir, { recursive: true });
    // A dry run copies its tarball into the working directory; keep that out of the repo.
    process.chdir(projectDir);

    await writePageObject(path.join('main', 'default', 'lwc', 'hello', '__utam__', 'hello.utam.json'));
    vi.mocked(readSfdxProject).mockResolvedValue(project());
    mockReport();
    mockExeca();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(projectDir, { recursive: true, force: true });
    await Promise.all(stagingDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  describe('skip guards', () => {
    it('should skip when the package did not change', async () => {
      process.env.PACKAGE_CHANGED = 'FALSE';

      expect(await publishUtamPageObjects(baseOptions)).toEqual({ skipped: true, published: false });
      expect(execa).not.toHaveBeenCalled();
      expect(getPackageVersionReport).not.toHaveBeenCalled();
    });

    it('should skip when disabled', async () => {
      expect(await publishUtamPageObjects({ ...baseOptions, disabled: true })).toEqual({
        skipped: true,
        published: false,
      });
      expect(logger.warn).toHaveBeenCalledWith('publish-utam-page-objects is disabled. Skipping.');
      expect(execa).not.toHaveBeenCalled();
    });

    it('should skip when no package version ID can be found', async () => {
      const result = await publishUtamPageObjects({
        ...baseOptions,
        subscriberPackageVersionId: undefined,
        envFile: path.join(projectDir, 'absent.env'),
      });

      expect(result).toEqual({ skipped: true, published: false });
      expect(readSfdxProject).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('should skip when the project authors no page objects', async () => {
      await fs.rm(path.join(packageDir, 'main'), { recursive: true, force: true });

      expect(await publishUtamPageObjects(baseOptions)).toEqual({ skipped: true, published: false });
      expect(getPackageVersionReport).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('should skip, without publishing, when this exact version is already on the registry', async () => {
      mockExeca({ alreadyPublished: true });

      const result = await publishUtamPageObjects(baseOptions);

      expect(result).toEqual({
        skipped: true,
        published: false,
        alreadyPublished: true,
        packageName: '@acme/my-package-pageobjects',
        version: '1.2.3-4',
        distTag: 'latest',
      });
      expect(vi.mocked(execa).mock.calls.some((call) => (call[1] as string[])?.[0] === 'publish')).toBe(false);
      expect(vi.mocked(execa).mock.calls.some((call) => (call[1] as string[])?.[0] === 'install')).toBe(false);
    });

    it('should still record the package in the dotenv file when it was already published', async () => {
      mockExeca({ alreadyPublished: true });

      await publishUtamPageObjects({ ...baseOptions, out: 'out.env' });

      expect(appendToEnvFile).toHaveBeenCalledWith('out.env', {
        UTAM_PAGE_OBJECTS_PACKAGE: '@acme/my-package-pageobjects',
        UTAM_PAGE_OBJECTS_VERSION: '1.2.3-4',
      });
    });
  });

  describe('configuration errors', () => {
    it('should throw when no npm package name is configured anywhere', async () => {
      await expect(publishUtamPageObjects({ ...baseOptions, npmPackageName: undefined })).rejects.toThrow(
        'No npm package name to publish under',
      );
    });

    it('should take the package name from sfdx-project.json when the flag is absent', async () => {
      vi.mocked(readSfdxProject).mockResolvedValue(
        project({ plugins: { simply: { utam: { packageName: '@acme/from-project' } } } }),
      );

      const result = await publishUtamPageObjects({ ...baseOptions, npmPackageName: undefined });

      expect(result.packageName).toBe('@acme/from-project');
    });

    it('should throw when the project has no default package directory', async () => {
      vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ path: 'force-app' }] });

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow('default package directory');
    });

    it('should throw when the package version report carries no version number', async () => {
      mockReport({ Version: undefined });

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow('Could not read a version number');
    });
  });

  describe('publishing', () => {
    it('should install the compiler, compile, and publish', async () => {
      const result = await publishUtamPageObjects(baseOptions);

      expect(result).toEqual({
        skipped: false,
        published: true,
        packageName: '@acme/my-package-pageobjects',
        version: '1.2.3-4',
        distTag: 'latest',
      });
      expect(execaCall('npm', 'install')).toEqual(['install', '--no-save', '--no-audit', '--no-fund', 'utam@^3']);
      expect(execaCall('npm', 'publish')).toEqual(['publish', '--tag', 'latest']);
    });

    it('should honour the requested compiler version', async () => {
      await publishUtamPageObjects({ ...baseOptions, utamVersion: '3.2.2' });

      expect(execaCall('npm', 'install')).toContain('utam@3.2.2');
    });

    it('should run the installed compiler directly rather than through npx', async () => {
      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const compileCall = vi.mocked(execa).mock.calls.find((call) => call[0] === process.execPath) as
        [string, string[]] | undefined;

      expect(compileCall).toBeDefined();
      expect(compileCall?.[1][0]).toBe(path.join(lastStagingDir(), 'node_modules', 'utam', 'bin', 'utam.js'));
      expect(compileCall?.[1][1]).toBe('-c');
      expect(compileCall?.[1][2]).toBe(path.join(lastStagingDir(), 'utam.config.json'));
    });

    it('should pass the registry and access through to publish only when given', async () => {
      await publishUtamPageObjects({
        ...baseOptions,
        npmRegistry: 'https://registry.example.com/',
        npmAccess: 'public',
      });

      expect(execaCall('npm', 'publish')).toEqual([
        'publish',
        '--tag',
        'latest',
        '--registry',
        'https://registry.example.com/',
        '--access',
        'public',
      ]);
    });

    it('should publish a package-branch build under its own dist-tag', async () => {
      vi.mocked(readSfdxProject).mockResolvedValue({
        packageDirectories: [{ default: true, path: packageDir, package: 'MyPackage', branch: 'beta' }],
      });

      const result = await publishUtamPageObjects(baseOptions);

      expect(result.version).toBe('1.2.3-4.beta');
      expect(result.distTag).toBe('beta');
      expect(execaCall('npm', 'publish')).toEqual(['publish', '--tag', 'beta']);
    });

    it('should let --npm-dist-tag override the derived tag', async () => {
      const result = await publishUtamPageObjects({ ...baseOptions, npmDistTag: 'next' });

      expect(result.distTag).toBe('next');
      expect(result.version).toBe('1.2.3-4');
    });

    it('should record the published package in the dotenv file', async () => {
      await publishUtamPageObjects(baseOptions);

      expect(appendToEnvFile).toHaveBeenCalledWith('subscriberPackageVersionId.env', {
        UTAM_PAGE_OBJECTS_PACKAGE: '@acme/my-package-pageobjects',
        UTAM_PAGE_OBJECTS_VERSION: '1.2.3-4',
      });
    });

    it('should ask the Dev Hub for the version report', async () => {
      await publishUtamPageObjects(baseOptions);

      expect(getPackageVersionReport).toHaveBeenCalledWith(VALID_ID, 'packaging-devhub');
    });

    it('should throw when the compile fails', async () => {
      vi.mocked(execa).mockImplementation((async (
        file: string,
        args: readonly string[] = [],
        opts?: { cwd?: string },
      ) => {
        if (file === process.execPath) {
          throw new Error('compile failed');
        }
        const cwd = opts?.cwd ?? process.cwd();
        if (file === 'npm' && args[0] === 'install') {
          stagingDirs.push(cwd);
          const moduleDir = path.join(cwd, 'node_modules', 'utam');
          await fs.mkdir(path.join(moduleDir, 'bin'), { recursive: true });
          await fs.writeFile(
            path.join(moduleDir, 'package.json'),
            JSON.stringify({ version: UTAM_INSTALLED_VERSION, bin: { utam: './bin/utam.js' } }),
          );
          return { stdout: '' };
        }
        throw new Error('npm ERR! 404 Not Found');
      }) as never);

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow('compile failed');
      expect(appendToEnvFile).not.toHaveBeenCalled();
    });

    it('should throw when the publish fails', async () => {
      const passthrough = vi.mocked(execa).getMockImplementation();
      vi.mocked(execa).mockImplementation((async (file: string, args: readonly string[] = [], opts?: unknown) => {
        if (file === 'npm' && args[0] === 'publish') {
          throw new Error('npm ERR! 403 Forbidden');
        }
        return (passthrough as (...a: unknown[]) => unknown)(file, args, opts);
      }) as never);

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow('403 Forbidden');
      expect(appendToEnvFile).not.toHaveBeenCalled();
    });
  });

  describe('staged package', () => {
    it('should write a manifest describing the package version it was built from', async () => {
      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const manifest = JSON.parse(await readStaged('package.json')) as Record<string, unknown>;

      expect(manifest.name).toBe('@acme/my-package-pageobjects');
      expect(manifest.version).toBe('1.2.3-4');
      expect(manifest.peerDependencies).toEqual({ '@utam/core': '^3.3.0' });
      expect(manifest.salesforce).toEqual({
        package: 'MyPackage',
        versionNumber: '1.2.3.4',
        subscriberPackageVersionId: VALID_ID,
        tag: 'v1.2.3.4',
        commitSha: 'abc123',
        pipelineUrl: 'https://gitlab.example.com/pipelines/999',
      });
    });

    it('should write a compiler config pointing at the staged sources, not the project', async () => {
      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const config = JSON.parse(await readStaged('utam.config.json')) as Record<string, unknown>;

      expect(config.pageObjectsRootDir).toBe(path.join(lastStagingDir(), 'source'));
      expect(config.module).toBe('@acme/my-package-pageobjects');
      expect(config.version).toBe('1.2.3-4');
      // Relative, because the compiler joins it onto the root: an absolute path would be appended.
      expect(path.join(config.pageObjectsRootDir as string, config.pageObjectsOutputDir as string)).toBe(
        path.join(lastStagingDir(), 'pageObjects'),
      );
    });

    it('should stage utilities alongside the page objects, for the compiler to find', async () => {
      const utility = path.join('main', 'default', 'lwc', 'hello', '__utam__', 'helper.utam.js');
      await fs.writeFile(path.join(packageDir, utility), 'export const helper = 1;\n');

      await publishUtamPageObjects({ ...baseOptions, debug: true });

      await expect(readStaged(path.join('source', utility))).resolves.toBe('export const helper = 1;\n');
    });

    it('should publish the profiles config under its fixed name, even for a scoped package', async () => {
      mockExeca({ writesProfiles: true });

      await publishUtamPageObjects({ ...baseOptions, debug: true });

      await expect(readStaged('profiles.config.json')).resolves.toBe('{"platform":{}}\n');
      // Nor the scope folder the compiler needed to write it, which would be empty.
      await expect(fs.access(path.join(lastStagingDir(), '@acme'))).rejects.toThrow();
    });

    it('should throw before asking the Dev Hub when two page objects would compile to one file', async () => {
      await writePageObject(path.join('main', 'default', 'lwc', 'other', '__utam__', 'hello.utam.json'));

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow(/would overwrite each other: "hello"/);
      expect(getPackageVersionReport).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('should compile into the staged package, where npm will pack it', async () => {
      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const compiled = await fs.readdir(path.join(lastStagingDir(), 'pageObjects'));

      expect(compiled.sort()).toEqual(['hello.cjs', 'hello.d.cts', 'hello.d.ts', 'hello.js']);
    });

    it('should leave no compiled output in the project', async () => {
      await publishUtamPageObjects(baseOptions);

      const entries = await fs.readdir(packageDir, { recursive: true });

      expect(entries.filter((entry) => !entry.startsWith('main'))).toEqual([]);
    });

    it('should throw, without publishing, when the compiler emits no page objects', async () => {
      mockExeca({ compilesNothing: true });

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow(
        /produced no output for \S*pageObjects[\\/]hello\.js/,
      );
      expect(execaCall('npm', 'publish')).toBeUndefined();
      expect(appendToEnvFile).not.toHaveBeenCalled();
    });

    it('should throw, without publishing, when a utility is missing from the output', async () => {
      await fs.writeFile(
        path.join(packageDir, 'main', 'default', 'lwc', 'hello', '__utam__', 'helper.utam.js'),
        'export const helper = 1;\n',
      );
      const passthrough = vi.mocked(execa).getMockImplementation();
      vi.mocked(execa).mockImplementation((async (file: string, args: readonly string[] = [], opts?: unknown) => {
        const result = await (passthrough as (...a: unknown[]) => Promise<unknown>)(file, args, opts);
        if (file === process.execPath) {
          // The page objects compiled, but the utility never reached `utils/`.
          await fs.rm(path.join(lastStagingDir(), 'utils'), { recursive: true, force: true });
        }
        return result;
      }) as never);

      await expect(publishUtamPageObjects(baseOptions)).rejects.toThrow(
        /produced no output for \S*utils[\\/]helper\.js/,
      );
      expect(execaCall('npm', 'publish')).toBeUndefined();
    });

    it('should merge a project-owned compiler config underneath its own keys', async () => {
      const projectConfig = path.join(projectDir, 'utam.project.json');
      await fs.writeFile(projectConfig, JSON.stringify({ profiles: [{ name: 'platform', values: ['web'] }] }));
      vi.mocked(readSfdxProject).mockResolvedValue(
        project({ plugins: { simply: { utam: { compilerConfig: projectConfig } } } }),
      );

      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const config = JSON.parse(await readStaged('utam.config.json')) as Record<string, unknown>;

      expect(config.profiles).toEqual([{ name: 'platform', values: ['web'] }]);
      expect(config.version).toBe('1.2.3-4');
    });

    it('should ship the source page objects alongside the compiled output', async () => {
      await publishUtamPageObjects({ ...baseOptions, debug: true });

      const staged = path.join(
        lastStagingDir(),
        'source',
        'main',
        'default',
        'lwc',
        'hello',
        '__utam__',
        'hello.utam.json',
      );

      await expect(fs.readFile(staged, 'utf8')).resolves.toBe('{"root": true}');
    });

    it('should leave registry auth to the job, writing no .npmrc anywhere', async () => {
      await publishUtamPageObjects({
        ...baseOptions,
        debug: true,
        npmRegistry: 'https://gitlab.example.com/api/v4/projects/42/packages/npm/',
      });

      await expect(fs.access(path.join(lastStagingDir(), '.npmrc'))).rejects.toThrow();
      await expect(fs.access(path.join(projectDir, '.npmrc'))).rejects.toThrow();
    });

    it('should clean the staging directory up unless debugging', async () => {
      await publishUtamPageObjects(baseOptions);

      await expect(fs.access(lastStagingDir())).rejects.toThrow();
    });
  });

  describe('dry run', () => {
    it('should pack instead of publishing, and copy the tarball where CI can keep it', async () => {
      const result = await publishUtamPageObjects({ ...baseOptions, dryRun: true });

      expect(result).toEqual({
        skipped: false,
        published: false,
        packageName: '@acme/my-package-pageobjects',
        version: '1.2.3-4',
        distTag: 'latest',
        tarball: path.join(projectDir, 'acme-my-package-pageobjects-1.2.3-4.tgz'),
      });
      expect(vi.mocked(execa).mock.calls.some((call) => (call[1] as string[])?.[0] === 'publish')).toBe(false);
      await expect(fs.readFile(result.tarball as string, 'utf8')).resolves.toBe('tarball');
    });

    it('should not check the registry or record anything downstream', async () => {
      await publishUtamPageObjects({ ...baseOptions, dryRun: true });

      expect(vi.mocked(execa).mock.calls.some((call) => (call[1] as string[])?.[0] === 'view')).toBe(false);
      expect(appendToEnvFile).not.toHaveBeenCalled();
    });
  });
});
