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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toAerPackageFile } from '../../src/build/aerPackage.js';

/**
 * Pins down the aer behavior design 0059 rests on, against a real binary: a package's namespace
 * comes from its file name, and a reference into a `.pkg` resolves only when it's qualified. Runs
 * only when `AER_BIN` points at an aer binary, so a new aer release that changes either shows up
 * here rather than in a pipeline.
 */
const aerBin = process.env.AER_BIN;
const env = { AER_NO_RC: '1', AER_AUTOUPDATE_DISABLED: '1' };

describe.skipIf(!aerBin)('aer package create (real binary)', () => {
  let root: string;

  async function writeClass(dir: string, name: string, body: string): Promise<void> {
    const classes = path.join(root, dir, 'main', 'default', 'classes');
    await fs.mkdir(classes, { recursive: true });
    await fs.writeFile(path.join(classes, `${name}.cls`), body);
  }

  function create(output: string, ...args: string[]): ReturnType<typeof execa> {
    return execa(aerBin as string, ['package', 'create', '-o', path.join(root, output), ...args], {
      cwd: root,
      env,
      reject: false,
    });
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aer-binary-integration-'));
    await writeClass(
      'dep',
      'DepUtil',
      'public class DepUtil { public static Integer twice(Integer x) { return x * 2; } }',
    );
    await writeClass(
      'qualified',
      'AppSvc',
      'public class AppSvc { public static Integer run() { return dep.DepUtil.twice(21); } }',
    );
    await writeClass(
      'unqualified',
      'AppSvc',
      'public class AppSvc { public static Integer run() { return DepUtil.twice(21); } }',
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads the namespace from a <package>@<namespace>.pkg file name', async () => {
    const { file } = toAerPackageFile('Dep', 'dep');
    expect((await create(file, path.join(root, 'dep'))).exitCode).toBe(0);

    const { stdout } = await execa(aerBin as string, ['package', 'list', path.join(root, file)], { env });
    expect(stdout).toMatch(/Namespace: dep/);
  });

  it('rejects a file name that carries a version', async () => {
    const { exitCode, stderr } = await create('Dep-1.2.3-4.pkg', path.join(root, 'dep'));
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/not a valid namespace/);
  });

  it('resolves a qualified reference into a dependency package, and fails an unqualified one', async () => {
    const dependency = path.join(root, toAerPackageFile('Dep', 'dep').file);

    expect((await create('App@app.pkg', '--package', dependency, path.join(root, 'qualified'))).exitCode).toBe(0);

    const unqualified = await create('App2@app.pkg', '--package', dependency, path.join(root, 'unqualified'));
    expect(unqualified.exitCode).not.toBe(0);
    expect(`${String(unqualified.stderr)}${String(unqualified.stdout)}`).toMatch(/type check/i);
  });
});
