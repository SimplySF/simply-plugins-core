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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCompilerConfig,
  buildPackageManifest,
  buildProvenanceLine,
  findPageObjectSources,
  readEnvFileValue,
  readUtamPluginConfig,
  resolveSubscriberPackageVersionId,
  sanitizePrereleaseId,
  toDistTag,
  toNpmVersion,
  toUtamCoreRange,
  toVersionTag,
} from '../../src/build/utamPageObjects.js';
import { determineTagSuffix } from '../../src/build/createPackageVersion.js';
import { VersionTagFormat } from '../../src/build/versionTagFormat.js';

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

describe('sanitizePrereleaseId', () => {
  it.each([
    ['beta', 'beta'],
    ['feature/x', 'feature-x'],
    ['feature/x/y', 'feature-x-y'],
    ['release/1.0_rc', 'release-1-0-rc'],
    ['--weird--', 'weird'],
  ])('should reduce %s to the semver prerelease alphabet as %s', (raw, expected) => {
    expect(sanitizePrereleaseId(raw)).toBe(expected);
  });

  it('should prefix an all-numeric identifier that has a leading zero, which semver forbids', () => {
    expect(sanitizePrereleaseId('007')).toBe('v007');
  });

  it('should leave an all-numeric identifier without a leading zero alone', () => {
    expect(sanitizePrereleaseId('123')).toBe('123');
  });
});

