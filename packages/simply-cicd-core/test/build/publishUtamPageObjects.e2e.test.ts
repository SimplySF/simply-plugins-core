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
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPackageVersionReport } from '../../src/sfPackages.js';
import { publishUtamPageObjects } from '../../src/build/publishUtamPageObjects.js';

/**
 * The real compiler and the real `npm pack`, end to end, against a fixture project.
 *
 * The unit tests fake the compiler, so they only prove what the code *asks* for; this proves what
 * a consumer actually receives. Only two things are stubbed: the Dev Hub lookup, and `npm install
 * utam`, which links this package's own `utam` dev dependency instead of reaching the network.
 */

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return { ...actual, execa: vi.fn(actual.execa) };
});
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

const require = createRequire(import.meta.url);
const UTAM_DIR = path.dirname(require.resolve('utam/package.json'));
const UTAM_CORE_DIR = path.join(UTAM_DIR, '..', '@utam', 'core');
const NPM_PACKAGE_NAME = '@acme/my-package-pageobjects';
const LWC_DIR = path.join('force-app', 'main', 'default', 'lwc');

const HELLO = {
  root: true,
  selector: { css: 'c-hello' },
  elements: [
    { name: 'title', selector: { css: 'h1' }, public: true },
    // A sibling page object, addressed the way the generated package exposes it.
    {
      name: 'greeting',
      type: `${NPM_PACKAGE_NAME}/pageObjects/greeting`,
      selector: { css: 'c-greeting' },
      public: true,
    },
  ],
};
const GREETING = {
  root: true,
  selector: { css: 'c-greeting' },
  elements: [{ name: 'message', selector: { css: 'p' }, public: true }],
};
// An interface and its web implementation, which make the compiler write a profiles config.
const NAVIGATION = { interface: true, root: true, methods: [{ name: 'open', returnType: 'boolean' }] };
const NAVIGATION_WEB = {
  implements: `${NPM_PACKAGE_NAME}/pageObjects/navigation`,
  profile: [{ platform: ['web'] }],
  root: true,
  selector: { css: 'c-nav' },
  elements: [{ name: 'link', selector: { css: 'a' } }],
  methods: [{ name: 'open', compose: [{ element: 'link', apply: 'isPresent' }] }],
};
const HELPER = 'export function helper() {\n  return 1;\n}\n';

let projectDir: string;
let originalCwd: string;
/** Every file in the packed tarball, relative to its `package/` root. */
let packed: string[];
/** The tarball, extracted. */
let extractedDir: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

