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

/* eslint-disable no-await-in-loop -- repositories are visited strictly one at a time, breadth-first, so the order (and so which ref wins a conflict) is deterministic */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SfError } from '@salesforce/core';
import { getPluginConfig, readSfdxProject, type SfdxProject } from '@simplysf/simply-core';
import {
  isIgnoredDependency,
  resolveDependencyRepository,
  type ResolvedDependencyRepository,
} from './dependencyRepositoryResolver.js';
import {
  readDependencyRepositories,
  type DependencyRepositories,
} from './schemas/sfdx-project/dependencyRepositories.js';

/** The outcome recorded for one dependency. */
export type DependencyCloneStatus =
  | 'Cloned'
  | 'Updated'
  | 'Already cloned'
  | 'Dirty, skipped'
  | 'On other branch, skipped'
  | 'No repository'
  | 'Ignored'
  | 'Failed'
  | 'Would clone';

/** One dependency's row in the result. */
export type DependencyCloneResult = {
  /** The dependency's `package` value as written in the declaring project. */
  package: string;
  /** The `plugins.simply.dependencies.repositories` key that matched, if any. */
  key?: string;
  url?: string;
  ref?: string;
  status: DependencyCloneStatus;
  /** The package (or package directory path) that declared this dependency. */
  via: string;
  /** Absolute path of the clone, for rows that have one. */
  directory?: string;
  /** Detail for the status: the git error for `Failed`, the branch for `On other branch, skipped`, and so on. */
  message?: string;
};

/**
 * Runs one `git` command and resolves with its trimmed stdout, or rejects with an `Error` whose
 * message is git's stderr. Injected so tests can run without git or a network.
 */
export type GitRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;

/** Callbacks the clone run reports its progress through. Every member is optional. */
export type ClonePackageDependenciesProgress = {
  info?: (message: string) => void;
  /** A ref conflict, a folder-name collision, a shallow-clone fallback, or an unreadable nested project. */
  warn?: (message: string) => void;
  stepStart?: (message: string) => void;
  stepStop?: (message?: string) => void;
};

export type ClonePackageDependenciesOptions = {
  /** The directory holding the root project's `sfdx-project.json`. */
  projectDir: string;
  /** Where clones go, relative to `projectDir` (or absolute). Default: `..`, next to the project. */
  outputDir?: string;
  /** Also clone the dependencies of each dependency. Default: `false`. */
  recursive?: boolean;
  /** Passed to `git clone --depth`. Default: full history. */
  depth?: number;
  /** Fetch and re-check-out repositories that are already cloned. Default: `false`. */
  update?: boolean;
  /** Plan only; run no git commands. Default: `false`. */
  dryRun?: boolean;
  /** Default: runs the `git` on `PATH`. */
  git?: GitRunner;
  progress?: ClonePackageDependenciesProgress;
};

/** A project waiting to have its dependencies visited. */
type QueuedProject = {
  dir: string;
  project: SfdxProject;
  repositories: DependencyRepositories;
};

/** A repository already handled in this run, by normalized URL. */
type VisitedRepository = { ref?: string; via: string; directory: string };

/** Looks like a commit SHA rather than a branch or tag name. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Settings applied to every git command. `ext::` URLs run arbitrary commands, and with
 * `--recursive` the URLs come from other people's project files, so that transport is refused
 * outright rather than left to the user's git config.
 */
const GIT_SAFETY_ARGS = ['-c', 'protocol.ext.allow=never'];

/**
 * The default {@link GitRunner}: `git` on `PATH`, run without a shell. `GIT_TERMINAL_PROMPT=0`
 * makes a missing credential fail fast instead of waiting for input nobody can see.
 */
export const defaultGitRunner: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...GIT_SAFETY_ARGS, ...args],
      { cwd: options?.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });

/**
 * Reduce a git URL to `host/path` so that the same repository compares equal however it's
 * written: `https://` or `ssh://`, scp-like `git@host:path`, with or without `.git` or a trailing
 * `/`. The host is lowercased, and the scheme, user, and port are dropped. A local path resolves
 * against `baseDir`.
 *
 * @param url - The repository URL.
 * @param baseDir - The directory a relative local path is relative to.
 * @returns The comparison key.
 */
