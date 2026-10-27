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
  type DependencyRepository,
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
  /** The `plugins.simply.packages` key that matched, if any. */
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
  /** The key of the dependency this project was cloned for. `undefined` for the root project. */
  key?: string;
};

/** A repository already handled in this run, by normalized URL. */
type VisitedRepository = {
  ref?: string;
  via: string;
  directory: string;
  /** The first row for this repository. `undefined` for the root project's own repository. */
  row?: DependencyCloneResult;
  /** The keys that already have a row for this repository. */
  keys: Set<string>;
  /** The `path`s inside this repository already followed with `recursive`. */
  paths: Set<string>;
};

/**
 * Could be a commit SHA. A branch or tag can look like one too (`cafe123`, `20260101`), so a ref
 * that matches is checked against the remote's branches and tags before it's treated as a SHA.
 */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** What a `ref` names, which decides how it's cloned and checked out. */
type RefKind = 'branch' | 'tag' | 'commit';

/**
 * Settings applied to every git command, overriding the user's git config. `ext::` URLs run
 * arbitrary commands, and with `--recursive` the URLs come from other people's project files, so
 * that transport is refused outright. Submodules stay off even where the user's config turns them
 * on for `checkout`, `fetch`, and `merge`, because most of git's clone-time vulnerabilities go
 * through them.
 */
const GIT_SAFETY_ARGS = [
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'submodule.recurse=false',
  '-c',
  'fetch.recurseSubmodules=false',
];

/**
 * Settings added for a repository whose URL came from a dependency's project file rather than the
 * root's: only `https` and `ssh`, which also holds for any redirect.
 */
const THIRD_PARTY_GIT_ARGS = [
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'protocol.ssh.allow=always',
];

/**
 * The default {@link GitRunner}: `git` on `PATH`, run without a shell. `GIT_TERMINAL_PROMPT=0`
 * makes a missing credential fail fast instead of waiting for input nobody can see, and
 * {@link sshBatchMode} does the same for ssh's own host-key and passphrase prompts.
 */
export const defaultGitRunner: GitRunner = async (args, options) => {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(await sshBatchMode(options?.cwd)) };
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...GIT_SAFETY_ARGS, ...args],
      { cwd: options?.cwd, env, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
};

/**
 * `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`, so an unknown host key or a key passphrase fails the
 * row instead of prompting on a terminal behind the spinner (or hanging CI). Left out when the user
 * already chose how git runs ssh, through `GIT_SSH_COMMAND`, `GIT_SSH`, or `core.sshCommand`.
 */
async function sshBatchMode(cwd?: string): Promise<NodeJS.ProcessEnv> {
  if (process.env.GIT_SSH_COMMAND !== undefined || process.env.GIT_SSH !== undefined) return {};
  const configured = await new Promise<boolean>((resolve) => {
    execFile('git', ['config', '--get', 'core.sshCommand'], { cwd }, (error, stdout) =>
      resolve(!error && stdout.trim() !== ''),
    );
  });
  return configured ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
}

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
  // Trailing slashes are trimmed with a loop, not /\/+$/, which backtracks quadratically on a long
  // run of slashes that isn't at the end (CodeQL js/polynomial-redos).
  const trimSuffix = (value: string): string => {
    let end = value.length;
    while (end > 0 && value[end - 1] === '/') end--;
    return value.slice(0, end).replace(/\.git$/i, '');
  };

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

/**
 * Whether `url` uses a network transport that's safe to take from someone else's project file:
 * `https://`, `ssh://`, or scp-like `git@host:path`. Local paths, `file://`, plain `http://`,
 * `git://`, and `<transport>::<address>` forms are not.
 */
function isNetworkUrl(url: string): boolean {
  if (/^[a-z][a-z0-9+.-]*::/i.test(url)) return false;
  if (/^(?:[^@/]+@)?[^/:]+:(?!\/\/)/.test(url) && !/^[a-z]:[\\/]/i.test(url)) return true;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'ssh:';
  } catch {
    return false;
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
  /** `<key> (<branch>)` for each repository this run cloned or updated that ended up on a branch. */
  onBranch: string[];
  queue: QueuedProject[];
};

