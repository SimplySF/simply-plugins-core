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

import { SfError } from '@salesforce/core';
import { getJson } from './http.js';
import type { IsoCodesSource, IsoCodesSubdivision } from './types.js';

// Debian's iso-codes is LGPL-2.1+. It's downloaded at run time and used in memory, never
// redistributed in this package — see docs/design/0043-settings-address-states-iso-codes.md.

const LABEL = 'Debian iso-codes';
const HOMEPAGE = 'https://salsa.debian.org/iso-codes-team/iso-codes';
const TAGS_URL =
  'https://salsa.debian.org/api/v4/projects/iso-codes-team%2Fiso-codes/repository/tags?order_by=version&sort=desc&per_page=20';
const RELEASE_TAG_PATTERN = /^v\d+(\.\d+)*$/;

/**
 * The raw `iso_3166-2.json` for a tag or branch.
 *
 * @param version - A tag (`v4.20.1`) or branch (`main`).
 * @returns The URL.
 */
export function debianIsoCodesDataUrl(version: string): string {
  const ref = version.split('/').map(encodeURIComponent).join('/');
  return `${HOMEPAGE}/-/raw/${ref}/data/iso_3166-2.json`;
}

function isSubdivision(value: unknown): value is IsoCodesSubdivision & { type?: unknown } {
  if (value === null || typeof value !== 'object') return false;
  const { code, name, parent } = value as Record<string, unknown>;
  return typeof code === 'string' && typeof name === 'string' && (parent === undefined || typeof parent === 'string');
}

/** Debian's `iso-codes` repository on salsa.debian.org: release tags, or any branch. */
export const debianIsoCodesSource: IsoCodesSource = {
  id: 'debian',
  label: LABEL,
  homepage: HOMEPAGE,

  async resolveLatestVersion(options) {
    // Tags, not `main`: tags are what distributions ship, while `main` can hold in-progress edits.
    const tags = await getJson(TAGS_URL, LABEL, options);
    const latest = Array.isArray(tags)
      ? (tags as Array<{ name?: unknown }>)
          .map((tag) => tag?.name)
          .find((name): name is string => typeof name === 'string' && RELEASE_TAG_PATTERN.test(name))
      : undefined;

    if (!latest) {
      throw new SfError(`Couldn't find a release of ${LABEL} at ${TAGS_URL}.`, 'IsoCodesDownloadError', [
        `Specify a version explicitly, e.g. a tag from ${HOMEPAGE}/-/tags.`,
      ]);
    }
    return latest;
  },

  async fetchSubdivisions(version, options) {
    const url = debianIsoCodesDataUrl(version);
    const data = await getJson(url, LABEL, options);

    if (data === undefined) {
      throw new SfError(`${LABEL} has no version "${version}".`, 'IsoCodesVersionNotFoundError', [
        `See ${HOMEPAGE}/-/tags for the available versions.`,
      ]);
    }

    const entries = (data as Record<string, unknown> | null)?.['3166-2'];
    if (!Array.isArray(entries) || !entries.every(isSubdivision)) {
      throw new SfError(
        `${url} isn't in the expected shape: { "3166-2": [{ code, name, parent? }] }.`,
        'InvalidIsoCodesDataError',
      );
    }

    // `type` (e.g. "Metropolitan department") is dropped: nothing selects on it yet.
    const subdivisions = entries.map(({ code, name, parent }) => (parent ? { code, name, parent } : { code, name }));
    return { url, subdivisions };
  },
};
