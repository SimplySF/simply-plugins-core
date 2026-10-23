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

import type { SfdxProject } from '@simplysf/simply-core';
import { describe, expect, it } from 'vitest';
import { isIgnoredDependency, resolveDependencyRepository } from '../src/dependencyRepositoryResolver.js';
import { hasCredentialsInUrl, readDependencyRepositories } from '../src/schemas/sfdx-project/dependencyRepositories.js';

/** @returns A minimal project whose `plugins.simply.dependencies.repositories` is `repositories`. */
function projectWith(repositories: unknown): SfdxProject {
  return {
    packageDirectories: [{ path: 'force-app', default: true }],
    plugins: { simply: { dependencies: { repositories } } },
  };
}

describe('hasCredentialsInUrl', () => {
  it.each([
    ['https://ghp_token@github.com/org/repo.git', true],
    ['https://user:secret@gitlab.example.internal/group/repo.git', true],
    ['ssh://git:secret@gitlab.example.internal/group/repo.git', true],
    ['https://github.com/org/repo.git', false],
    ['ssh://git@gitlab.example.internal:2222/group/repo.git', false],
    ['git@github.com:org/repo.git', false],
    ['../local/repo', false],
  ])('%s → %s', (url, expected) => {
    expect(hasCredentialsInUrl(url)).toBe(expected);
  });
});

describe('readDependencyRepositories', () => {
  it('returns an empty map when the project has none', () => {
    expect(readDependencyRepositories({ packageDirectories: [] })).toStrictEqual({});
  });

  it('keeps unknown keys inside an entry, for forward compatibility', () => {
    const repositories = readDependencyRepositories(
      projectWith({ fflib: { url: 'https://github.com/org/fflib.git', ref: 'v3.0.0', future: true } }),
    );
    expect(repositories.fflib).toStrictEqual({ url: 'https://github.com/org/fflib.git', ref: 'v3.0.0', future: true });
  });

  it('rejects an entry without a url, naming the key', () => {
    expect(() => readDependencyRepositories(projectWith({ fflib: { ref: 'main' } }))).toThrow(
      expect.objectContaining({
        name: 'InvalidRepositoryConfigError',
        message: expect.stringContaining('plugins.simply.dependencies.repositories.fflib.url') as string,
      }),
    );
  });

  it('rejects a non-string ref', () => {
    expect(() => readDependencyRepositories(projectWith({ fflib: { url: 'x', ref: 3 } }))).toThrow(
      expect.objectContaining({ name: 'InvalidRepositoryConfigError' }),
    );
  });

  it('rejects a url with credentials, naming the key', () => {
    expect(() =>
      readDependencyRepositories(projectWith({ core: { url: 'https://oauth2:abc@gitlab.example.internal/core.git' } })),
    ).toThrow(
      expect.objectContaining({ name: 'CredentialsInUrlError', message: expect.stringContaining('"core"') as string }),
    );
  });
});

describe('resolveDependencyRepository', () => {
  const repositories = {
    'fflib@3.0.0-1': { url: 'exact' },
    fflib: { url: 'prefix' },
    '0Ho000000000001AAA': { url: 'by-id' },
    'my-core': { url: 'by-other-alias' },
  };

  it('prefers an exact match', () => {
    expect(resolveDependencyRepository('fflib@3.0.0-1', repositories)?.repository.url).toBe('exact');
  });

  it('falls back to the alias prefix, so a rewritten version alias still matches', () => {
    expect(resolveDependencyRepository('fflib@3.1.0-2', repositories)).toStrictEqual({
      key: 'fflib',
      repository: { url: 'prefix' },
    });
  });

  it('matches by the ID an alias resolves to', () => {
    const aliases = { 'other@1.0.0-1': '0Ho000000000001AAA' };
    expect(resolveDependencyRepository('other@1.0.0-1', repositories, aliases)?.key).toBe('0Ho000000000001AAA');
  });

  it('matches a bare ID through another alias for the same ID', () => {
    const aliases = { 'my-core@1.8.0-3': '04t000000000009AAA' };
    expect(resolveDependencyRepository('04t000000000009AAA', repositories, aliases)?.key).toBe('my-core');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveDependencyRepository('SomeAppExchangePackage@5.2', repositories)).toBeUndefined();
  });
});

describe('isIgnoredDependency', () => {
  it('matches by value, alias prefix, or resolved ID', () => {
    const aliases = { 'pkg@1.0.0-1': '0Ho000000000002AAA' };
    expect(isIgnoredDependency('pkg@1.0.0-1', ['pkg@1.0.0-1'])).toBe(true);
    expect(isIgnoredDependency('pkg@1.0.0-1', ['pkg'])).toBe(true);
    expect(isIgnoredDependency('pkg@1.0.0-1', ['0Ho000000000002AAA'], aliases)).toBe(true);
    expect(isIgnoredDependency('pkg@1.0.0-1', ['other'], aliases)).toBe(false);
    expect(isIgnoredDependency('pkg@1.0.0-1', [])).toBe(false);
  });
});
