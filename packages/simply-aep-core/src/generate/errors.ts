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

/** Stable codes thrown by the generation engine. */
export type AepGenerationErrorCode =
  | 'org-required'
  | 'nothing-selected'
  | 'cancelled'
  | 'duplicate-path'
  | 'file-exists'
  | 'write-failed'
  | 'invalid-developer-name'
  | 'invalid-path'
  | 'template-missing'
  | 'template-empty'
  | 'sobject-not-found'
  | 'describe-failed';

/**
 * Base error for everything the generation engine throws on purpose.
 *
 * `code` and the shape of `data` are part of the public API and are semver-covered; `message` is
 * default English text that callers may show as is or replace using `code`.
 */
export class AepGenerationError<C extends string = AepGenerationErrorCode, D = unknown> extends Error {
  public constructor(
    public readonly code: C,
    message: string,
    public readonly data?: D,
  ) {
    super(message);
    this.name = 'AepGenerationError';
  }
}

/**
 * Structural check for {@link AepGenerationError}. Prefer this over `instanceof`, which fails when a
 * consumer ends up with two copies of this package.
 *
 * @param error - Anything caught.
 * @returns Whether `error` is an `AepGenerationError`.
 */
export const isAepGenerationError = (error: unknown): error is AepGenerationError =>
  error instanceof AepGenerationError ||
  (typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AepGenerationError' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string');
