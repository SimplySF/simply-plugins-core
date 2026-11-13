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

/** Where a happy-soup repository's release settings live, relative to a directory being searched. */
export const RELEASE_CONFIG_FILENAMES = [path.join('config', 'release.json'), 'release.json'] as const;

export const DEFAULT_PRODUCTION_BRANCH = 'environment/production';
export const DEFAULT_DEPLOYMENT_STEPS_TEMPLATE = 'xdocs/deployment-steps-template.md';
export const DEFAULT_DEPLOYMENT_CONFIGS_TEMPLATE = 'xdocs/deployment-configs-template.json';

/** An application a staging branch can be for. */
export type ReleaseApplication = {
  name: string;
  /** Shown in prompts instead of `name`. */
  label?: string;
  /** Shown beside the application in prompts. */
  description?: string;
};

/** A team, and the applications it stages branches for. */
export type ReleaseTeam = {
  name: string;
  label?: string;
  applications: ReleaseApplication[];
};

/** `config/release.json`, with defaults applied and every accepted shape normalized. */
export type HappySoupReleaseConfig = {
  teams: ReleaseTeam[];
  /** Offered when the chosen team declares no applications of its own. */
  applications: ReleaseApplication[];
  productionBranch: string;
  deploymentStepsTemplate: string;
  deploymentConfigsTemplate: string;
};

const applicationObjectSchema = z.looseObject({
  name: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
});

/** `"core"`, `{ "name": "core", ... }`, or `{ "core": { "label": ... } }`. */
const applicationsSchema = z
  .union([
    z.array(z.union([z.string().min(1), applicationObjectSchema])),
    z.record(z.string(), z.looseObject({ label: z.string().optional(), description: z.string().optional() })),
  ])
  .transform((value): ReleaseApplication[] =>
    Array.isArray(value)
      ? value.map((entry) => (typeof entry === 'string' ? { name: entry } : toApplication(entry)))
      : Object.entries(value).map(([name, entry]) => toApplication({ ...entry, name })),
  );

const teamObjectSchema = z.looseObject({
  name: z.string().min(1),
  label: z.string().optional(),
  applications: applicationsSchema.optional(),
});

/**
 * `"platform"`, `{ "name": "platform", "applications": [...] }`, `{ "platform": { "applications": [...] } }`,
 * or `{ "platform": ["core", "portal"] }`.
 */
const teamsSchema = z
  .union([
    z.array(z.union([z.string().min(1), teamObjectSchema])),
    z.record(
      z.string(),
      // The team object is tried first, as the original script did: its fields are all optional, so
      // an object value is always a team, and only an array value is a bare list of applications.
      z.union([
        z.looseObject({ label: z.string().optional(), applications: applicationsSchema.optional() }),
        z.array(z.union([z.string().min(1), applicationObjectSchema])),
      ]),
    ),
  ])
  .transform((value): ReleaseTeam[] => {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        typeof entry === 'string'
          ? { name: entry, applications: [] }
          : { name: entry.name, label: entry.label, applications: entry.applications ?? [] },
      );
    }
    return Object.entries(value).map(([name, entry]) =>
      Array.isArray(entry)
        ? {
            name,
            applications: entry.map((app) => (typeof app === 'string' ? { name: app } : toApplication(app))),
          }
        : { name, label: entry.label, applications: entry.applications ?? [] },
    );
  });

const releaseConfigSchema = z.looseObject({
  $schema: z.string().optional(),
  teams: teamsSchema.optional(),
  applications: applicationsSchema.optional(),
  productionBranch: z.string().min(1).optional(),
  deploymentStepsTemplate: z.string().min(1).optional(),
  deploymentConfigsTemplate: z.string().min(1).optional(),
});

function toApplication(entry: { name: string; label?: string; description?: string }): ReleaseApplication {
  return {
    name: entry.name,
    ...(entry.label === undefined ? {} : { label: entry.label }),
    ...(entry.description === undefined ? {} : { description: entry.description }),
  };
}

/**
 * Finds the release configuration: `explicitPath` if given, else `config/release.json` or
 * `release.json` in `cwd` or a parent, stopping at `stopAt` (usually the repository root).
 *
 * @returns The absolute path, or `undefined` when no file exists.
 * @throws {Error} If `explicitPath` doesn't exist.
 */
export function findReleaseConfigFile(cwd: string, explicitPath?: string, stopAt?: string): string | undefined {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Release configuration file not found: ${resolved}`);
    }
    return resolved;
  }

  const boundary = stopAt ? path.resolve(stopAt) : undefined;
  let current = path.resolve(cwd);
  for (;;) {
    for (const filename of RELEASE_CONFIG_FILENAMES) {
      const candidate = path.join(current, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (current === boundary || parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Validates and normalizes a parsed release configuration, applying defaults.
 *
 * @param raw - The parsed JSON.
 * @param source - The file it came from, named in errors.
 * @throws {Error} Naming every invalid field.
 */
export function parseReleaseConfig(raw: unknown, source = 'release configuration'): HappySoupReleaseConfig {
  const parsed = releaseConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${source} is invalid:\n${issues}`);
  }
  const config = parsed.data;
  return {
    teams: config.teams ?? [],
    applications: config.applications ?? [],
    productionBranch: config.productionBranch ?? DEFAULT_PRODUCTION_BRANCH,
    deploymentStepsTemplate: config.deploymentStepsTemplate ?? DEFAULT_DEPLOYMENT_STEPS_TEMPLATE,
    deploymentConfigsTemplate: config.deploymentConfigsTemplate ?? DEFAULT_DEPLOYMENT_CONFIGS_TEMPLATE,
  };
}

export type LoadReleaseConfigOptions = {
  /** Where to start searching. Defaults to `process.cwd()`. */
  cwd?: string;
  /** An explicit file, usually `--config`. */
  configPath?: string;
  /** Don't search above this directory, usually the repository root. */
  stopAt?: string;
};

/**
 * Loads `config/release.json` (see {@link findReleaseConfigFile}). With no file, every field takes
 * its default.
 *
 * @returns The configuration, and the path it was read from, if any.
 * @throws {Error} If the file can't be read, isn't JSON, or is invalid.
 */
export function loadReleaseConfig(options: LoadReleaseConfigOptions = {}): {
  config: HappySoupReleaseConfig;
  path?: string;
} {
  const filePath = findReleaseConfigFile(options.cwd ?? process.cwd(), options.configPath, options.stopAt);
  if (!filePath) {
    return { config: parseReleaseConfig({}) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return { config: parseReleaseConfig(raw, filePath), path: filePath };
}

/**
 * @returns The configured team whose name matches `name`, ignoring case.
 */
export function findReleaseTeam(config: HappySoupReleaseConfig, name: string): ReleaseTeam | undefined {
  const lower = name.toLowerCase();
  return config.teams.find((team) => team.name.toLowerCase() === lower);
}

/**
 * @returns The applications to offer for `team`: its own, or the top-level list when it declares none.
 */
export function applicationsForTeam(config: HappySoupReleaseConfig, team?: ReleaseTeam): ReleaseApplication[] {
  return team && team.applications.length > 0 ? team.applications : config.applications;
}
