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

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject, type SfdxProject } from '@simplysf/simply-core';
import { appendToEnvFile } from '../../src/env.js';
import { logger } from '../../src/logger.js';
import { getPackage2Info, getPackageVersionReport, resolveDependencyVersionId } from '../../src/sfPackages.js';
import { publishAerPackage } from '../../src/build/publishAerPackage.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('../../src/env.js', () => ({ appendToEnvFile: vi.fn() }));
vi.mock('../../src/sfPackages.js', () => ({
  getPackageVersionReport: vi.fn(),
  getPackage2Info: vi.fn(),
  resolveDependencyVersionId: vi.fn(),
}));
vi.mock('../../src/build/aerBinary.js', () => ({
  resolveAerBinary: vi.fn().mockResolvedValue('/opt/aer/aer'),
  readAerVersion: vi.fn().mockResolvedValue('v1.4.45'),
}));
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
const DEP_ID = '04t000000000001AAA';
const MANAGED_ID = '04t000000000002AAA';
const PACKAGE2_ID = '0Ho000000000000AAA';
const DEP_PACKAGE2_ID = '0Ho000000000001AAA';
const TEMPLATE = 'https://repo.example.com/aer/{name}/{version}/{file}';
const URL = 'https://repo.example.com/aer/MyPackage/1.2.3-4/MyPackage%40acme.pkg';
const DEP_URL = 'https://repo.example.com/aer/Dep/2.0.0-7/Dep%40dep.pkg';
const PACKAGE_BYTES = 'compiled aer package';

let projectDir: string;
let packageDir: string;
let originalCwd: string;

const baseOptions = {
  packagingDevhub: 'packaging-devhub',
  subscriberPackageVersionId: VALID_ID,
  repositoryUrl: TEMPLATE,
  repositoryHeader: 'Authorization: Bearer s3cret',
};

type FetchCall = { url: string; method: string; headers: Record<string, string>; body?: Buffer };
let fetchCalls: FetchCall[];
/** Status per `METHOD url`; anything unlisted is a 404. */
let responses: Record<string, { status: number; body?: string }>;

/** What `aer package create` was run with, and what was in the dependencies directory at the time. */
type AerCall = { file: string; args: string[]; env?: Record<string, string>; stagedDependencies: string[] };
let aerCalls: AerCall[];

function project(overrides: Partial<SfdxProject> = {}, dirOverrides: Record<string, unknown> = {}): SfdxProject {
  return {
    packageDirectories: [{ default: true, path: packageDir, package: 'MyPackage', ...dirOverrides }],
    ...overrides,
  };
}

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: Buffer } = {}) => {
      const method = init.method ?? 'GET';
      fetchCalls.push({ url, method, headers: init.headers ?? {}, body: init.body });
      const response = responses[`${method} ${url}`] ?? { status: 404, body: 'Not Found' };
      return new Response(method === 'HEAD' ? null : (response.body ?? ''), { status: response.status });
    }),
  );
}

/** Stand in for aer: writes the output package, or fails the way aer does. */
function mockAer(failure?: { exitCode: number; stderr: string }): void {
  vi.mocked(execa).mockImplementation((async (
    file: string,
    args: readonly string[] = [],
    execaOptions?: { env?: Record<string, string> },
  ) => {
    const dependenciesDir = args[args.indexOf('--package-dir') + 1];
    aerCalls.push({
      file,
      args: [...args],
      env: execaOptions?.env,
      stagedDependencies: dependenciesDir ? (await fs.readdir(dependenciesDir)).sort() : [],
    });
    if (failure) {
      return { exitCode: failure.exitCode, stderr: failure.stderr, stdout: '' };
    }
    await fs.writeFile(args[args.indexOf('-o') + 1], PACKAGE_BYTES);
    return { exitCode: 0, stderr: '', stdout: 'Package created successfully' };
  }) as never);
}

type Report = Awaited<ReturnType<typeof getPackageVersionReport>>;