export function normalizeRepositoryUrl(url: string, baseDir: string): string {
  const trimSuffix = (value: string): string => value.replace(/\/+$/, '').replace(/\.git$/i, '');

  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(url);
  if (scp && !/^[a-z]:[\\/]/i.test(url)) {
    return `${scp[1].toLowerCase()}/${trimSuffix(scp[2].replace(/^\/+/, ''))}`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return trimSuffix(path.resolve(decodeURIComponent(parsed.pathname)));
    return `${parsed.hostname.toLowerCase()}/${trimSuffix(decodeURIComponent(parsed.pathname).replace(/^\/+/, ''))}`;
  } catch {
    return trimSuffix(path.resolve(baseDir, url));
  }
}

/** @returns `value` reduced to characters that are safe in a folder name, or `''` if nothing is left. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
  return cleaned === '' || /^\.+$/.test(cleaned) ? '' : cleaned;
}

/**
 * Folder names for a repository, most preferred first: its own name, then prefixed with its group
 * or owner. Both come from the normalized URL, and are sanitized because a URL from a dependency's
 * project file is third-party input.
 *
 * @param normalizedUrl - From {@link normalizeRepositoryUrl}.
 * @returns `[name, group-name]`.
 */
function folderNames(normalizedUrl: string): [string, string] {
  const segments = normalizedUrl.split(/[\\/]/).filter(Boolean);
  const name = safeSegment(segments.at(-1) ?? '') || 'repository';
  const group = safeSegment(segments.at(-2) ?? '');
  return [name, group ? `${group}-${name}` : `${name}-2`];
}

/** @returns The dependencies every package directory of `project` declares, with the directory's name. */
function dependenciesOf(project: SfdxProject): Array<{ packageRef: string; via: string }> {
  return project.packageDirectories.flatMap((directory) =>
    (directory.dependencies ?? [])
      .filter((dependency) => typeof dependency.package === 'string' && dependency.package !== '')
      .map((dependency) => ({ packageRef: dependency.package!, via: directory.package ?? directory.path ?? '?' })),
  );
}

/** One run's settings and state, shared by the helpers below. */
type CloneRun = {
  git: GitRunner;
  progress: ClonePackageDependenciesProgress;
  options: ClonePackageDependenciesOptions;
  outputDir: string;
  rootProject: SfdxProject;
  rootRepositories: DependencyRepositories;
  results: DependencyCloneResult[];
  /** Repositories handled so far, by normalized URL. */
  visited: Map<string, VisitedRepository>;
  /** Folder names taken so far in this run. */
  usedFolders: Set<string>;
  /** Packages already given a `No repository` or `Ignored` row. */
  reportedPackages: Set<string>;
  queue: QueuedProject[];
};

/**
 * Clone the source repositories of a project's package dependencies, as mapped in
 * `plugins.simply.dependencies.repositories`. See docs/design/0047-package-dependencies-clone.md.
 *
 * Repositories are deduplicated by URL. A repository reached at two refs is cloned once, at the
 * ref found first (nearest the root), with a warning. Two different repositories with the same
 * name get the group-prefixed folder name. One failed clone doesn't stop the run; it's reported
 * as a `Failed` row.
 *
 * @param options - See {@link ClonePackageDependenciesOptions}.
 * @returns One row per dependency, in the order visited.
 * @throws {SfError} `GitNotFoundError` if git can't be run (not checked with `dryRun`);
 * `InvalidRepositoryConfigError` or `CredentialsInUrlError` for a bad entry in the root project.
 */
export async function clonePackageDependencies(
  options: ClonePackageDependenciesOptions,
): Promise<DependencyCloneResult[]> {
  const git = options.git ?? defaultGitRunner;
  const rootProject = await readSfdxProject(options.projectDir);
  const rootRepositories = readDependencyRepositories(rootProject, path.join(options.projectDir, 'sfdx-project.json'));

  if (!options.dryRun) {
    try {
      await git(['--version']);
    } catch (error) {
      throw new SfError(
        `git could not be run. Install git and make sure it's on your PATH. (${(error as Error).message})`,
        'GitNotFoundError',
      );
    }
  }

  const run: CloneRun = {
    git,
    progress: options.progress ?? {},
    options,
    outputDir: path.resolve(options.projectDir, options.outputDir ?? '..'),
    rootProject,
    rootRepositories,
    results: [],
    visited: new Map(),
    usedFolders: new Set(),
    reportedPackages: new Set(),
    queue: [{ dir: options.projectDir, project: rootProject, repositories: rootRepositories }],
  };

  while (run.queue.length > 0) {
    const current = run.queue.shift()!;
    for (const dependency of dependenciesOf(current.project)) {
      await visitDependency(run, current, dependency.packageRef, dependency.via);
    }
  }
  return run.results;
}

