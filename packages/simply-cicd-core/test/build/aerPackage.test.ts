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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasApexSources,
  parseRepositoryHeader,
  readAerPluginConfig,
  renderRepositoryUrl,
  type RepositoryUrlValues,
  toAerIdentifier,
  toAerPackageFile,
} from '../../src/build/aerPackage.js';

const values: RepositoryUrlValues = {
  name: 'MyPackage',
  version: '1.2.3-4',
  versionNumber: '1.2.3.4',
  channel: 'latest',
  namespace: 'acme',
  file: 'MyPackage@acme.pkg',
};

describe('toAerIdentifier', () => {
  it('keeps a name aer already accepts', () => {
    expect(toAerIdentifier('My_Package2')).toBe('My_Package2');
  });

  it('collapses each run of other characters into one underscore', () => {
    expect(toAerIdentifier('My-Pkg')).toBe('My_Pkg');
    expect(toAerIdentifier('My Big -- Package')).toBe('My_Big_Package');
  });

  it('prefixes a name that does not start with a letter', () => {
    expect(toAerIdentifier('1Pkg')).toBe('P1Pkg');
    expect(toAerIdentifier('_internal')).toBe('P_internal');
  });

  it('accepts a single letter, including P', () => {
    expect(toAerIdentifier('P')).toBe('P');
  });

  it('rejects a name with no letters or digits, quoting the rule', () => {
    expect(() => toAerIdentifier('--')).toThrow(
      /starts with a letter and contains only letters, digits and underscores/,
    );
  });
});

describe('toAerPackageFile', () => {
  it('uses the namespace when the package has one', () => {
    expect(toAerPackageFile('MyPackage', 'acme')).toStrictEqual({
      file: 'MyPackage@acme.pkg',
      name: 'MyPackage',
      namespace: 'acme',
    });
  });

  it('uses the package name as the namespace when there is none', () => {
    expect(toAerPackageFile('My-Pkg', null).file).toBe('My_Pkg@My_Pkg.pkg');
    expect(toAerPackageFile('MyPackage', '').namespace).toBe('MyPackage');
  });
});

describe('renderRepositoryUrl', () => {
  it('fills every placeholder', () => {
    expect(
      renderRepositoryUrl('https://repo/{name}/{namespace}/{channel}/{versionNumber}/{version}/{file}', values),
    ).toBe('https://repo/MyPackage/acme/latest/1.2.3.4/1.2.3-4/MyPackage%40acme.pkg');
  });

  it('encodes values so a branch cannot add a path segment', () => {
    expect(renderRepositoryUrl('https://repo/{version}', { ...values, version: '1.2.3-4.a/b' })).toBe(
      'https://repo/1.2.3-4.a%2Fb',
    );
  });

  it('rejects an unknown placeholder, including an unexpanded CI variable', () => {
    expect(() => renderRepositoryUrl('https://repo/{nmae}/{version}', values)).toThrow(/Unknown placeholder \{nmae\}/);
    expect(() => renderRepositoryUrl('${CI_API_V4_URL}/{version}', values)).toThrow(/\{CI_API_V4_URL\}/);
  });

  it('requires the version somewhere in the path', () => {
    expect(() => renderRepositoryUrl('https://repo/{name}/{file}', values)).toThrow(/\{version\} or \{versionNumber\}/);
    expect(renderRepositoryUrl('https://repo/{versionNumber}/{file}', values)).toBe(
      'https://repo/1.2.3.4/MyPackage%40acme.pkg',
    );
  });
});

describe('parseRepositoryHeader', () => {
  it('splits at the first colon only', () => {
    expect(parseRepositoryHeader('Authorization: Basic dXNlcjpwYXNz:x')).toStrictEqual({
      name: 'Authorization',
      value: 'Basic dXNlcjpwYXNz:x',
    });
  });

  it('accepts vendor headers', () => {
    expect(parseRepositoryHeader('JOB-TOKEN:abc')).toStrictEqual({ name: 'JOB-TOKEN', value: 'abc' });
  });

  it('rejects a malformed header without echoing the secret', () => {
    for (const raw of ['secret-token', 'Bad Name: secret-token', 'Authorization:   ']) {
      expect(() => parseRepositoryHeader(raw)).toThrow(/Name: value/);
      try {
        parseRepositoryHeader(raw);
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-token');
      }
    }
  });
});

describe('readAerPluginConfig', () => {
  it('reads plugins.simply.aer, or nothing', () => {
    expect(
      readAerPluginConfig({
        packageDirectories: [],
        plugins: { simply: { aer: { repositoryUrl: 'https://r/{version}' } } },
      }),
    ).toStrictEqual({ repositoryUrl: 'https://r/{version}' });
    expect(readAerPluginConfig({ packageDirectories: [] })).toStrictEqual({});
  });
});

describe('hasApexSources', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aer-package-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('finds a class or a trigger at any depth', async () => {
    await fs.mkdir(path.join(dir, 'main', 'default', 'triggers'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'main', 'default', 'triggers', 'T.trigger'),
      'trigger T on Account (before insert) {}',
    );
    expect(await hasApexSources(dir)).toBe(true);
  });

  it('is false for metadata only, and for a missing directory', async () => {
    await fs.writeFile(path.join(dir, 'Account.object-meta.xml'), '<CustomObject/>');
    await fs.writeFile(path.join(dir, 'Foo.cls-meta.xml'), '<ApexClass/>');
    expect(await hasApexSources(dir)).toBe(false);
    expect(await hasApexSources(path.join(dir, 'missing'))).toBe(false);
  });
});
