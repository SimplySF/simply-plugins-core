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
import path from 'node:path';
import { getPluginConfig, type SfdxProject } from '@simplysf/simply-core';

/** The dotenv keys this feature writes, for a downstream job or a consuming repo to fetch by. */
export const AER_PACKAGE_URL_KEY = 'AER_PACKAGE_URL';
export const AER_PACKAGE_FILE_KEY = 'AER_PACKAGE_FILE';
export const AER_PACKAGE_VERSION_KEY = 'AER_PACKAGE_VERSION';

/**
 * What aer accepts as each half of a package file name, `<package>@<namespace>.pkg`. aer reads a
 * package's namespace from its file name and rejects anything else.
 */
const AER_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The placeholders a repository URL template may use. */
export const REPOSITORY_URL_PLACEHOLDERS = [
  'name',
  'version',
  'versionNumber',
  'channel',
  'namespace',
  'file',
] as const;

export type RepositoryUrlPlaceholder = (typeof REPOSITORY_URL_PLACEHOLDERS)[number];

export type RepositoryUrlValues = Record<RepositoryUrlPlaceholder, string>;

/** `plugins.simply.aer` in `sfdx-project.json`. Every field is optional. */
export type AerPluginConfig = {
  /** URL template the `.pkg` is uploaded to and dependencies are downloaded from. */
  repositoryUrl?: string;
};

/** @returns `plugins.simply.aer`, or an empty object when the project declares none. */
export function readAerPluginConfig(project: SfdxProject): AerPluginConfig {
  return getPluginConfig<AerPluginConfig>(project, 'plugins.simply.aer') ?? {};
}

/**
 * Reduce a package name or namespace to something aer accepts in a package file name: letters,
 * digits and underscores, starting with a letter.
 *
 * Each run of anything else becomes one underscore, and a name that doesn't start with a letter is
 * prefixed with `P`. The rule is fixed rather than configurable because a dependent repo has to
 * compute the same file name to download the package.
 *
 * @throws {Error} If nothing usable is left, e.g. for a name made only of punctuation.
 */
export function toAerIdentifier(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_');
  const identifier = /^[A-Za-z]/.test(cleaned) ? cleaned : `P${cleaned}`;

  if (!/[A-Za-z0-9]/.test(cleaned) || !AER_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `Cannot derive an aer package name from "${raw}": aer needs a name that starts with a letter and contains only letters, digits and underscores.`,
    );
  }

  return identifier;
}

/**
 * The file name an aer package is published and loaded under, `<package>@<namespace>.pkg`.
 *
 * A package with no namespace uses its own name as the namespace, since aer requires one.
 */
export function toAerPackageFile(
  packageName: string,
  namespacePrefix: string | null | undefined,
): {
  file: string;
  name: string;
  namespace: string;
} {
  const name = toAerIdentifier(packageName);
  const namespace = namespacePrefix ? toAerIdentifier(namespacePrefix) : name;

  return { file: `${name}@${namespace}.pkg`, name, namespace };
}

/**
 * Fill in a repository URL template.
 *
 * Every value is URL-encoded, so `@` in the file name becomes `%40` and `/` in a branch can't add a
 * path segment. Anything in braces that isn't a known placeholder fails, which also catches a CI
 * variable such as `${CI_API_V4_URL}` that the shell didn't expand.
 *
 * @throws {Error} If the template uses an unknown placeholder, or uses neither `{version}` nor
 * `{versionNumber}` — every version would then be uploaded to the same URL.
 */
export function renderRepositoryUrl(template: string, values: RepositoryUrlValues): string {
  const used = new Set<string>();
  const rendered = template.replace(/\{([^{}]*)\}/g, (match, key: string) => {
    if (!(REPOSITORY_URL_PLACEHOLDERS as readonly string[]).includes(key)) {
      throw new Error(
        `Unknown placeholder ${match} in the aer repository URL. Use any of: ${REPOSITORY_URL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`,
      );
    }
    used.add(key);
    return encodeURIComponent(values[key as RepositoryUrlPlaceholder]);
  });

  if (!used.has('version') && !used.has('versionNumber')) {
    throw new Error(
      'The aer repository URL must include {version} or {versionNumber}, or every package version would be uploaded to the same URL.',
    );
  }

  return rendered;
}

/**
 * Split a `Name: value` header, e.g. `Authorization: Bearer abc`, into its two parts.
 *
 * @throws {Error} If there's no colon, the name isn't a valid header name, or the value is empty.
 * The message never includes the value, which is usually a secret.
 */
export function parseRepositoryHeader(raw: string): { name: string; value: string } {
  const separator = raw.indexOf(':');
  const name = separator === -1 ? '' : raw.slice(0, separator).trim();
  const value = separator === -1 ? '' : raw.slice(separator + 1).trim();

  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || value.length === 0) {
    throw new Error('The aer repository header must look like "Name: value", e.g. "Authorization: Bearer <token>".');
  }

  return { name, value };
}

/**
 * Whether there's any Apex under `rootDir` for aer to compile.
 *
 * @returns `false` when `rootDir` doesn't exist — a metadata-only package is a skip, not an error.
 */
export async function hasApexSources(rootDir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  return entries.some((entry) => entry.isFile() && ['.cls', '.trigger'].includes(path.extname(entry.name)));
}