/** Handle one declared dependency: report it, or clone and (with `recursive`) queue its project. */
async function visitDependency(run: CloneRun, current: QueuedProject, packageRef: string, via: string): Promise<void> {
  const aliases = current.project.packageAliases ?? {};

  if (isIgnoredDependency(packageRef, ignoreListFor(run, current.project), aliases)) {
    reportOnce(run, { package: packageRef, status: 'Ignored', via });
    return;
  }

  const resolved = resolveFor(run, current, packageRef);
  if (!resolved) {
    reportOnce(run, { package: packageRef, status: 'No repository', via });
    return;
  }

  const { key, repository } = resolved;
  const normalizedUrl = normalizeRepositoryUrl(repository.url, current.dir);
  const previous = run.visited.get(normalizedUrl);
  if (previous) {
    warnOnRefConflict(run, key, repository.ref, via, previous);
    return;
  }

  const directory = path.join(run.outputDir, chooseFolder(run, normalizedUrl, key));
  run.visited.set(normalizedUrl, { ref: repository.ref, via, directory });

  const row: DependencyCloneResult = {
    package: packageRef,
    key,
    url: repository.url,
    ref: repository.ref,
    status: 'Failed',
    via,
    directory,
  };
  run.results.push(row);

  run.progress.stepStart?.(`${key}: ${repository.url}${repository.ref ? ` @ ${repository.ref}` : ''}`);
  try {
    Object.assign(
      row,
      await syncRepository(run, {
        directory,
        cloneUrl: localUrlFrom(repository.url, current.dir),
        normalizedUrl,
        ref: repository.ref,
        key,
      }),
    );
  } catch (error) {
    row.status = 'Failed';
    row.message = (error as Error).message;
  }
  run.progress.stepStop?.(row.message ? `${row.status}: ${row.message}` : row.status);

  if (run.options.recursive && row.status !== 'Failed' && fs.existsSync(directory)) {
    const nested = await readNestedProject(path.join(directory, repository.path ?? ''), key, run.progress);
    if (nested) run.queue.push(nested);
  }
}

/**
 * @returns The repository entry for a dependency. The declaring project's own map comes first; the
 * root's map fills in for dependencies that don't map their own dependencies.
 */
function resolveFor(
  run: CloneRun,
  current: QueuedProject,
  packageRef: string,
): ResolvedDependencyRepository | undefined {
  const own = resolveDependencyRepository(packageRef, current.repositories, current.project.packageAliases ?? {});
  if (own || current.project === run.rootProject) return own;
  return resolveDependencyRepository(packageRef, run.rootRepositories);
}

/** Warn when a repository already chosen at one ref is wanted at another. The first ref stays. */
function warnOnRefConflict(
  run: CloneRun,
  key: string,
  ref: string | undefined,
  via: string,
  previous: VisitedRepository,
): void {
  if ((previous.ref ?? '') === (ref ?? '')) return;
  const describe = (value?: string): string => value ?? 'its default branch';
  run.progress.warn?.(
    `${key} is wanted at ${describe(ref)} by ${via}, but was already chosen at ` +
      `${describe(previous.ref)} for ${previous.via}. Keeping ${describe(previous.ref)}.`,
  );
}

/** @returns The root project's ignore list, plus `project`'s own when it's a dependency. */
function ignoreListFor(run: CloneRun, project: SfdxProject): string[] {
  const read = (source: SfdxProject): string[] =>
    getPluginConfig<string[]>(source, 'plugins.simply.dependencies.ignore') ?? [];
  return project === run.rootProject ? read(project) : [...read(run.rootProject), ...read(project)];
}

/** Add a `No repository` or `Ignored` row, unless this package already has one. */
function reportOnce(run: CloneRun, row: DependencyCloneResult): void {
  if (run.reportedPackages.has(row.package)) return;
  run.reportedPackages.add(row.package);
  run.results.push(row);
}

/** @returns `url` made absolute when it's a relative local path, which is relative to the declaring project. */
function localUrlFrom(url: string, projectDir: string): string {
  return /^\.{1,2}[\\/]/.test(url) ? path.resolve(projectDir, url) : url;
}

/** @returns A folder name for a repository not yet seen in this run, warning when it isn't the plain name. */
function chooseFolder(run: CloneRun, normalizedUrl: string, key: string): string {
  const [name, prefixed] = folderNames(normalizedUrl);
  let candidate = name;
  for (let n = 1; run.usedFolders.has(candidate); n++) {
    candidate = n === 1 ? prefixed : `${prefixed}~${n}`;
  }
  if (candidate !== name) {
    run.progress.warn?.(`Another repository already uses the folder "${name}", so ${key} goes to "${candidate}".`);
  }
  run.usedFolders.add(candidate);
  return candidate;
}

