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

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ALM_PROVIDER_KINDS, VCS_PROVIDER_KINDS, type AlmProviderKind, type VcsProviderKind } from './providerKinds.js';

/** The project-local config file shared by the SimplySF plugins. */
export const SFDEVRC_FILENAME = '.sfdevrc.json';

/** The extensionless name older tooling used. Read only when {@link SFDEVRC_FILENAME} is absent. */
export const LEGACY_SFDEVRC_FILENAME = '.sfdevrc';

const vcsSectionSchema = z.object({
  provider: z.enum(VCS_PROVIDER_KINDS).optional(),
  host: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

const almSectionSchema = z.object({
  provider: z.enum(ALM_PROVIDER_KINDS).optional(),
  projectKeys: z.array(z.string()).optional(),
  baseUrl: z.string().min(1).optional(),
});

const branchRegexSchema = z.string().refine(
  (value) => {
    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Not a valid regular expression' },
);

/**
 * The base `.sfdevrc.json` schema: the platform-agnostic fields every SimplySF consumer shares.
 * Unknown top-level keys pass through, so one plugin's section never fails another plugin's
 * validation. A consumer adds its own section(s) with `sfDevRcSchema.extend({ ... })`.
 */
export const sfDevRcSchema = z.looseObject({
  vcs: vcsSectionSchema.optional(),
  alm: almSectionSchema.optional(),
  branchRegex: branchRegexSchema.optional(),
});

/** The parsed base file. Consumer sections not in the base schema are present but typed `unknown`. */
export type SfDevRc = z.infer<typeof sfDevRcSchema>;

/**
 * The plugin-neutral environment variables that override `.sfdevrc.json`'s base fields. An empty
 * value counts as unset. `SIMPLY_ALM_PROJECT_KEYS` is comma-separated.
 */
export const SFDEVRC_ENV_VARS = {
  vcsProvider: 'SIMPLY_VCS_PROVIDER',
  vcsHost: 'SIMPLY_VCS_HOST',
  vcsProjectId: 'SIMPLY_VCS_PROJECT_ID',
  almProvider: 'SIMPLY_ALM_PROVIDER',
  almProjectKeys: 'SIMPLY_ALM_PROJECT_KEYS',
  almBaseUrl: 'SIMPLY_ALM_BASE_URL',
  branchRegex: 'SIMPLY_BRANCH_REGEX',
} as const;

/** The config field path each environment variable sets, for error messages. */
const ENV_VAR_BY_FIELD_PATH: Record<string, string> = {
  'vcs.provider': SFDEVRC_ENV_VARS.vcsProvider,
  'vcs.host': SFDEVRC_ENV_VARS.vcsHost,
  'vcs.projectId': SFDEVRC_ENV_VARS.vcsProjectId,
  'alm.provider': SFDEVRC_ENV_VARS.almProvider,
  'alm.projectKeys': SFDEVRC_ENV_VARS.almProjectKeys,
  'alm.baseUrl': SFDEVRC_ENV_VARS.almBaseUrl,
  branchRegex: SFDEVRC_ENV_VARS.branchRegex,
};

/**
 * Thrown when `.sfdevrc.json` exists but isn't valid JSON or doesn't match the schema, or when a
 * `SIMPLY_*` environment variable holds an invalid value (then `filePath` is `undefined`).
 */
export class SfDevRcError extends Error {
  public constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = 'SfDevRcError';
  }
}

export type LoadSfDevRcOptions<S extends z.ZodType<SfDevRc>> = {
  /** The directory to look in. Defaults to `process.cwd()`. The search does not walk up. */
  cwd?: string;
  /** The schema to validate against. Defaults to {@link sfDevRcSchema}; pass an `.extend()` of it. */
  schema?: S;
  /**
   * Receives deprecation warnings for legacy field names and the legacy file name. Defaults to
   * `process.emitWarning(message, 'DeprecationWarning')`.
   */
  warn?: (message: string) => void;
  /**
   * The environment to read {@link SFDEVRC_ENV_VARS} from. Defaults to `process.env`; pass `{}` to
   * read the file alone.
   */
  env?: Record<string, string | undefined>;
};

export type LoadSfDevRcResult<T> = {
  config: T;
  /** The absolute path that was read, or `undefined` when no file exists. */
  path?: string;
};

const defaultWarn = (message: string): void => {
  process.emitWarning(message, 'DeprecationWarning');
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Collects a single-key and multi-key legacy field pair into one list, keeping only non-empty strings. */
function collectLegacyKeys(single: unknown, multiple: unknown): string[] {
  const keys: unknown[] = [single, ...(Array.isArray(multiple) ? (multiple as unknown[]) : [])];
  return keys.filter((key): key is string => typeof key === 'string' && key.length > 0);
}

function deprecationMessage(fields: string[], replacement: string): string {
  const names = fields.map((field) => `"${field}"`).join(' and ');
  const verb = fields.length > 1 ? 'are' : 'is';
  return `The ${SFDEVRC_FILENAME} field${fields.length > 1 ? 's' : ''} ${names} ${verb} deprecated. Use ${replacement} instead; the old name${fields.length > 1 ? 's' : ''} will be removed in a future release.`;
}

/**
 * Rewrites legacy, platform-specific fields into the `vcs`/`alm` shape. A new-style section always
 * wins outright over its legacy fields — the two are never blended. Legacy keys are removed from the
 * result either way, so they can't linger as unknown pass-through keys.
 */
function normalizeLegacyFields(raw: Record<string, unknown>, warn: (message: string) => void): Record<string, unknown> {
  const config = { ...raw };

  const gitlabProjectId = nonEmptyString(config.gitlabProjectId);
  if (gitlabProjectId) {
    warn(deprecationMessage(['gitlabProjectId'], '"vcs.projectId" with "vcs.provider": "gitlab"'));
    if (config.vcs === undefined) {
      config.vcs = { provider: 'gitlab', projectId: gitlabProjectId };
    }
  }
  delete config.gitlabProjectId;

  const almKeys = collectLegacyKeys(config.almProjectKey, config.almProjectKeys);
  const jiraKeys = collectLegacyKeys(config.jiraProjectKey, config.jiraProjectKeys);
  if (almKeys.length > 0) {
    warn(deprecationMessage(['almProjectKey', 'almProjectKeys'], '"alm.projectKeys"'));
  }
  if (jiraKeys.length > 0) {
    warn(deprecationMessage(['jiraProjectKey', 'jiraProjectKeys'], '"alm.projectKeys" with "alm.provider": "jira"'));
  }
  if (config.alm === undefined) {
    // The `alm*` names were the previous migration target, so they beat the older `jira*` names.
    if (almKeys.length > 0) {
      config.alm = { projectKeys: almKeys };
    } else if (jiraKeys.length > 0) {
      config.alm = { provider: 'jira', projectKeys: jiraKeys };
    }
  }
  delete config.almProjectKey;
  delete config.almProjectKeys;
  delete config.jiraProjectKey;
  delete config.jiraProjectKeys;

  return config;
}

function formatIssues(error: z.ZodError, label: (fieldPath: string) => string = (fieldPath) => fieldPath): string {
  return error.issues
    .map((issue) => {
      const fieldPath = issue.path.map(String).join('.');
      return `  - ${fieldPath ? label(fieldPath) : '(root)'}: ${issue.message}`;
    })
    .join('\n');
}

/** Finds the config file in `cwd`: `.sfdevrc.json`, else the legacy `.sfdevrc`, else `undefined`. */
export function findSfDevRcPath(cwd: string = process.cwd()): string | undefined {
  const current = path.resolve(cwd, SFDEVRC_FILENAME);
  if (fs.existsSync(current)) {
    return current;
  }
  const legacy = path.resolve(cwd, LEGACY_SFDEVRC_FILENAME);
  return fs.existsSync(legacy) ? legacy : undefined;
}

function readEnvValue(env: Record<string, string | undefined>, name: string): string | undefined {
  // Blank and whitespace-only values count as unset, so `??` would be wrong here.
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
}

function compact(section: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(section).filter(([, value]) => value !== undefined));
}

/**
 * Reads {@link SFDEVRC_ENV_VARS} into a partial config and validates it on its own, so a bad value
 * is reported against the variable name rather than a file field.
 */
function readEnvOverrides(env: Record<string, string | undefined>): Record<string, Record<string, unknown> | string> {
  const projectKeys = readEnvValue(env, SFDEVRC_ENV_VARS.almProjectKeys)
    ?.split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const overrides: Record<string, Record<string, unknown> | string> = {};
  const vcs = compact({
    provider: readEnvValue(env, SFDEVRC_ENV_VARS.vcsProvider),
    host: readEnvValue(env, SFDEVRC_ENV_VARS.vcsHost),
    projectId: readEnvValue(env, SFDEVRC_ENV_VARS.vcsProjectId),
  });
  const alm = compact({
    provider: readEnvValue(env, SFDEVRC_ENV_VARS.almProvider),
    projectKeys,
    baseUrl: readEnvValue(env, SFDEVRC_ENV_VARS.almBaseUrl),
  });
  const branchRegex = readEnvValue(env, SFDEVRC_ENV_VARS.branchRegex);
  if (Object.keys(vcs).length > 0) {
    overrides.vcs = vcs;
  }
  if (Object.keys(alm).length > 0) {
    overrides.alm = alm;
  }
  if (branchRegex !== undefined) {
    overrides.branchRegex = branchRegex;
  }

  const parsed = sfDevRcSchema.safeParse(overrides);
  if (!parsed.success) {
    // `alm.projectKeys.0` → `SIMPLY_ALM_PROJECT_KEYS.0`
    const toEnvVar = (fieldPath: string): string => {
      const field = Object.keys(ENV_VAR_BY_FIELD_PATH).find(
        (key) => fieldPath === key || fieldPath.startsWith(`${key}.`),
      );
      return field ? `${ENV_VAR_BY_FIELD_PATH[field]}${fieldPath.slice(field.length)}` : fieldPath;
    };
    const message = formatIssues(parsed.error, toEnvVar);
    throw new SfDevRcError(`Invalid environment variable value:\n${message}`);
  }
  return overrides;
}

/**
 * Overlays an environment-sourced section onto the file's. When the environment names a different
 * provider than the file, the file's section is dropped entirely: its host, project ID, keys, or
 * base URL describe the other platform and would be wrong here.
 */
function overlaySection(fileSection: unknown, envSection: Record<string, unknown> | undefined): unknown {
  if (envSection === undefined) {
    return fileSection;
  }
  if (fileSection !== undefined && !isRecord(fileSection)) {
    return fileSection; // leave a malformed file section for the schema to report
  }
  const base = fileSection ?? {};
  const providerChanged =
    envSection.provider !== undefined && base.provider !== undefined && base.provider !== envSection.provider;
  return { ...(providerChanged ? {} : base), ...envSection };
}

function applyEnvOverrides(
  config: Record<string, unknown>,
  overrides: Record<string, Record<string, unknown> | string>,
): Record<string, unknown> {
  const merged = { ...config };
  for (const key of ['vcs', 'alm'] as const) {
    const section = overlaySection(merged[key], overrides[key] as Record<string, unknown> | undefined);
    if (section !== undefined) {
      merged[key] = section;
    }
  }
  if (overrides.branchRegex !== undefined) {
    merged.branchRegex = overrides.branchRegex;
  }
  return merged;
}

/** Reads and parses the file, or returns `{}` when there is none. */
function readRawFile(filePath: string | undefined, warn: (message: string) => void): Record<string, unknown> {
  if (!filePath) {
    return {};
  }
  if (path.basename(filePath) === LEGACY_SFDEVRC_FILENAME) {
    warn(
      `Reading ${LEGACY_SFDEVRC_FILENAME}, which is deprecated. Rename it to ${SFDEVRC_FILENAME}; the old name will stop being read in a future release.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new SfDevRcError(
      `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }
  if (!isRecord(raw)) {
    throw new SfDevRcError(`${filePath} must contain a JSON object at the top level.`, filePath);
  }
  return normalizeLegacyFields(raw, warn);
}

/**
 * Reads `.sfdevrc.json` (or the legacy `.sfdevrc`) from `cwd`, rewrites legacy fields into the
 * platform-agnostic shape, overlays any {@link SFDEVRC_ENV_VARS} from `env`, and validates the
 * result. Environment values beat the file; flags are applied afterwards by the `resolve*` helpers.
 *
 * With no file and no variables set, returns `{ config: {} }`. Unparseable JSON, a non-object root,
 * a schema failure, or an invalid variable value throws {@link SfDevRcError} naming the file or
 * variable and each offending field.
 */
export function loadSfDevRc<S extends z.ZodType<SfDevRc> = typeof sfDevRcSchema>(
  options: LoadSfDevRcOptions<S> = {},
): LoadSfDevRcResult<z.infer<S>> {
  const {
    cwd = process.cwd(),
    schema = sfDevRcSchema as unknown as S,
    warn = defaultWarn,
    env = process.env,
  } = options;

  const filePath = findSfDevRcPath(cwd);
  const merged = applyEnvOverrides(readRawFile(filePath, warn), readEnvOverrides(env));

  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    throw new SfDevRcError(`${filePath ?? SFDEVRC_FILENAME} is invalid:\n${formatIssues(parsed.error)}`, filePath);
  }
  return filePath ? { config: parsed.data, path: filePath } : { config: parsed.data };
}

/**
 * Picks the VCS platform. Precedence: `explicit` (a flag) > `vcs.provider` (from
 * `SIMPLY_VCS_PROVIDER` or the file, as merged by {@link loadSfDevRc}) > `fallback`.
 */
export function resolveVcsProviderKind(
  config: SfDevRc,
  explicit?: VcsProviderKind,
  fallback: VcsProviderKind = 'gitlab',
): VcsProviderKind {
  return explicit ?? config.vcs?.provider ?? fallback;
}

/**
 * Picks the issue tracker. Precedence: `explicit` (a flag) > `alm.provider` (from
 * `SIMPLY_ALM_PROVIDER` or the file, as merged by {@link loadSfDevRc}) > `fallback`.
 */
export function resolveAlmProviderKind(
  config: SfDevRc,
  explicit?: AlmProviderKind,
  fallback: AlmProviderKind = 'jira',
): AlmProviderKind {
  return explicit ?? config.alm?.provider ?? fallback;
}

/** The non-secret settings needed to build a VCS provider; the caller supplies the token. */
export type ResolvedVcsSettings = {
  kind: VcsProviderKind;
  host?: string;
  projectId?: string;
};

/**
 * Resolves the VCS platform plus its `host` and `projectId`, each with explicit (flag) values
 * beating the loaded config (environment, then file). The config's `host`/`projectId` are only used
 * when the resolved platform is the one the config describes (or it names none) — so
 * `--vcs-provider github` never picks up a GitLab host.
 */
export function resolveVcsSettings(
  config: SfDevRc,
  explicit: { provider?: VcsProviderKind; host?: string; projectId?: string } = {},
  fallback: VcsProviderKind = 'gitlab',
): ResolvedVcsSettings {
  const kind = resolveVcsProviderKind(config, explicit.provider, fallback);
  const fileApplies = config.vcs !== undefined && (config.vcs.provider === undefined || config.vcs.provider === kind);
  return {
    kind,
    host: explicit.host ?? (fileApplies ? config.vcs?.host : undefined),
    projectId: explicit.projectId ?? (fileApplies ? config.vcs?.projectId : undefined),
  };
}

function dedupeKeys(keys: Array<string | undefined>): string[] {
  return [...new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0))];
}

/**
 * Resolves the issue-tracker project keys. Precedence: `explicit` (a flag) > `alm.projectKeys`
 * (from `SIMPLY_ALM_PROJECT_KEYS` or the file, as merged by {@link loadSfDevRc}) > none.
 * Deduplicated, with empty values dropped. Sources are never merged.
 */
export function resolveAlmProjectKeys(config: SfDevRc, explicit?: string | string[]): string[] {
  const explicitKeys = dedupeKeys(Array.isArray(explicit) ? explicit : [explicit]);
  return explicitKeys.length > 0 ? explicitKeys : dedupeKeys(config.alm?.projectKeys ?? []);
}
