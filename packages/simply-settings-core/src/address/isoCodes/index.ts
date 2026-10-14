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
import { EnvHttpProxyAgent } from 'undici';
import { parseStateDefinitions, type StateDefinition } from '../stateDefinitions.js';
import { debianIsoCodesSource } from './debian.js';
import type { IsoCodesFetchOptions, IsoCodesSource, IsoCodesSourceId, IsoCodesSubdivision } from './types.js';

/** Every supported source, by id. Adding a source is an entry here plus its adapter. */
export const ISO_CODES_SOURCES: Readonly<Record<IsoCodesSourceId, IsoCodesSource>> = {
  debian: debianIsoCodesSource,
};

/** The ids of {@link ISO_CODES_SOURCES}, e.g. for a CLI flag's allowed values. */
export const ISO_CODES_SOURCE_IDS = Object.keys(ISO_CODES_SOURCES) as IsoCodesSourceId[];

/**
 * Turns a source's subdivisions into state definitions.
 *
 * @param subdivisions - From a source.
 * @param options - `allLevels` keeps subdivisions nested under another one (French departments
 * under their regions); by default only the top level is kept.
 * @returns The definitions, in the source's order.
 * @throws SfError (`InvalidStateDefinitionsError`) for an entry `parseStateDefinitions` rejects.
 */
export function subdivisionsToStateDefinitions(
  subdivisions: IsoCodesSubdivision[],
  options: { allLevels?: boolean } = {},
): StateDefinition[] {
  const kept = options.allLevels ? subdivisions : subdivisions.filter((subdivision) => !subdivision.parent);
  return parseStateDefinitions(Object.fromEntries(kept.map((subdivision) => [subdivision.code, subdivision.name])));
}

export type FetchIsoCodesStateDefinitionsOptions = IsoCodesFetchOptions & {
  source: IsoCodesSourceId;
  /** In the source's own terms; for `debian`, a tag or branch. Defaults to the source's latest release. */
  version?: string;
  /** See {@link subdivisionsToStateDefinitions}. */
  allLevels?: boolean;
};

export type IsoCodesStateDefinitions = {
  source: IsoCodesSourceId;
  /** The source's label, e.g. `Debian iso-codes`. */
  label: string;
  /** The version used: as given, or the resolved latest release. */
  version: string;
  /** Where the data was downloaded from. */
  url: string;
  allLevels: boolean;
  definitions: StateDefinition[];
};

/**
 * Downloads ISO 3166-2 data from a source and converts it to state definitions. Nothing is
 * cached or written to disk.
 *
 * @param options - The source, an optional version, `allLevels`, and HTTP settings.
 * @returns The definitions, with the source, version, and URL they came from.
 * @throws SfError (`UnsupportedIsoCodesSourceError`) for an unknown source; otherwise whatever the
 * source's adapter throws, or (`InvalidIsoCodesDataError`) when its data fails validation.
 */
export async function fetchIsoCodesStateDefinitions(
  options: FetchIsoCodesStateDefinitionsOptions,
): Promise<IsoCodesStateDefinitions> {
  const source = Object.hasOwn(ISO_CODES_SOURCES, options.source) ? ISO_CODES_SOURCES[options.source] : undefined;
  if (!source) {
    throw new SfError(
      `Unsupported ISO 3166-2 source "${String(options.source)}". Supported: ${ISO_CODES_SOURCE_IDS.join(', ')}.`,
      'UnsupportedIsoCodesSourceError',
    );
  }

  const ownDispatcher = options.dispatcher ? undefined : new EnvHttpProxyAgent();
  const fetchOptions: IsoCodesFetchOptions = { ...options, dispatcher: options.dispatcher ?? ownDispatcher };
  const allLevels = options.allLevels ?? false;

  try {
    const version = options.version ?? (await source.resolveLatestVersion(fetchOptions));
    const { url, subdivisions } = await source.fetchSubdivisions(version, fetchOptions);

    let definitions: StateDefinition[];
    try {
      definitions = subdivisionsToStateDefinitions(subdivisions, { allLevels });
    } catch (error) {
      throw new SfError(
        `${url}: ${error instanceof Error ? error.message : String(error)}`,
        'InvalidIsoCodesDataError',
      );
    }

    return { source: source.id, label: source.label, version, url, allLevels, definitions };
  } finally {
    await ownDispatcher?.close();
  }
}
