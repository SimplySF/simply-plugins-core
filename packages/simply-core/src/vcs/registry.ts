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

import type { VcsProvider, VcsProviderFactory, VcsProviderKind, VcsProviderOptions } from './types.js';

const factories = new Map<VcsProviderKind, VcsProviderFactory>();

/**
 * Registers a platform implementation. Built-in providers register themselves when `./index.js` is
 * imported; call this directly to add a platform without modifying this package.
 */
export function registerVcsProvider(kind: VcsProviderKind, factory: VcsProviderFactory): void {
  factories.set(kind, factory);
}

/** The platforms currently registered, for flag options and error messages. */
export function listVcsProviderKinds(): VcsProviderKind[] {
  return [...factories.keys()].sort();
}

/** Builds a provider for the given platform and instance. */
export function createVcsProvider(kind: VcsProviderKind, options: VcsProviderOptions): VcsProvider {
  const factory = factories.get(kind);
  if (!factory) {
    const known = listVcsProviderKinds().join(', ');
    throw new Error(`VCS provider "${kind as string}" is not supported. Registered providers: ${known}.`);
  }
  return factory(options);
}
