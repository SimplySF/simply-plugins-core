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

import { getPluginConfig, type SfdxProject } from '@simplysf/simply-core';

/** The tag shape every `simply cicd build` command used before the format was configurable. */
export const DEFAULT_VERSION_TAG_FORMAT = 'v{MAJOR}.{MINOR}.{PATCH}.{BUILD}';

/** Where in `sfdx-project.json` a project declares its own format. */
export const VERSION_TAG_FORMAT_CONFIG_PATH = 'plugins.simply.versionTagFormat';

/** Overrides the project's format, in every command that reads it, when set to a non-empty value. */
export const VERSION_TAG_FORMAT_ENV_VAR = 'SIMPLY_CICD_VERSION_TAG_FORMAT';

const PLACEHOLDERS = ['MAJOR', 'MINOR', 'PATCH', 'BUILD'] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

/** A Salesforce package version's four numeric parts. */
export type VersionParts = Record<Lowercase<Placeholder>, string>;

/** `sf package version report` returns `Version` as `major.minor.patch.build`. */
const SALESFORCE_VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)\.(?<build>\d+)$/;

type Segment = { kind: 'literal'; text: string } | { kind: 'placeholder'; name: Placeholder };

/** Thrown for a format that can't be used, so callers that otherwise swallow errors can let it through. */
export class VersionTagFormatError extends Error {
  public constructor(format: string, problem: string, source = VERSION_TAG_FORMAT_CONFIG_PATH) {
    super(`Invalid version tag format "${format}" (${source}): ${problem}`);
    this.name = 'VersionTagFormatError';
  }
}

/** A tag split back into the version the format rendered and whatever was appended after it. */
export type ParsedVersionTag = {
  /** The rendered version, exactly as it appears at the start of the tag. */
  versionTag: string;
  version: VersionParts;
  /** Everything after the rendered version, without its leading `-`; `''` when there is none. */
  rest: string;
};

/**
 * Why `tag` isn't a legal git tag name, or `undefined` when it is. Mirrors `git check-ref-format`'s
 * rules for `refs/tags/<tag>`, plus git's refusal of tag names starting with `-`.
 */
function findRefNameProblem(tag: string): string | undefined {
  if (tag.startsWith('-')) return 'a tag cannot start with "-"';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what git refuses
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(tag)) return 'contains a space, a control character, or one of ~^:?*[\\';
  if (tag.includes('..')) return 'contains ".."';
  if (tag.includes('@{')) return 'contains "@{"';
  if (tag === '@') return 'cannot be "@"';
  if (tag.endsWith('.')) return 'cannot end with "."';
  if (tag.startsWith('/') || tag.endsWith('/') || tag.includes('//')) return 'has an empty "/"-separated component';
  if (tag.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock'))) {
    return 'has a "/"-separated component starting with "." or ending with ".lock"';
  }
  return undefined;
}