/** What {@link syncRepository} needs to know about one repository. */
type SyncRequest = {
  directory: string;
  cloneUrl: string;
  normalizedUrl: string;
  ref?: string;
  key: string;
};

/**
 * Clone one repository, or check and optionally update an existing clone of it.
 *
 * @returns The row's status, and a message where there's something to say.
 * @throws {Error} With git's message, when a git command fails.
 */
async function syncRepository(
  run: CloneRun,
  request: SyncRequest,
): Promise<Pick<DependencyCloneResult, 'status' | 'message'>> {
  const { dryRun, update } = run.options;
  const { directory, cloneUrl, normalizedUrl } = request;

  if (!fs.existsSync(directory)) {
    if (dryRun) return { status: 'Would clone' };
    await cloneRepository(run, request);
    return { status: 'Cloned' };
  }

  if (dryRun) return { status: 'Already cloned', message: 'folder exists; not verified with --dry-run' };

  let remote: string;
  try {
    remote = await run.git(['remote', 'get-url', 'origin'], { cwd: directory });
  } catch {
    return { status: 'Failed', message: `${directory} exists and is not a clone of ${cloneUrl}` };
  }
  if (normalizeRepositoryUrl(remote, directory) !== normalizedUrl) {
    return { status: 'Failed', message: `${directory} exists and is a clone of ${remote}, not ${cloneUrl}` };
  }

  return update ? updateClone(run, request) : { status: 'Already cloned' };
}

/** `git clone` one repository at its ref. A commit SHA can't be cloned shallowly, so it gets full history. */
async function cloneRepository(run: CloneRun, { directory, cloneUrl, ref, key }: SyncRequest): Promise<void> {
  const isSha = ref !== undefined && SHA_PATTERN.test(ref);
  const args = ['clone'];
  if (run.options.depth !== undefined) {
    if (isSha) {
      run.progress.warn?.(`${key}: a shallow clone can't check out commit ${ref}, so it gets a full clone.`);
    } else {
      args.push('--depth', String(run.options.depth));
    }
  }
  if (ref && !isSha) args.push('--branch', ref);
  args.push('--', cloneUrl, directory);

  await run.git(args);
  if (isSha) await run.git(['checkout', '--detach', ref], { cwd: directory });
}

/**
 * Bring an existing, clean clone to its ref: fast-forward when it's on that branch, or check the
 * ref out when HEAD is detached. A clone on some other branch may be the developer's own working
 * copy, so it's left alone.
 */
async function updateClone(
  run: CloneRun,
  { directory, ref }: SyncRequest,
): Promise<Pick<DependencyCloneResult, 'status' | 'message'>> {
  const git = run.git;
  if ((await git(['status', '--porcelain'], { cwd: directory })) !== '') {
    return { status: 'Dirty, skipped', message: 'uncommitted changes' };
  }

  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: directory }).catch(() => '');
  const wanted = ref ?? (await defaultBranch(git, directory));
  if (branch !== '' && wanted !== undefined && branch !== wanted) {
    return { status: 'On other branch, skipped', message: `on ${branch}, not ${wanted}` };
  }

  await git(['fetch', '--tags', 'origin'], { cwd: directory });
  if (branch !== '') {
    await git(['merge', '--ff-only', '@{upstream}'], { cwd: directory });
  } else if (wanted !== undefined) {
    await git(['checkout', SHA_PATTERN.test(wanted) ? '--detach' : '--quiet', wanted], { cwd: directory });
  }
  return { status: 'Updated' };
}

/** @returns The remote's default branch name as the clone knows it, or `undefined` if it doesn't. */
async function defaultBranch(git: GitRunner, directory: string): Promise<string | undefined> {
  try {
    const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: directory });
    return head.replace(/^origin\//, '');
  } catch {
    return undefined;
  }
}

/**
 * Read a clone's `sfdx-project.json` for recursion. A missing file makes the clone a leaf. An
 * unreadable or invalid one is a warning, not an error, because it's someone else's file.
 *
 * @returns The project to queue, or `undefined` if there's nothing to follow.
 */
async function readNestedProject(
  dir: string,
  key: string,
  progress: ClonePackageDependenciesProgress,
): Promise<QueuedProject | undefined> {
  try {
    const project = await readSfdxProject(dir);
    return { dir, project, repositories: readDependencyRepositories(project, `${key}'s sfdx-project.json`) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    progress.warn?.(`Not following ${key}'s dependencies: ${(error as Error).message}`);
    return undefined;
  }
}