describe('publishUtamPageObjects, end to end', () => {
  beforeAll(async () => {
    originalCwd = process.cwd();
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'utam-e2e-')));
    process.chdir(projectDir);

    await writeJson(path.join(projectDir, 'sfdx-project.json'), {
      packageDirectories: [{ default: true, path: 'force-app', package: 'MyPackage' }],
      sourceApiVersion: '62.0',
      plugins: { simply: { utam: { compilerConfig: 'utam.project.json' } } },
    });
    await writeJson(path.join(projectDir, 'utam.project.json'), {
      profiles: [{ name: 'platform', values: ['web', 'mobile'] }],
    });
    await writeJson(path.join(projectDir, LWC_DIR, 'hello', '__utam__', 'hello.utam.json'), HELLO);
    // Two folders deeper, to prove the output is flattened and the source layout kept.
    await writeJson(
      path.join(projectDir, LWC_DIR, 'nested', 'deeper', 'greeting', '__utam__', 'greeting.utam.json'),
      GREETING,
    );
    await writeJson(path.join(projectDir, LWC_DIR, 'nav', '__utam__', 'navigation.utam.json'), NAVIGATION);
    await writeJson(path.join(projectDir, LWC_DIR, 'navWeb', '__utam__', 'navigationWeb.utam.json'), NAVIGATION_WEB);
    await fs.writeFile(path.join(projectDir, LWC_DIR, 'nav', '__utam__', 'helper.utam.js'), HELPER);

    vi.mocked(getPackageVersionReport).mockResolvedValue({
      Version: '1.2.3.4',
      Tag: 'abc123',
    } as Awaited<ReturnType<typeof getPackageVersionReport>>);
    const real = vi.mocked(execa).getMockImplementation() as (...args: unknown[]) => unknown;
    vi.mocked(execa).mockImplementation(((file: string, args: readonly string[] = [], options?: { cwd?: string }) => {
      if (file === 'npm' && args[0] === 'install') {
        const modules = path.join(options?.cwd ?? process.cwd(), 'node_modules');
        return fs
          .mkdir(modules, { recursive: true })
          .then(() => fs.symlink(UTAM_DIR, path.join(modules, 'utam'), 'junction'));
      }
      return real(file, args, options);
    }) as never);

    const result = await publishUtamPageObjects({
      packagingDevhub: 'packaging-devhub',
      subscriberPackageVersionId: '04t000000000000AAA',
      npmPackageName: NPM_PACKAGE_NAME,
      dryRun: true,
    });

    extractedDir = path.join(projectDir, 'extracted');
    await fs.mkdir(extractedDir);
    // Run from the destination with a relative archive path: GNU tar, which Windows can resolve
    // `tar` to, reads an absolute `C:\…` argument as a remote `host:path` archive.
    await execa('tar', ['-xzf', path.relative(extractedDir, result.tarball as string)], { cwd: extractedDir });
    packed = await listFiles(path.join(extractedDir, 'package'));
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('should pack the compiled output, flat, beside the sources in their original layout', () => {
    const compiled = (name: string): string[] =>
      ['cjs', 'd.cts', 'd.ts', 'js'].map((ext) => `pageObjects/${name}.${ext}`);

    expect(packed).toEqual([
      'package.json',
      ...compiled('greeting'),
      ...compiled('hello'),
      ...compiled('navigation'),
      ...compiled('navigationWeb'),
      'profiles.config.json',
      'source/main/default/lwc/hello/__utam__/hello.utam.json',
      'source/main/default/lwc/nav/__utam__/helper.utam.js',
      'source/main/default/lwc/nav/__utam__/navigation.utam.json',
      'source/main/default/lwc/navWeb/__utam__/navigationWeb.utam.json',
      'source/main/default/lwc/nested/deeper/greeting/__utam__/greeting.utam.json',
      'utils/helper.cjs',
      'utils/helper.js',
    ]);
  });

  it('should stamp each compiled file with the version and its provenance', async () => {
    const hello = await fs.readFile(path.join(extractedDir, 'package', 'pageObjects', 'hello.js'), 'utf8');

    expect(hello).toContain('UTAM page objects for MyPackage 1.2.3.4 (04t000000000000AAA)');
    expect(hello).toContain('@version 1.2.3-4');
    expect(hello).toContain(`from '${NPM_PACKAGE_NAME}/pageObjects/greeting'`);
  });

  it('should leave nothing generated behind in the project', async () => {
    const files = await listFiles(path.join(projectDir, 'force-app'));

    expect(files).toEqual([
      'main/default/lwc/hello/__utam__/hello.utam.json',
      'main/default/lwc/nav/__utam__/helper.utam.js',
      'main/default/lwc/nav/__utam__/navigation.utam.json',
      'main/default/lwc/navWeb/__utam__/navigationWeb.utam.json',
      'main/default/lwc/nested/deeper/greeting/__utam__/greeting.utam.json',
    ]);
    // Nor at the project root: the compiler's lint and error reports stay in the staging directory.
    await expect(fs.access(path.join(projectDir, 'utam-lint.sarif'))).rejects.toThrow();
  });

  it('should be importable by path, as ESM and as CommonJS, once installed', async () => {
    // A consumer's node_modules: the package itself, plus the @utam/core peer it declares.
    const consumerDir = path.join(projectDir, 'consumer');
    const scopeDir = path.join(consumerDir, 'node_modules', '@acme');
    await fs.mkdir(path.join(consumerDir, 'node_modules', '@utam'), { recursive: true });
    await fs.mkdir(scopeDir, { recursive: true });
    await fs.cp(path.join(extractedDir, 'package'), path.join(scopeDir, 'my-package-pageobjects'), { recursive: true });
    await fs.symlink(UTAM_CORE_DIR, path.join(consumerDir, 'node_modules', '@utam', 'core'), 'junction');

    const specifier = `${NPM_PACKAGE_NAME}/pageObjects/hello`;
    const esm = await execa(
      process.execPath,
      ['--input-type=module', '-e', `const m = await import('${specifier}'); console.log(typeof m.default);`],
      { cwd: consumerDir },
    );
    const cjs = await execa(process.execPath, ['-e', `console.log(typeof require('${specifier}'));`], {
      cwd: consumerDir,
    });

    expect(esm.stdout).toBe('function');
    expect(cjs.stdout).toBe('function');

    // What the UTAM loader does with a configured profiles path: `require` it by bare specifier,
    // then load each interface and implementation it names.
    const profiles = await execa(
      process.execPath,
      [
        '-e',
        `const config = require('${NPM_PACKAGE_NAME}/profiles.config.json');
         const [entry] = config.platform.web;
         console.log(JSON.stringify(entry), typeof require(entry.interface), typeof require(entry.implementation));`,
      ],
      { cwd: consumerDir },
    );

    expect(profiles.stdout).toBe(
      `${JSON.stringify({
        interface: `${NPM_PACKAGE_NAME}/pageObjects/navigation`,
        implementation: `${NPM_PACKAGE_NAME}/pageObjects/navigationWeb`,
      })} function function`,
    );
  });
});
