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

/* eslint-disable no-await-in-loop -- Writes must finish in order for progress and partial cancellation. */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { AepGenerationError } from './errors.js';
import type { EngineOptions, GenerationManifest, GenerationPlan, OverwritePolicy } from './model.js';

/**
 * @param plan - The plan to check.
 * @throws {AepGenerationError} `duplicate-path` when two artifacts share a `relativePath`.
 */
export const ensureNoPlanCollisions = (plan: GenerationPlan): void => {
  const seen = new Set<string>();
  for (const artifact of plan.artifacts) {
    if (seen.has(artifact.relativePath)) {
      throw new AepGenerationError(
        'duplicate-path',
        `Generation plan contains duplicate relativePath "${artifact.relativePath}".`,
        { relativePath: artifact.relativePath },
      );
    }
    seen.add(artifact.relativePath);
  }
};

const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Writes a plan's artifacts under `options.baseDir`.
 *
 * Under the default `error` policy nothing is written when any planned path exists, and the
 * `file-exists` error lists every one of them in `data.absolutePaths`, including during dry runs.
 * Writes are not atomic and are not rolled back. `cancelled` means stopped before completing;
 * cancellation and write failures include already written paths in `data.created`.
 */
export class GenerationEngine {
  public static async execute(plan: GenerationPlan, options: EngineOptions): Promise<GenerationManifest> {
    ensureNoPlanCollisions(plan);
    const overwritePolicy: OverwritePolicy = options.overwrite ?? 'error';
    const baseDir = resolve(options.baseDir);
    const absoluteArtifacts = plan.artifacts.map((artifact) => {
      const absolutePath = resolve(baseDir, artifact.relativePath);
      const fromBase = relative(baseDir, absolutePath);
      if (
        isAbsolute(artifact.relativePath) ||
        win32.isAbsolute(artifact.relativePath) ||
        artifact.relativePath.includes('\\') ||
        fromBase === '..' ||
        fromBase.startsWith(`..${sep}`) ||
        isAbsolute(fromBase)
      ) {
        throw new AepGenerationError(
          'invalid-path',
          `Artifact path "${artifact.relativePath}" must stay within baseDir.`,
          { relativePath: artifact.relativePath, baseDir },
        );
      }
      return { ...artifact, absolutePath };
    });

    if (overwritePolicy === 'error') {
      const existence = await Promise.all(absoluteArtifacts.map((artifact) => fileExists(artifact.absolutePath)));
      const absolutePaths = absoluteArtifacts.filter((_artifact, index) => existence[index]).map((a) => a.absolutePath);
      if (absolutePaths.length > 0) {
        throw new AepGenerationError(
          'file-exists',
          `Refusing to overwrite ${absolutePaths.length} existing file(s): ${absolutePaths.join(', ')}`,
          { absolutePaths },
        );
      }
    }

    if (options.dryRun) return { created: [], skipped: [], wouldCreate: absoluteArtifacts.map((a) => a.absolutePath) };

    const created: string[] = [];
    const skipped: string[] = [];
    const checkCancellation = (): void => {
      if (options.signal?.aborted) {
        throw new AepGenerationError('cancelled', 'Operation cancelled.', { created: [...created] });
      }
    };
    for (const artifact of absoluteArtifacts) {
      checkCancellation();
      let status: 'created' | 'skipped' = 'created';
      let writing = false;
      try {
        await mkdir(dirname(artifact.absolutePath), { recursive: true });
        writing = true;
        // Exclusive creation holds the skip/error policies even if a file appears after the check above.
        await writeFile(artifact.absolutePath, artifact.content, {
          encoding: 'utf8',
          flag: overwritePolicy === 'overwrite' ? 'w' : 'wx',
        });
        created.push(artifact.absolutePath);
      } catch (error) {
        // Only the exclusive write's EEXIST means "the target exists"; mkdir's means a file is in the way.
        const code = writing ? (error as NodeJS.ErrnoException).code : undefined;
        if (overwritePolicy === 'skip' && code === 'EEXIST') {
          skipped.push(artifact.absolutePath);
          status = 'skipped';
        } else if (code === 'EEXIST') {
          throw new AepGenerationError('file-exists', `Refusing to overwrite existing file: ${artifact.absolutePath}`, {
            absolutePaths: [artifact.absolutePath],
            created: [...created],
          });
        } else {
          const message = error instanceof Error ? error.message : String(error);
          throw new AepGenerationError(
            'write-failed',
            `Failed to write artifact "${artifact.absolutePath}": ${message}`,
            { absolutePath: artifact.absolutePath, cause: error, created: [...created] },
          );
        }
      }
      options.onFile?.({
        absolutePath: artifact.absolutePath,
        status,
        done: created.length + skipped.length,
        total: absoluteArtifacts.length,
      });
    }

    return { created, skipped };
  }
}