function tokenize(format: string, source?: string): Segment[] {
  const segments: Segment[] = [];
  const placeholderPattern = /\{(?<name>[^{}]*)\}/g;
  let lastIndex = 0;
  for (const match of format.matchAll(placeholderPattern)) {
    const name = match.groups?.name ?? '';
    if (!PLACEHOLDERS.includes(name as Placeholder)) {
      throw new VersionTagFormatError(
        format,
        `unknown placeholder "{${name}}"; use {MAJOR}, {MINOR}, {PATCH}, and {BUILD}`,
        source,
      );
    }
    if (match.index > lastIndex) {
      segments.push({ kind: 'literal', text: format.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'placeholder', name: name as Placeholder });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < format.length) {
    segments.push({ kind: 'literal', text: format.slice(lastIndex) });
  }
  return segments;
}

function validate(format: string, segments: Segment[], source?: string): void {
  if (segments.some((segment) => segment.kind === 'literal' && /[{}]/.test(segment.text))) {
    throw new VersionTagFormatError(format, 'contains an unmatched "{" or "}"', source);
  }
  for (const name of PLACEHOLDERS) {
    const count = segments.filter((segment) => segment.kind === 'placeholder' && segment.name === name).length;
    if (count !== 1) {
      throw new VersionTagFormatError(format, `{${name}} must appear exactly once, found ${count}`, source);
    }
  }
  segments.forEach((segment, index) => {
    const next = segments[index + 1];
    if (segment.kind === 'placeholder' && next?.kind === 'placeholder') {
      throw new VersionTagFormatError(
        format,
        `{${segment.name}}{${next.name}} must be separated by a non-digit`,
        source,
      );
    }
    const following = segments[index + 2];
    if (
      segment.kind === 'placeholder' &&
      next?.kind === 'literal' &&
      following?.kind === 'placeholder' &&
      /^\d+$/.test(next.text)
    ) {
      throw new VersionTagFormatError(
        format,
        `{${segment.name}} and {${following.name}} must be separated by a non-digit`,
        source,
      );
    }
  });

  const problem = findRefNameProblem(renderSegments(segments, { major: '1', minor: '2', patch: '3', build: '4' }));
  if (problem) {
    throw new VersionTagFormatError(format, `the tags it produces aren't valid git tag names: ${problem}`, source);
  }
}

function renderSegments(segments: Segment[], values: Partial<VersionParts>, missing = ''): string {
  return segments
    .map((segment) =>
      segment.kind === 'literal' ? segment.text : (values[segment.name.toLowerCase() as keyof VersionParts] ?? missing),
    )
    .join('');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A validated version tag format. Every command that writes or reads a package version's git tag
 * goes through one of these, so they agree on the tag's shape.
 */
export class VersionTagFormat {
  private readonly segments: Segment[];
  private readonly tagPattern: RegExp;

  private constructor(
    public readonly format: string,
    source?: string,
  ) {
    this.segments = tokenize(format, source);
    validate(format, this.segments, source);
    const versionPattern = this.segments
      .map((segment) =>
        segment.kind === 'literal' ? escapeRegExp(segment.text) : `(?<${segment.name.toLowerCase()}>\\d+)`,
      )
      .join('');
    this.tagPattern = new RegExp(`^(?<versionTag>${versionPattern})(?:-(?<rest>.*))?$`);
  }

  /** @throws {VersionTagFormatError} If the format can't produce distinct, parseable, legal tags. */
  public static parse(format: string): VersionTagFormat {
    return new VersionTagFormat(format);
  }

  /**
   * The format in `SIMPLY_CICD_VERSION_TAG_FORMAT` when it's set, otherwise the one declared under
   * `plugins.simply.versionTagFormat`, otherwise the default.
   *
   * @throws {VersionTagFormatError} If the chosen format is invalid.
   */
  public static fromProject(project: SfdxProject | undefined): VersionTagFormat {
    const override = process.env[VERSION_TAG_FORMAT_ENV_VAR];
    if (override) {
      return new VersionTagFormat(override, VERSION_TAG_FORMAT_ENV_VAR);
    }
    const declared = project ? getPluginConfig<unknown>(project, VERSION_TAG_FORMAT_CONFIG_PATH) : undefined;
    if (declared === undefined || declared === null || declared === '') {
      return new VersionTagFormat(DEFAULT_VERSION_TAG_FORMAT);
    }
    if (typeof declared !== 'string') {
      throw new VersionTagFormatError(JSON.stringify(declared), 'must be a string');
    }
    return new VersionTagFormat(declared);
  }

  /**
   * The tag for `salesforceVersion` (`major.minor.patch.build`), with `-<suffix>` appended when given.
   *
   * @throws {Error} If the version isn't four numeric parts.
   */
  public render(salesforceVersion: string, suffix?: string): string {
    const match = SALESFORCE_VERSION_PATTERN.exec(salesforceVersion.trim());
    if (!match?.groups) {
      throw new Error(
        `Cannot render a version tag for Salesforce package version "${salesforceVersion}": expected major.minor.patch.build.`,
      );
    }
    const versionTag = renderSegments(this.segments, match.groups);
    return suffix ? `${versionTag}-${suffix}` : versionTag;
  }

  /**
   * A `git describe --match` / `git tag --list` glob for tags of the `major.minor.patch` that
   * `versionNumber` (e.g. `6.40.0.NEXT`) declares, with any build and suffix. Without a usable
   * `versionNumber`, any tag starting the way the format starts.
   */
  public matchPattern(versionNumber?: string): string {
    const parts = versionNumber?.split('.') ?? [];
    if (parts.length >= 3) {
      const glob = renderSegments(this.segments, { major: parts[0], minor: parts[1], patch: parts[2] }, '*');
      return glob.endsWith('*') ? glob : `${glob}*`;
    }
    const first = this.segments[0];
    return `${first.kind === 'literal' ? first.text : ''}*`;
  }

  /** Splits a tag this format rendered back into its version and suffix; `undefined` if it doesn't match. */
  public parseTag(tag: string): ParsedVersionTag | undefined {
    const groups = this.tagPattern.exec(tag)?.groups;
    if (!groups) return undefined;
    return {
      versionTag: groups.versionTag,
      version: { major: groups.major, minor: groups.minor, patch: groups.patch, build: groups.build },
      rest: groups.rest ?? '',
    };
  }
}
