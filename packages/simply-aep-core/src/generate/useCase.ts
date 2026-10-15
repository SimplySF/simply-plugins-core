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

import type { Connection } from '@salesforce/core';
import { z } from 'zod';
import { AepGenerationError } from './errors.js';
import type { OverwritePolicy } from './model.js';

export type ProgressEvent = {
  phase: string;
  done?: number;
  total?: number;
  message?: string;
};

export type UseCaseContext = {
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
};

/** How a caller that prompts (the CLI's `-i`, an editor form) should ask for an option. Read with {@link uiHints}. */
export type UiHint = {
  kind: 'file' | 'folder' | 'multiString' | 'string' | 'boolean' | 'enum';
  label: string;
  summary?: string;
  placeholder?: string;
  fileFilter?: 'json' | 'csv' | 'json-or-csv';
  /** The caller asks for exactly one option in the group. */
  exclusiveGroup?: string;
  dependsOn?: string;
};

export type OrgRequirement = 'required' | 'optional' | 'none';
export type AepUseCaseContext = UseCaseContext & { projectRoot?: string };
export type GenerationApplyContext = AepUseCaseContext & { overwrite?: OverwritePolicy };

export type CommandDescriptor<S extends z.ZodType = z.ZodType> = {
  id: string;
  cliId: string;
  title: string;
  group: 'generate';
  destructive: boolean;
  requiresOrg: OrgRequirement;
  optionsSchema: S;
};
export type WriteUseCase<S extends z.ZodType, P, R> = {
  kind: 'write';
  descriptor: CommandDescriptor<S>;
  plan(conn: Connection | undefined, options: z.input<S>, ctx?: AepUseCaseContext): Promise<P>;
  apply(conn: Connection | undefined, plan: P, ctx?: GenerationApplyContext): Promise<R>;
};

/**
 * @param conn - The connection the caller has, if any.
 * @param descriptor - The use case that needs it.
 * @returns `conn`.
 * @throws {AepGenerationError} `org-required` when `conn` is missing.
 */
export const requireConnection = (conn: Connection | undefined, descriptor: CommandDescriptor): Connection => {
  if (!conn) {
    throw new AepGenerationError('org-required', `${descriptor.title} requires an org connection.`, {
      commandId: descriptor.id,
    });
  }
  return conn;
};

/**
 * @param schema - A use case's options schema.
 * @returns The {@link UiHint} for each option that declares one, keyed by option name.
 */
export const uiHints = <S extends z.ZodType>(schema: S): Record<string, UiHint> => {
  if (!(schema instanceof z.ZodObject)) return {};
  return Object.fromEntries(
    Object.entries(schema.shape).flatMap(([key, field]) => {
      let current: unknown = field;
      let meta: { ui?: UiHint } | undefined;
      while (current != null) {
        const candidate = current as { meta?: () => { ui?: UiHint }; unwrap?: () => unknown };
        meta = candidate.meta?.();
        if (meta?.ui ?? !candidate.unwrap) break;
        current = candidate.unwrap();
      }
      return meta?.ui ? [[key, meta.ui]] : [];
    }),
  );
};

/** @throws {AepGenerationError} `cancelled` when `ctx.signal` has been aborted. */
export const checkCancelled = (ctx?: UseCaseContext): void => {
  if (ctx?.signal?.aborted) throw new AepGenerationError('cancelled', 'Operation cancelled.');
};

export const startProgress = (ctx?: UseCaseContext, phase = 'start'): void => {
  checkCancelled(ctx);
  ctx?.onProgress?.({ phase });
  checkCancelled(ctx);
};

export const endProgress = (ctx?: UseCaseContext, phase = 'complete'): void => {
  checkCancelled(ctx);
  ctx?.onProgress?.({ phase });
  checkCancelled(ctx);
};