/** The Dev Hub: this package's version, an owned dependency, and a managed package it can't see. */
function mockDevHub(options: { branch?: string; namespace?: string | null; depNamespace?: string | null } = {}): void {
  vi.mocked(getPackageVersionReport).mockImplementation(async (id: string) => {
    if (id === VALID_ID) {
      return { Version: '1.2.3.4', Package2Id: PACKAGE2_ID, Branch: options.branch } as Report;
    }
    if (id === DEP_ID) {
      return { Version: '2.0.0.7', Package2Id: DEP_PACKAGE2_ID } as Report;
    }
    throw new Error(`No package version ${id} in this Dev Hub`);
  });
  vi.mocked(getPackage2Info).mockImplementation(async (id: string) =>
    id === PACKAGE2_ID
      ? { Id: id, Name: 'MyPackage', NamespacePrefix: options.namespace === undefined ? 'acme' : options.namespace }
      : { Id: id, Name: 'Dep', NamespacePrefix: options.depNamespace === undefined ? 'dep' : options.depNamespace },
  );
}

async function writeClass(name = 'MyService'): Promise<void> {
  const dir = path.join(packageDir, 'main', 'default', 'classes');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.cls`), `public class ${name} {}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.PACKAGE_CHANGED;
  delete process.env.SUBSCRIBER_PACKAGE_VERSION_ID;
  originalCwd = process.cwd();
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-aer-test-'));
  packageDir = path.join(projectDir, 'force-app');
  process.chdir(projectDir);

  fetchCalls = [];
  aerCalls = [];
  responses = { [`PUT ${URL}`]: { status: 201 } };
  mockFetch();
  mockAer();
  mockDevHub();
  vi.mocked(readSfdxProject).mockResolvedValue(project());
  await writeClass();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.chdir(originalCwd);
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe('skip guards', () => {
  it('skips when the package did not change', async () => {
    process.env.PACKAGE_CHANGED = 'FALSE';
    expect(await publishAerPackage(baseOptions)).toStrictEqual({ skipped: true, published: false });
    expect(getPackageVersionReport).not.toHaveBeenCalled();
  });

  it('skips when disabled', async () => {
    expect(await publishAerPackage({ ...baseOptions, disabled: true })).toStrictEqual({
      skipped: true,
      published: false,
    });
  });

  it('skips when no package version ID can be found', async () => {
    const result = await publishAerPackage({ ...baseOptions, subscriberPackageVersionId: undefined });
    expect(result).toStrictEqual({ skipped: true, published: false });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No package version ID'));
  });

  it('skips a package with no Apex', async () => {
    await fs.rm(packageDir, { recursive: true });
    await fs.mkdir(packageDir);
    expect(await publishAerPackage(baseOptions)).toStrictEqual({ skipped: true, published: false });
    expect(fetchCalls).toHaveLength(0);
  });

  it('skips, but still reports the location, when this version is already uploaded', async () => {
    responses[`HEAD ${URL}`] = { status: 200 };

    const result = await publishAerPackage(baseOptions);

    expect(result).toMatchObject({ skipped: true, published: false, alreadyPublished: true, url: URL });
    expect(execa).not.toHaveBeenCalled();
    expect(appendToEnvFile).toHaveBeenCalledWith('subscriberPackageVersionId.env', {
      AER_PACKAGE_URL: URL,
      AER_PACKAGE_FILE: 'MyPackage@acme.pkg',
      AER_PACKAGE_VERSION: '1.2.3-4',
    });
  });
});

describe('inputs', () => {
  it('needs a repository URL from the flag or sfdx-project.json', async () => {
    await expect(publishAerPackage({ ...baseOptions, repositoryUrl: undefined })).rejects.toThrow(/--repository-url/);

    vi.mocked(readSfdxProject).mockResolvedValue(
      project({ plugins: { simply: { aer: { repositoryUrl: TEMPLATE } } } }),
    );
    expect(await publishAerPackage({ ...baseOptions, repositoryUrl: undefined })).toMatchObject({
      published: true,
      url: URL,
    });
  });

  it('rejects a malformed header before touching the repository', async () => {
    await expect(publishAerPackage({ ...baseOptions, repositoryHeader: 'just-a-token' })).rejects.toThrow(
      /Name: value/,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it('derives the version and channel from the package version branch', async () => {
    mockDevHub({ branch: 'feature/x' });
    const template = 'https://repo.example.com/aer/{name}/{channel}/{version}/{file}';

    const result = await publishAerPackage({ ...baseOptions, repositoryUrl: template, dryRun: true });

    expect(result).toMatchObject({
      version: '1.2.3-4.feature-x',
      url: 'https://repo.example.com/aer/MyPackage/feature-x/1.2.3-4.feature-x/MyPackage%40acme.pkg',
    });
  });

  it('names a namespaceless package after itself', async () => {
    mockDevHub({ namespace: null });

    const result = await publishAerPackage({ ...baseOptions, dryRun: true });

    expect(result).toMatchObject({ namespace: 'MyPackage', file: path.join(projectDir, 'MyPackage@MyPackage.pkg') });
  });
});

describe('publishing', () => {
  it('builds with aer and PUTs the package with the header and its checksum', async () => {
    const result = await publishAerPackage(baseOptions);

    expect(result).toStrictEqual({
      skipped: false,
      published: true,
      packageName: 'MyPackage',
      namespace: 'acme',
      version: '1.2.3-4',
      url: URL,
      file: 'MyPackage@acme.pkg',
      aerVersion: 'v1.4.45',
    });

    const [aer] = aerCalls;
    expect(aer.file).toBe('/opt/aer/aer');
    expect(aer.args.slice(0, 3)).toStrictEqual(['package', 'create', '-o']);
    expect(path.basename(aer.args[3])).toBe('MyPackage@acme.pkg');
    expect(path.basename(aer.args[5])).toBe('dependencies');
    expect(aer.args.at(-1)).toBe(packageDir);
    expect(aer.env).toStrictEqual({ AER_NO_RC: '1', AER_AUTOUPDATE_DISABLED: '1' });

    const put = fetchCalls.find((call) => call.method === 'PUT');
    expect(put?.url).toBe(URL);
    expect(put?.headers).toStrictEqual({
      Authorization: 'Bearer s3cret',
      'Content-Type': 'application/octet-stream',
      'X-Checksum-Sha256': createHash('sha256').update(PACKAGE_BYTES).digest('hex'),
    });
    expect(put?.body?.toString()).toBe(PACKAGE_BYTES);
    expect(appendToEnvFile).toHaveBeenCalledWith('subscriberPackageVersionId.env', {
      AER_PACKAGE_URL: URL,
      AER_PACKAGE_FILE: 'MyPackage@acme.pkg',
      AER_PACKAGE_VERSION: '1.2.3-4',
    });
  });

  it('never logs the header value', async () => {
    await publishAerPackage(baseOptions);
    const logged = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.success).mock.calls]);
    expect(logged).not.toContain('s3cret');
  });

  it('fails with the status and body when the upload is rejected', async () => {
    responses[`PUT ${URL}`] = { status: 403, body: 'Forbidden: no deploy permission' };

    await expect(publishAerPackage(baseOptions)).rejects.toThrow(/HTTP 403: Forbidden: no deploy permission/);
    expect(appendToEnvFile).not.toHaveBeenCalled();
  });

  it('fails with aer’s own message when the build fails', async () => {
    mockAer({ exitCode: 1, stderr: 'type check errors: "acme.MyService", line 2: Error Variable does not exist: Foo' });

    await expect(publishAerPackage(baseOptions)).rejects.toThrow(/exit 1\):\ntype check errors.*Foo/);
    expect(fetchCalls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('dry run builds into the working directory and uploads nothing', async () => {
    const result = await publishAerPackage({ ...baseOptions, dryRun: true });

    const destination = path.join(projectDir, 'MyPackage@acme.pkg');
    expect(result).toMatchObject({ published: false, skipped: false, file: destination });
    expect(await fs.readFile(destination, 'utf8')).toBe(PACKAGE_BYTES);
    expect(fetchCalls).toHaveLength(0);
    expect(appendToEnvFile).not.toHaveBeenCalled();
  });
});

describe('dependencies', () => {
  beforeEach(() => {
    vi.mocked(readSfdxProject).mockResolvedValue(
      project(
        { packageAliases: { 'Dep@2.0.0-7': DEP_ID, Managed: MANAGED_ID, DepPackage: DEP_PACKAGE2_ID } },
        { dependencies: [{ package: 'Dep@2.0.0-7' }, { package: 'Managed' }] },
      ),
    );
    responses[`GET ${DEP_URL}`] = { status: 200, body: 'dependency package' };
  });

  it('downloads owned dependencies and leaves the rest to --dependency-package-dir', async () => {
    await publishAerPackage({ ...baseOptions, dependencyPackageDirs: ['mocks'] });

    const get = fetchCalls.find((call) => call.method === 'GET');
    expect(get).toMatchObject({ url: DEP_URL, headers: { Authorization: 'Bearer s3cret' } });
    expect(aerCalls[0].stagedDependencies).toStrictEqual(['Dep@dep.pkg']);
    expect(aerCalls[0].args).toContain(path.join(projectDir, 'mocks'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('expected in --dependency-package-dir: Managed'));
  });

  it('resolves a package + versionNumber dependency through the Dev Hub', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue(
      project(
        { packageAliases: { DepPackage: DEP_PACKAGE2_ID } },
        { dependencies: [{ package: 'DepPackage', versionNumber: '2.0.0.LATEST' }] },
      ),
    );
    vi.mocked(resolveDependencyVersionId).mockResolvedValue(DEP_ID);

    await publishAerPackage(baseOptions);

    expect(resolveDependencyVersionId).toHaveBeenCalledWith(
      DEP_PACKAGE2_ID,
      '2.0.0.LATEST',
      'packaging-devhub',
      undefined,
    );
    expect(aerCalls[0].stagedDependencies).toStrictEqual(['Dep@dep.pkg']);
  });

  it('fails, naming the URL, when an owned dependency was never published', async () => {
    delete responses[`GET ${DEP_URL}`];

    await expect(publishAerPackage(baseOptions)).rejects.toThrow(
      /dependency Dep@2.0.0-7 from https:\/\/repo.example.com\/aer\/Dep\/2.0.0-7\/Dep%40dep.pkg \(HTTP 404/,
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it('rejects a dependency that resolves to no 04t', async () => {
    vi.mocked(readSfdxProject).mockResolvedValue(project({}, { dependencies: [{ package: 'Unknown' }] }));
    await expect(publishAerPackage(baseOptions)).rejects.toThrow(/"Unknown" doesn't resolve/);
  });

  it('explains a type error between two namespaceless packages', async () => {
    mockDevHub({ namespace: null, depNamespace: null });
    responses[`GET https://repo.example.com/aer/Dep/2.0.0-7/Dep%40Dep.pkg`] = { status: 200, body: 'dep' };
    responses[`PUT https://repo.example.com/aer/MyPackage/1.2.3-4/MyPackage%40MyPackage.pkg`] = { status: 201 };
    mockAer({
      exitCode: 1,
      stderr: 'type check errors: "MyPackage.MyService", line 2: Error Variable does not exist: DepUtil',
    });

    await expect(publishAerPackage(baseOptions)).rejects.toThrow(/Dep@2.0.0-7 have no namespace/);
  });

  it('does not add the namespace explanation when a namespace is involved', async () => {
    mockAer({ exitCode: 1, stderr: 'type check errors: "acme.MyService", line 2: Error' });

    await expect(publishAerPackage(baseOptions)).rejects.not.toThrow(/have no namespace/);
  });
});
