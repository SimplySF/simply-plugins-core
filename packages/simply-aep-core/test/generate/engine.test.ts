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

import { mkdtempSync, readFileSync } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isAepGenerationError } from '../../src/generate/errors.js';
import { GenerationEngine } from '../../src/generate/engine.js';
import type { GenerationPlan } from '../../src/generate/model.js';

const exists = async (pathValue: string): Promise<boolean> => {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
};

describe('aep generation engine', () => {
  it('wraps filesystem failures with path and cause', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'file');
    const absolutePath = join(blocker, 'A.cls');
    try {
      await GenerationEngine.execute(
        { artifacts: [{ id: 'serviceInterface', relativePath: 'blocker/A.cls', content: 'x' }] },
        { baseDir: dir },
      );
      expect.fail('Expected write failure');
    } catch (error) {
      expect(isAepGenerationError(error)).to.equal(true);
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).to.equal('write-failed');
      const data = error.data as { absolutePath: string; cause: Error };
      expect(data.absolutePath).to.equal(absolutePath);
      expect(data.cause).to.be.instanceOf(Error);
      expect(error.message).to.equal(`Failed to write artifact "${absolutePath}": ${data.cause.message}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes files and returns manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const plan: GenerationPlan = {
      artifacts: [
        {
          id: 'serviceInterface',
          relativePath: 'main/classes/services/IFooService.cls',
          content: 'public interface IFooService {}',
        },
      ],
    };

    const manifest = await GenerationEngine.execute(plan, { baseDir: dir, overwrite: 'overwrite' });
    expect(manifest.created).to.have.length(1);
    expect(readFileSync(join(dir, 'main/classes/services/IFooService.cls'), 'utf8')).to.include('IFooService');
    await rm(dir, { recursive: true, force: true });
  });

  it('supports dry-run without writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const plan: GenerationPlan = {
      artifacts: [{ id: 'serviceInterface', relativePath: 'main/classes/services/IFooService.cls', content: 'x' }],
    };
    const manifest = await GenerationEngine.execute(plan, { baseDir: dir, dryRun: true });
    expect(manifest.wouldCreate).to.have.length(1);
    expect(await exists(join(dir, 'main/classes/services/IFooService.cls'))).to.equal(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('detects duplicate relative paths before writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const plan: GenerationPlan = {
      artifacts: [
        { id: 'serviceInterface', relativePath: 'dup.cls', content: 'a' },
        { id: 'serviceInterface', relativePath: 'dup.cls', content: 'b' },
      ],
    };
    try {
      await GenerationEngine.execute(plan, { baseDir: dir });
      expect.fail('Expected duplicate relativePath error');
    } catch (error) {
      expect(isAepGenerationError(error)).to.equal(true);
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).to.equal('duplicate-path');
      expect(error.data).to.deep.equal({ relativePath: 'dup.cls' });
      expect(error.message).to.equal('Generation plan contains duplicate relativePath "dup.cls".');
    }
    expect(await exists(join(dir, 'dup.cls'))).to.equal(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('supports overwrite=skip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const target = join(dir, 'main/classes/services/IFooService.cls');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, 'existing', 'utf8');
    const plan: GenerationPlan = {
      artifacts: [{ id: 'serviceInterface', relativePath: 'main/classes/services/IFooService.cls', content: 'new' }],
    };

    const manifest = await GenerationEngine.execute(plan, { baseDir: dir, overwrite: 'skip' });
    expect(manifest.created).to.have.length(0);
    expect(manifest.skipped).to.deep.equal([target]);
    expect(readFileSync(target, 'utf8')).to.equal('existing');
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses by default, listing every existing path and writing nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const first = join(dir, 'main/classes/services/IFooService.cls');
    const second = join(dir, 'main/classes/services/FooService.cls');
    const fresh = join(dir, 'main/classes/services/FooServiceImpl.cls');
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, 'existing', 'utf8');
    await writeFile(second, 'existing', 'utf8');
    const plan: GenerationPlan = {
      artifacts: [
        { id: 'serviceImpl', relativePath: 'main/classes/services/FooServiceImpl.cls', content: 'new' },
        { id: 'serviceInterface', relativePath: 'main/classes/services/IFooService.cls', content: 'new' },
        { id: 'serviceFacade', relativePath: 'main/classes/services/FooService.cls', content: 'new' },
      ],
    };

    try {
      await GenerationEngine.execute(plan, { baseDir: dir });
      expect.fail('Expected overwrite error');
    } catch (error) {
      expect(isAepGenerationError(error)).to.equal(true);
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).to.equal('file-exists');
      expect(error.data).to.deep.equal({ absolutePaths: [first, second] });
      expect(error.message).to.equal(`Refusing to overwrite 2 existing file(s): ${first}, ${second}`);
    }
    expect(await exists(fresh)).to.equal(false);
    expect(readFileSync(first, 'utf8')).to.equal('existing');
    await rm(dir, { recursive: true, force: true });
  });

  it('replaces existing files with overwrite=overwrite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const target = join(dir, 'main/classes/services/IFooService.cls');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, 'existing', 'utf8');
    const plan: GenerationPlan = {
      artifacts: [{ id: 'serviceInterface', relativePath: 'main/classes/services/IFooService.cls', content: 'new' }],
    };

    const manifest = await GenerationEngine.execute(plan, { baseDir: dir, overwrite: 'overwrite' });
    expect(manifest.created).to.deep.equal([target]);
    expect(readFileSync(target, 'utf8')).to.equal('new');
    await rm(dir, { recursive: true, force: true });
  });

  it('stops before the next write once cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simply-aep-engine-'));
    const controller = new AbortController();
    const plan: GenerationPlan = {
      artifacts: [
        { id: 'serviceInterface', relativePath: 'A.cls', content: 'a' },
        { id: 'serviceInterface', relativePath: 'B.cls', content: 'b' },
      ],
    };
    try {
      await GenerationEngine.execute(plan, {
        baseDir: dir,
        signal: controller.signal,
        onFile: () => controller.abort(),
      });
      expect.fail('Expected cancellation');
    } catch (error) {
      if (!isAepGenerationError(error)) throw error;
      expect(error.code).to.equal('cancelled');
      expect(error.data).to.deep.equal({ created: [join(dir, 'A.cls')] });
    }
    expect(await exists(join(dir, 'B.cls'))).to.equal(false);
    await rm(dir, { recursive: true, force: true });
  });
});
