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

/* eslint-disable no-await-in-loop -- Observe cancellation between filesystem inspections. */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GenerationEngine, ensureNoPlanCollisions } from './engine.js';
import type { AepCommandResult, ArtifactId, GenerationPlan } from './model.js';
import { checkCancelled, type GenerationApplyContext, type AepUseCaseContext } from './useCase.js';

export type PlannedFile = {
  artifactId: ArtifactId;
  relativePath: string;
  absolutePath: string;
  content: string;
  status: 'new' | 'exists';
};
export type GenerationPreview = {
  commandId: string;
  baseDir: string;
  files: PlannedFile[];
  manualSteps?: string[];
};
export type GenerationOutcome = AepCommandResult;

/**
 * @param plan - What to generate.
 * @param baseDir - Where to generate it.
 * @param commandId - The use case's descriptor id, carried for the renderer.
 * @param manualSteps - Steps the caller must do by hand, if any.
 * @param ctx - Cancellation.
 * @returns Every planned file with its absolute path and whether it already exists. Writes nothing.
 */
export const planGeneration = async (
  plan: GenerationPlan,
  baseDir: string,
  commandId: string,
  manualSteps?: string[],
  ctx?: AepUseCaseContext,
): Promise<GenerationPreview> => {
  checkCancelled(ctx);
  ensureNoPlanCollisions(plan);
  const files: PlannedFile[] = [];
  for (const artifact of plan.artifacts) {
    checkCancelled(ctx);
    const absolutePath = resolve(baseDir, artifact.relativePath);
    let status: PlannedFile['status'] = 'new';
    try {
      await stat(absolutePath);
      status = 'exists';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    files.push({
      artifactId: artifact.id,
      relativePath: artifact.relativePath,
      absolutePath,
      content: artifact.content,
      status,
    });
  }
  checkCancelled(ctx);
  return { commandId, baseDir: resolve(baseDir), files, ...(manualSteps ? { manualSteps } : {}) };
};

/**
 * Writes a preview. Refuses to replace an existing file unless `ctx.overwrite` is `overwrite` (or
 * `skip`, which leaves it alone).
 *
 * @param preview - From {@link planGeneration}.
 * @param ctx - Overwrite policy, progress and cancellation.
 * @returns What was written.
 * @throws {AepGenerationError} `file-exists` listing every existing path, under the default policy.
 */
export const applyGeneration = async (
  preview: GenerationPreview,
  ctx?: GenerationApplyContext,
): Promise<GenerationOutcome> => {
  const manifest = await GenerationEngine.execute(
    {
      artifacts: preview.files.map((file) => ({
        id: file.artifactId,
        relativePath: file.relativePath,
        content: file.content,
      })),
    },
    {
      baseDir: preview.baseDir,
      overwrite: ctx?.overwrite ?? 'error',
      signal: ctx?.signal,
      onFile: ({ done, total }) => ctx?.onProgress?.({ phase: 'write', done, total }),
    },
  );
  return {
    baseDir: preview.baseDir,
    ...manifest,
    ...(preview.manualSteps ? { manualSteps: preview.manualSteps } : {}),
  };
};