/**
 * Clone the source repositories of a project's package dependencies, as given by each package's
 * `repository` in `plugins.simply.packages`. See docs/design/0052-package-dependencies-clone.md.
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
    onBranch: [],
    queue: [{ dir: options.projectDir, project: rootProject, repositories: rootRepositories }],
  };
  if (!options.dryRun) await visitRootRepository(run);

  while (run.queue.length > 0) {
    const current = run.queue.shift()!;
    for (const dependency of dependenciesOf(current.project)) {
      await visitDependency(run, current, dependency.packageRef, dependency.via);
    }
  }

  if (run.onBranch.length > 0) {
    run.progress.info?.(
      `${listOf(run.onBranch)} ${run.onBranch.length === 1 ? 'is' : 'are'} on a branch, so a later --update ` +
        'brings in newer commits. To stay on one version, set "ref" to a tag.',
    );
  }
  return run.results;
}

/**
 * Mark the root project's own repository as visited, so a dependency that maps a package back to it
 * gets a row but is never cloned beside it, fetched, or merged. Its folder name is reserved too.
 * A root project that isn't in a git repository, or has no `origin`, has nothing to mark.
 */
async function visitRootRepository(run: CloneRun): Promise<void> {
  const cwd = run.options.projectDir;
  let directory: string;
  let url: string;
  try {
    // Relative to projectDir rather than --show-toplevel, which git spells its own way (on Windows,
    // long names where projectDir may hold 8.3 short ones), so the folder compares equal to outputDir.
    directory = path.resolve(cwd, await run.git(['rev-parse', '--show-cdup'], { cwd }));
    url = await run.git(['remote', 'get-url', 'origin'], { cwd });
  } catch {
    return;
  }
  run.visited.set(normalizeRepositoryUrl(url, directory), { via: '', directory, keys: new Set(), paths: new Set() });
  if (path.dirname(directory) === run.outputDir) run.usedFolders.add(path.basename(directory));
}