describe('determineTagSuffix', () => {
  it('should have no suffix on a release-branch build', () => {
    expect(determineTagSuffix(undefined, 'release/1.2', 'release/')).toBeUndefined();
  });

  it("should use the package directory's branch attribute when it has one", () => {
    expect(determineTagSuffix('beta', 'release/1.2', 'release/')).toBe('beta');
  });

  it('should use the CI ref on a non-release build', () => {
    expect(determineTagSuffix(undefined, 'feature/x', 'release/')).toBe('feature/x');
  });

  it('should treat a build with neither a branch attribute nor a ref as a release build', () => {
    expect(determineTagSuffix(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe('toNpmVersion / toDistTag / toVersionTag', () => {
  it.each([
    ['a release-branch build', undefined, '1.2.3-4', 'latest', 'v1.2.3.4'],
    ['a beta package branch', 'beta', '1.2.3-4.beta', 'beta', 'v1.2.3.4-beta'],
    ['a feature branch', 'feature/x', '1.2.3-4.feature-x', 'feature-x', 'v1.2.3.4-feature/x'],
  ])('should map 1.2.3.4 on %s', (_label, suffix, version, distTag, versionTag) => {
    expect(toNpmVersion('1.2.3.4', suffix)).toBe(version);
    expect(toDistTag(suffix)).toBe(distTag);
    expect(toVersionTag('1.2.3.4', suffix)).toBe(versionTag);
  });

  it("should record the version tag in the project's format, leaving the npm version alone", () => {
    const format = VersionTagFormat.parse('{MAJOR}.{MINOR}.{PATCH}+{BUILD}');

    expect(toVersionTag('1.2.3.4', 'beta', format)).toBe('1.2.3+4-beta');
    expect(toNpmVersion('1.2.3.4', 'beta')).toBe('1.2.3-4.beta');
  });

  it('should keep the build number a bare numeric identifier, so 10 orders above 9', () => {
    expect(toNpmVersion('1.2.3.10')).toBe('1.2.3-10');
    expect(toNpmVersion('1.2.3.9')).toBe('1.2.3-9');
  });

  it('should sanitize a suffix carrying separators semver rejects', () => {
    expect(toNpmVersion('1.2.3.4', 'release/1.0_rc')).toBe('1.2.3-4.release-1-0-rc');
    expect(toDistTag('release/1.0_rc')).toBe('release-1-0-rc');
  });

  it('should fall back to latest when a suffix sanitizes away to nothing', () => {
    expect(toDistTag('///')).toBe('latest');
    expect(toNpmVersion('1.2.3.4', '///')).toBe('1.2.3-4');
  });

  it.each(['1.2.3', '1.2.3.NEXT', '', 'nonsense'])('should refuse to derive a version from %s', (version) => {
    expect(() => toNpmVersion(version)).toThrow('expected major.minor.patch.build');
  });
});

describe('toUtamCoreRange', () => {
  it('should pin the compiler major and minor', () => {
    expect(toUtamCoreRange('3.3.0')).toBe('^3.3.0');
    expect(toUtamCoreRange('4.1.7')).toBe('^4.1.0');
  });

  it('should throw when the installed compiler has no readable version', () => {
    expect(() => toUtamCoreRange('not-a-version')).toThrow('major.minor version');
  });
});

describe('readUtamPluginConfig', () => {
  it('should read plugins.simply.utam', () => {
    const project = {
      packageDirectories: [],
      plugins: { simply: { utam: { packageName: '@acme/pageobjects' } } },
    };

    expect(readUtamPluginConfig(project)).toEqual({ packageName: '@acme/pageobjects' });
  });

  it('should return an empty config when the project declares none', () => {
    expect(readUtamPluginConfig({ packageDirectories: [] })).toEqual({});
  });
});

describe('buildPackageManifest', () => {
  const baseOptions = {
    npmPackageName: '@acme/my-package-pageobjects',
    version: '1.2.3-4',
    salesforcePackageName: 'MyPackage',
    salesforceVersion: '1.2.3.4',
    subscriberPackageVersionId: VALID_ID,
    versionTag: 'v1.2.3.4',
    utamCoreRange: '^3.3.0',
  };

  it('should address page objects by path, with types for both module systems', () => {
    expect(buildPackageManifest(baseOptions).exports).toEqual({
      './package.json': './package.json',
      './*': {
        import: { types: './*.d.ts', default: './*.js' },
        require: { types: './*.d.cts', default: './*.cjs' },
      },
    });
  });

  it('should declare @utam/core as a peer and merge the project’s own peers', () => {
    const manifest = buildPackageManifest({
      ...baseOptions,
      projectPeerDependencies: { 'salesforce-pageobjects': '^12.0.0' },
    });

    expect(manifest.peerDependencies).toEqual({
      '@utam/core': '^3.3.0',
      'salesforce-pageobjects': '^12.0.0',
    });
  });

  it('should record which package version produced the output', () => {
    const manifest = buildPackageManifest({
      ...baseOptions,
      versionTag: 'v1.2.3.4-beta',
      commitSha: 'abc123',
      pipelineUrl: 'https://gitlab.example.com/pipelines/999',
    });

    expect(manifest.salesforce).toEqual({
      package: 'MyPackage',
      versionNumber: '1.2.3.4',
      subscriberPackageVersionId: VALID_ID,
      tag: 'v1.2.3.4-beta',
      commitSha: 'abc123',
      pipelineUrl: 'https://gitlab.example.com/pipelines/999',
    });
    expect(manifest.description).toBe(buildProvenanceLine('MyPackage', '1.2.3.4', VALID_ID));
  });

  it('should omit provenance fields the package version report did not carry', () => {
    expect(buildPackageManifest(baseOptions).salesforce).not.toHaveProperty('commitSha');
    expect(buildPackageManifest(baseOptions).salesforce).not.toHaveProperty('pipelineUrl');
  });
});

describe('buildCompilerConfig', () => {
  const baseOptions = {
    pageObjectsRootDir: path.join(path.sep, 'repo', 'force-app'),
    stagingDir: path.join(path.sep, 'tmp', 'staging'),
    npmPackageName: '@acme/my-package-pageobjects',
    version: '1.2.3-4',
    copyright: 'UTAM page objects for MyPackage 1.2.3.4 (04t…)',
  };

  it('should name the module after the npm package, so sibling references resolve once installed', () => {
    expect(buildCompilerConfig(baseOptions).module).toBe('@acme/my-package-pageobjects');
  });

  it('should stamp the derived version, the only way the compiler accepts one', () => {
    const config = buildCompilerConfig(baseOptions);

    expect(config.version).toBe('1.2.3-4');
    expect(config.copyright).toEqual(['UTAM page objects for MyPackage 1.2.3.4 (04t…)']);
  });

  it('should write output under the staging directory', () => {
    const config = buildCompilerConfig(baseOptions);

    expect(config.pageObjectsOutputDir).toBe(path.join(baseOptions.stagingDir, 'pageObjects'));
    expect(config.extensionsOutputDir).toBe(path.join(baseOptions.stagingDir, 'utils'));
    expect(config.pageObjectsRootDir).toBe(baseOptions.pageObjectsRootDir);
    expect(config.pageObjectsFileMask).toEqual(['**/__utam__/**/*.utam.json']);
  });

  it('should pass the project’s type aliases through', () => {
    const alias = { 'salesforce-pageobjects/*': 'salesforce-pageobjects/*' };

    expect(buildCompilerConfig({ ...baseOptions, alias }).alias).toEqual(alias);
  });

  it('should keep the project’s own config keys but win on the ones this command owns', () => {
    const config = buildCompilerConfig({
      ...baseOptions,
      baseConfig: {
        profiles: [{ name: 'platform', values: ['web'] }],
        interruptCompilerOnError: false,
        version: 'whatever-the-project-said',
        pageObjectsOutputDir: 'somewhere-else',
      },
    });

    expect(config.profiles).toEqual([{ name: 'platform', values: ['web'] }]);
    expect(config.interruptCompilerOnError).toBe(false);
    expect(config.version).toBe('1.2.3-4');
    expect(config.pageObjectsOutputDir).toBe(path.join(baseOptions.stagingDir, 'pageObjects'));
  });
});

describe('findPageObjectSources', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'utam-sources-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  async function write(relative: string): Promise<string> {
    const file = path.join(rootDir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{}');
    return file;
  }

  it('should find page objects at any depth, sorted', async () => {
    const deep = await write(path.join('main', 'default', 'lwc', 'nested', 'deep', '__utam__', 'greeting.utam.json'));
    const shallow = await write(path.join('main', 'default', 'lwc', 'hello', '__utam__', 'hello.utam.json'));

    expect(await findPageObjectSources(rootDir)).toEqual([shallow, deep].sort());
  });

  it('should ignore .utam.json files outside a __utam__ folder', async () => {
    await write(path.join('main', 'default', 'lwc', 'hello', 'hello.utam.json'));

    expect(await findPageObjectSources(rootDir)).toEqual([]);
  });

  it('should ignore non-page-object files inside a __utam__ folder', async () => {
    await write(path.join('lwc', 'hello', '__utam__', 'README.md'));

    expect(await findPageObjectSources(rootDir)).toEqual([]);
  });

  it('should treat a missing package directory as no page objects', async () => {
    expect(await findPageObjectSources(path.join(rootDir, 'nope'))).toEqual([]);
  });
});

describe('readEnvFileValue', () => {
  it('should read a key with or without a trailing newline', () => {
    expect(readEnvFileValue(`SUBSCRIBER_PACKAGE_VERSION_ID=${VALID_ID}`, 'SUBSCRIBER_PACKAGE_VERSION_ID')).toBe(
      VALID_ID,
    );
    expect(readEnvFileValue(`SUBSCRIBER_PACKAGE_VERSION_ID=${VALID_ID}\n`, 'SUBSCRIBER_PACKAGE_VERSION_ID')).toBe(
      VALID_ID,
    );
  });

  it('should skip blanks, comments, and other keys', () => {
    const content = ['# a comment', '', 'OTHER=value', `SUBSCRIBER_PACKAGE_VERSION_ID=${VALID_ID}`].join('\r\n');

    expect(readEnvFileValue(content, 'SUBSCRIBER_PACKAGE_VERSION_ID')).toBe(VALID_ID);
  });

  it('should take the last assignment, since the file is appended to', () => {
    const content = 'KEY=first\nKEY=second\n';

    expect(readEnvFileValue(content, 'KEY')).toBe('second');
  });

  it('should return undefined for a key that is absent', () => {
    expect(readEnvFileValue('OTHER=value\n', 'KEY')).toBeUndefined();
  });
});

describe('resolveSubscriberPackageVersionId', () => {
  let dir: string;
  let envFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'utam-env-'));
    envFile = path.join(dir, 'subscriberPackageVersionId.env');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('should prefer the flag over everything else', async () => {
    await fs.writeFile(envFile, 'SUBSCRIBER_PACKAGE_VERSION_ID=04t000000000000BBB\n');

    const resolved = await resolveSubscriberPackageVersionId({
      flagValue: VALID_ID,
      env: { SUBSCRIBER_PACKAGE_VERSION_ID: '04t000000000000CCC' },
      envFile,
    });

    expect(resolved).toBe(VALID_ID);
  });

  it('should prefer the environment over the dotenv file', async () => {
    await fs.writeFile(envFile, 'SUBSCRIBER_PACKAGE_VERSION_ID=04t000000000000BBB\n');

    const resolved = await resolveSubscriberPackageVersionId({
      env: { SUBSCRIBER_PACKAGE_VERSION_ID: VALID_ID },
      envFile,
    });

    expect(resolved).toBe(VALID_ID);
  });

  it('should fall back to the dotenv file the same job just wrote', async () => {
    await fs.writeFile(envFile, `SUBSCRIBER_PACKAGE_VERSION_ID=${VALID_ID}`);

    expect(await resolveSubscriberPackageVersionId({ env: {}, envFile })).toBe(VALID_ID);
  });

  it('should return undefined when the dotenv file is absent', async () => {
    expect(await resolveSubscriberPackageVersionId({ env: {}, envFile })).toBeUndefined();
  });

  it('should return undefined when no source has the key', async () => {
    await fs.writeFile(envFile, 'OTHER=value\n');

    expect(await resolveSubscriberPackageVersionId({ env: {}, envFile })).toBeUndefined();
  });

  it('should throw on an explicit flag that is not a 04t', async () => {
    await expect(
      resolveSubscriberPackageVersionId({ flagValue: '05i000000000000AAA', env: {}, envFile }),
    ).rejects.toThrow('must be a subscriber package version ID');
  });

  it('should ignore a malformed discovered value and keep looking', async () => {
    await fs.writeFile(envFile, `SUBSCRIBER_PACKAGE_VERSION_ID=${VALID_ID}\n`);

    const resolved = await resolveSubscriberPackageVersionId({
      env: { SUBSCRIBER_PACKAGE_VERSION_ID: 'not-an-id' },
      envFile,
    });

    expect(resolved).toBe(VALID_ID);
  });

  it('should ignore a malformed value in the dotenv file', async () => {
    await fs.writeFile(envFile, 'SUBSCRIBER_PACKAGE_VERSION_ID=not-an-id\n');

    expect(await resolveSubscriberPackageVersionId({ env: {}, envFile })).toBeUndefined();
  });
});