/** @returns `a`, `a and b`, or `a, b, and c`. */
function listOf(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)!}`;
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

  const { key, repository, from } = resolved;
  const normalizedUrl = normalizeRepositoryUrl(repository.url, current.dir);
  const previous = run.visited.get(normalizedUrl);
  if (previous) {
    await revisitRepository(run, previous, { packageRef, key, repository, via });
    return;
  }

  const directory = path.join(run.outputDir, chooseFolder(run, normalizedUrl, key));
  const row: DependencyCloneResult = {
    package: packageRef,
    key,
    url: repository.url,
    ref: repository.ref,
    status: 'Failed',
    via,
    directory,
  };
  const visited: VisitedRepository = {
    ref: repository.ref,
    via,
    directory,
    row,
    keys: new Set([key]),
    paths: new Set(),
  };
  run.visited.set(normalizedUrl, visited);
  run.results.push(row);

  const git = gitFor(run, row, from);
  if (!git) return;

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
        git,
      }),
    );
    await noteBranch(run, row, git);
  } catch (error) {
    row.status = 'Failed';
    row.message = (error as Error).message;
  }
  run.progress.stepStop?.(row.message ? `${row.status}: ${row.message}` : row.status);

  await followNestedProject(run, visited, repository.path, key);
}

/**
 * Handle a dependency whose repository this run already has. The same key again (a diamond) adds
 * nothing. A different package, such as another package directory of a monorepo, gets its own row
 * with the first row's outcome, and with `recursive` its own `path` is followed. A package whose
 * repository is the root project's own gets a row, but is never fetched or followed.
 */
async function revisitRepository(
  run: CloneRun,
  previous: VisitedRepository,
  dependency: { packageRef: string; key: string; repository: DependencyRepository; via: string },
): Promise<void> {
  const { packageRef, key, repository, via } = dependency;
  if (previous.row) warnOnRefConflict(run, key, repository.ref, via, previous);
  if (previous.keys.has(key)) return;
  previous.keys.add(key);

  run.results.push({
    package: packageRef,
    key,
    url: repository.url,
    ref: previous.ref,
    via,
    directory: previous.directory,
    ...(previous.row
      ? { status: previous.row.status, message: `same repository as ${previous.row.key!}` }
      : { status: 'Already cloned', message: 'the project itself' }),
  });

  if (previous.row) await followNestedProject(run, previous, repository.path, key);
}

/** With `recursive`, queue the project at `subPath` of a repository this run has, once per path. */
async function followNestedProject(
  run: CloneRun,
  visited: VisitedRepository,
  subPath: string | undefined,
  key: string,
): Promise<void> {
  if (!run.options.recursive || visited.row?.status === 'Failed' || !fs.existsSync(visited.directory)) return;
  const dir = path.join(visited.directory, subPath ?? '');
  if (visited.paths.has(dir)) return;
  visited.paths.add(dir);
  const nested = await readNestedProject(dir, key, run.progress);
  if (nested) run.queue.push(nested);
}

/**
 * Choose the git runner for a row's repository. A URL from a dependency's project file (`from`)
 * must be https or ssh, is named in a progress line, and gets {@link THIRD_PARTY_GIT_ARGS}.
 *
 * @returns The runner, or `undefined` after recording why the row failed.
 */
function gitFor(run: CloneRun, row: DependencyCloneResult, from: string | undefined): GitRunner | undefined {
  if (from === undefined) return run.git;
  const { key, url } = row;
  if (!isNetworkUrl(url!)) {
    row.message =
      `${from}'s sfdx-project.json gives a URL that isn't https or ssh, which is only accepted from your ` +
      `own project file. Map ${key!} under plugins.simply.packages to clone it.`;
    return undefined;
  }
  run.progress.info?.(
    `${key!}'s repository comes from ${from}'s sfdx-project.json. Map ${key!} under plugins.simply.packages ` +
      'to choose it yourself.',
  );
  return (args, options) => run.git([...THIRD_PARTY_GIT_ARGS, ...args], options);
}

/** Remember a repository this run cloned or updated if it's now on a branch, for the closing note. */
async function noteBranch(run: CloneRun, row: DependencyCloneResult, git: GitRunner): Promise<void> {
  if (row.status !== 'Cloned' && row.status !== 'Updated') return;
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: row.directory }).catch(() => '');
  if (branch !== '') run.onBranch.push(`${row.key!} (${branch})`);
}

/**
 * @returns The repository entry for a dependency, with `from` naming the dependency whose project
 * file supplied it when that isn't the root's. A package build needs the root project to list its
 * whole dependency hierarchy, so the root's map can cover every package and always comes first; a
 * dependency's own map only fills in for packages the root doesn't map.
 *
 * A dependency's project may name a package differently from the root: by a bare ID, or by another
 * alias. So the root's map is tried through the root's `packageAliases`, then through the ID the
 * dependency's own `packageAliases` give, and then through the dependency's aliases themselves.
 */
function resolveFor(
  run: CloneRun,
  current: QueuedProject,
  packageRef: string,
): (ResolvedDependencyRepository & { from?: string }) | undefined {
  const rootAliases = run.rootProject.packageAliases ?? {};
  if (current.key === undefined) return resolveDependencyRepository(packageRef, run.rootRepositories, rootAliases);

  const ownAliases = current.project.packageAliases ?? {};
  const fromRoot =
    resolveDependencyRepository(packageRef, run.rootRepositories, rootAliases) ??
    resolveDependencyRepository(ownAliases[packageRef] ?? packageRef, run.rootRepositories, rootAliases) ??
    resolveDependencyRepository(packageRef, run.rootRepositories, ownAliases);
  if (fromRoot) return fromRoot;
  const own = resolveDependencyRepository(packageRef, current.repositories, ownAliases);
  return own && { ...own, from: current.key };
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
  /** The runner for this repository, with {@link THIRD_PARTY_GIT_ARGS} when its URL isn't the root's. */
  git: GitRunner;
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
    remote = await request.git(['remote', 'get-url', 'origin'], { cwd: directory });
  } catch {
    return { status: 'Failed', message: `${directory} exists and is not a clone of ${cloneUrl}` };
  }
  if (normalizeRepositoryUrl(remote, directory) !== normalizedUrl) {
    return { status: 'Failed', message: `${directory} exists and is a clone of ${remote}, not ${cloneUrl}` };
  }

  return update ? updateClone(request) : { status: 'Already cloned' };
}

/** `git clone` one repository at its ref. A commit SHA can't be cloned shallowly, so it gets full history. */
async function cloneRepository(run: CloneRun, { directory, cloneUrl, ref, key, git }: SyncRequest): Promise<void> {
  // Only a ref that could be a SHA costs the extra round trip; any other ref is a branch or a tag,
  // and `--branch` takes either.
  const isSha = ref !== undefined && SHA_PATTERN.test(ref) && (await remoteRefKind(git, cloneUrl, ref)) === 'commit';
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

  await git(args);
  if (isSha) await git(['checkout', '--detach', ref], { cwd: directory });
}

/**
 * @returns What `ref` names on `remote` (a URL, or `origin` with `cwd`): a branch, then a tag, or
 * failing both, a commit when it looks like a SHA. Anything else is called a branch, so the git
 * command that uses it fails naming it.
 */
async function remoteRefKind(git: GitRunner, remote: string, ref: string, cwd?: string): Promise<RefKind> {
  const listed = await git(['ls-remote', '--heads', '--tags', '--end-of-options', remote, ref], { cwd });
  const names = new Set(listed.split('\n').map((line) => line.split('\t')[1]));
  if (names.has(`refs/heads/${ref}`)) return 'branch';
  if (names.has(`refs/tags/${ref}`)) return 'tag';
  return SHA_PATTERN.test(ref) ? 'commit' : 'branch';
}

/**
 * Bring an existing, clean clone to its ref: fast-forward when it's on that branch, or check the
 * ref out when HEAD is detached. A clone on some other branch may be the developer's own working
 * copy, so it's left alone, unless it's still on the remote's default branch with no commits of its
 * own, as a clone made before a "ref" was set is. That one moves to the ref.
 */
async function updateClone({
  directory,
  ref,
  git,
}: SyncRequest): Promise<Pick<DependencyCloneResult, 'status' | 'message'>> {
  const cwd = directory;
  if ((await git(['status', '--porcelain'], { cwd })) !== '') {
    return { status: 'Dirty, skipped', message: 'uncommitted changes' };
  }

  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd }).catch(() => '');
  const remoteDefault = await defaultBranch(git, directory);
  const wanted = ref ?? remoteDefault;
  if (wanted === undefined) {
    await git(['fetch', '--tags', 'origin'], { cwd });
    if (branch !== '') await git(['merge', '--ff-only', '@{upstream}'], { cwd });
    return { status: 'Updated' };
  }

  const kind = await remoteRefKind(git, 'origin', wanted, cwd);
  if (branch !== '' && !(kind === 'branch' && branch === wanted)) {
    const movable = branch === remoteDefault && !(await hasOwnCommits(git, directory));
    if (!movable) {
      const target = kind === 'branch' ? wanted : `${kind} ${wanted}`;
      return { status: 'On other branch, skipped', message: `on ${branch}, not ${target}` };
    }
  }

  // A shallow clone only tracks the branch it was made from, so a branch ref is fetched by name.
  const branchRefspec = kind === 'branch' ? [`+refs/heads/${wanted}:refs/remotes/origin/${wanted}`] : [];
  await git(['fetch', '--tags', 'origin', ...branchRefspec], { cwd });
  if (kind === 'branch') {
    if (branch !== wanted) await git(['checkout', '--quiet', wanted], { cwd });
    await git(['merge', '--ff-only', '@{upstream}'], { cwd });
  } else {
    await git(['checkout', '--quiet', '--detach', wanted], { cwd });
  }
  return { status: 'Updated' };
}

/** @returns Whether the checked-out branch has commits its upstream doesn't, or has no upstream. */
async function hasOwnCommits(git: GitRunner, directory: string): Promise<boolean> {
  try {
    return (await git(['rev-list', '--count', '@{upstream}..HEAD'], { cwd: directory })) !== '0';
  } catch {
    return true;
  }
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
    return { dir, project, key, repositories: readDependencyRepositories(project, `${key}'s sfdx-project.json`) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    progress.warn?.(`Not following ${key}'s dependencies: ${(error as Error).message}`);
    return undefined;
  }
}
