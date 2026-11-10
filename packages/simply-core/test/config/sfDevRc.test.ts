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
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  findSfDevRcPath,
  loadSfDevRc,
  resolveAlmProjectKeys,
  resolveAlmProviderKind,
  resolveVcsProviderKind,
  resolveVcsSettings,
  SfDevRcError,
  sfDevRcSchema,
} from '../../src/config/sfDevRc.js';

let cwd: string;
let warn: ReturnType<typeof vi.fn<(message: string) => void>>;

function writeFile(name: string, content: unknown): string {
  const filePath = path.join(cwd, name);
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  return filePath;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdevrc-'));
  warn = vi.fn<(message: string) => void>();
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('findSfDevRcPath', () => {
  it('returns undefined when neither file exists', () => {
    expect(findSfDevRcPath(cwd)).toBeUndefined();
  });

  it('prefers .sfdevrc.json over the legacy .sfdevrc', () => {
    const current = writeFile('.sfdevrc.json', {});
    writeFile('.sfdevrc', {});

    expect(findSfDevRcPath(cwd)).toBe(current);
  });

  it('falls back to the legacy .sfdevrc', () => {
    const legacy = writeFile('.sfdevrc', {});

    expect(findSfDevRcPath(cwd)).toBe(legacy);
  });
});

describe('loadSfDevRc', () => {
  it('returns an empty config and no path when the file is missing', () => {
    expect(loadSfDevRc({ cwd, env: {}, warn })).toEqual({ config: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads and validates the base fields', () => {
    const filePath = writeFile('.sfdevrc.json', {
      vcs: { provider: 'github', host: 'github.example.com', projectId: 'acme/app' },
      alm: { provider: 'gitlab-issues', projectKeys: [] },
      branchRegex: '^feature/.+',
    });

    expect(loadSfDevRc({ cwd, env: {}, warn })).toEqual({
      path: filePath,
      config: {
        vcs: { provider: 'github', host: 'github.example.com', projectId: 'acme/app' },
        alm: { provider: 'gitlab-issues', projectKeys: [] },
        branchRegex: '^feature/.+',
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('preserves sections it does not know about', () => {
    writeFile('.sfdevrc.json', { setup: { include: ['core'] }, deploymentPlugins: ['p1'] });

    expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({
      setup: { include: ['core'] },
      deploymentPlugins: ['p1'],
    });
  });

  it('reads the legacy .sfdevrc file name and warns', () => {
    writeFile('.sfdevrc', { branchRegex: 'x' });

    expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({ branchRegex: 'x' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Rename it to .sfdevrc.json'));
  });

  it('throws SfDevRcError naming the file for malformed JSON', () => {
    const filePath = writeFile('.sfdevrc.json', '{ not json');

    expect(() => loadSfDevRc({ cwd, env: {}, warn })).toThrow(SfDevRcError);
    expect(() => loadSfDevRc({ cwd, env: {}, warn })).toThrow(`${filePath} is not valid JSON`);
  });

  it('throws when the top level is not an object', () => {
    writeFile('.sfdevrc.json', '[]');

    expect(() => loadSfDevRc({ cwd, env: {}, warn })).toThrow('must contain a JSON object at the top level');
  });

  it('throws with the field path for an unknown provider', () => {
    writeFile('.sfdevrc.json', { vcs: { provider: 'bitbucket' } });

    expect(() => loadSfDevRc({ cwd, env: {}, warn })).toThrow(/- vcs\.provider: /);
  });

  it('throws for an invalid branchRegex', () => {
    writeFile('.sfdevrc.json', { branchRegex: '(' });

    expect(() => loadSfDevRc({ cwd, env: {}, warn })).toThrow(/- branchRegex: Not a valid regular expression/);
  });

  it("validates a consumer's extension section", () => {
    const schema = sfDevRcSchema.extend({ deploymentPlugins: z.array(z.string()).optional() });
    writeFile('.sfdevrc.json', { deploymentPlugins: 'not-an-array', other: true });

    expect(() => loadSfDevRc({ cwd, env: {}, warn, schema })).toThrow(/- deploymentPlugins: /);
  });

  it('keeps unknown sections when an extension schema is used', () => {
    const schema = sfDevRcSchema.extend({ deploymentPlugins: z.array(z.string()).optional() });
    writeFile('.sfdevrc.json', { deploymentPlugins: ['p1'], setup: { exclude: ['utam'] } });

    const { config } = loadSfDevRc({ cwd, env: {}, warn, schema });

    expect(config.deploymentPlugins).toEqual(['p1']);
    expect(config.setup).toEqual({ exclude: ['utam'] });
  });

  it('accepts the source-tool shape with empty legacy values, silently', () => {
    writeFile('.sfdevrc.json', {
      branchRegex: '',
      deploymentPlugins: [],
      gitlabProjectId: '',
      jiraProjectKey: '',
      jiraProjectKeys: [],
      setup: { include: [], exclude: [] },
    });

    expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({
      branchRegex: '',
      deploymentPlugins: [],
      setup: { include: [], exclude: [] },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  describe('legacy field normalization', () => {
    it('maps gitlabProjectId to a gitlab vcs section', () => {
      writeFile('.sfdevrc.json', { gitlabProjectId: 12_345 });

      expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({ vcs: { provider: 'gitlab', projectId: '12345' } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gitlabProjectId" is deprecated'));
    });

    it('maps jiraProjectKey(s) to a jira alm section', () => {
      writeFile('.sfdevrc.json', { jiraProjectKey: 'ABC', jiraProjectKeys: ['DEF'] });

      expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({
        alm: { provider: 'jira', projectKeys: ['ABC', 'DEF'] },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('"jiraProjectKey" and "jiraProjectKeys" are deprecated'),
      );
    });

    it('maps almProjectKey(s) to alm.projectKeys without naming a provider', () => {
      writeFile('.sfdevrc.json', { almProjectKey: 'ABC', almProjectKeys: ['DEF'] });

      expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({ alm: { projectKeys: ['ABC', 'DEF'] } });
    });

    it('prefers almProjectKey(s) over jiraProjectKey(s) without blending', () => {
      writeFile('.sfdevrc.json', { almProjectKey: 'NEW', jiraProjectKey: 'OLD' });

      expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({ alm: { projectKeys: ['NEW'] } });
    });

    it('lets new-style sections win outright over legacy fields', () => {
      writeFile('.sfdevrc.json', {
        vcs: { provider: 'github', projectId: 'acme/app' },
        alm: { provider: 'gitlab-issues' },
        gitlabProjectId: '99',
        jiraProjectKey: 'OLD',
      });

      expect(loadSfDevRc({ cwd, env: {}, warn }).config).toEqual({
        vcs: { provider: 'github', projectId: 'acme/app' },
        alm: { provider: 'gitlab-issues' },
      });
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('SIMPLY_* environment variables', () => {
    it('builds a config from the environment alone when there is no file', () => {
      const env = {
        SIMPLY_VCS_PROVIDER: 'github',
        SIMPLY_VCS_HOST: 'github.example.com',
        SIMPLY_VCS_PROJECT_ID: 'acme/app',
        SIMPLY_ALM_PROVIDER: 'jira',
        SIMPLY_ALM_PROJECT_KEYS: ' ABC , DEF,,',
        SIMPLY_ALM_BASE_URL: 'https://example.atlassian.net/browse',
        SIMPLY_BRANCH_REGEX: '^feature/.+',
      };

      expect(loadSfDevRc({ cwd, env, warn })).toEqual({
        config: {
          vcs: { provider: 'github', host: 'github.example.com', projectId: 'acme/app' },
          alm: { provider: 'jira', projectKeys: ['ABC', 'DEF'], baseUrl: 'https://example.atlassian.net/browse' },
          branchRegex: '^feature/.+',
        },
      });
    });

    it('overrides individual file fields and keeps the rest', () => {
      writeFile('.sfdevrc.json', {
        vcs: { provider: 'gitlab', host: 'gitlab.example.com', projectId: '42' },
        alm: { provider: 'jira', projectKeys: ['ABC'] },
        branchRegex: 'file',
      });

      const { config } = loadSfDevRc({
        cwd,
        env: { SIMPLY_VCS_HOST: 'other.example.com', SIMPLY_ALM_PROJECT_KEYS: 'XYZ' },
        warn,
      });

      expect(config).toEqual({
        vcs: { provider: 'gitlab', host: 'other.example.com', projectId: '42' },
        alm: { provider: 'jira', projectKeys: ['XYZ'] },
        branchRegex: 'file',
      });
    });

    it("drops the file's section when the environment names a different provider", () => {
      writeFile('.sfdevrc.json', {
        vcs: { provider: 'gitlab', host: 'gitlab.example.com', projectId: '42' },
        alm: { provider: 'jira', projectKeys: ['ABC'], baseUrl: 'https://jira' },
      });

      const { config } = loadSfDevRc({
        cwd,
        env: { SIMPLY_VCS_PROVIDER: 'github', SIMPLY_ALM_PROVIDER: 'gitlab-issues' },
        warn,
      });

      expect(config).toEqual({ vcs: { provider: 'github' }, alm: { provider: 'gitlab-issues' } });
    });

    it('keeps file settings when the environment names the same provider, or the file names none', () => {
      writeFile('.sfdevrc.json', { vcs: { host: 'h' }, alm: { provider: 'jira', projectKeys: ['ABC'] } });

      const { config } = loadSfDevRc({
        cwd,
        env: { SIMPLY_VCS_PROVIDER: 'github', SIMPLY_ALM_PROVIDER: 'jira' },
        warn,
      });

      expect(config).toEqual({
        vcs: { provider: 'github', host: 'h' },
        alm: { provider: 'jira', projectKeys: ['ABC'] },
      });
    });

    it('treats empty or whitespace-only values as unset', () => {
      writeFile('.sfdevrc.json', { vcs: { provider: 'gitlab' } });

      const { config } = loadSfDevRc({ cwd, env: { SIMPLY_VCS_PROVIDER: '', SIMPLY_VCS_HOST: '  ' }, warn });

      expect(config).toEqual({ vcs: { provider: 'gitlab' } });
    });

    it('reports an invalid value against the variable name, not a file field', () => {
      writeFile('.sfdevrc.json', {});

      expect(() => loadSfDevRc({ cwd, env: { SIMPLY_VCS_PROVIDER: 'bitbucket' }, warn })).toThrow(
        /Invalid environment variable value:\n {2}- SIMPLY_VCS_PROVIDER: /,
      );
      expect(() => loadSfDevRc({ cwd, env: { SIMPLY_BRANCH_REGEX: '(' }, warn })).toThrow(
        /- SIMPLY_BRANCH_REGEX: Not a valid regular expression/,
      );
    });

    it('throws an error with no file path for a bad variable', () => {
      try {
        loadSfDevRc({ cwd, env: { SIMPLY_ALM_PROVIDER: 'nope' }, warn });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(SfDevRcError);
        expect((error as SfDevRcError).filePath).toBeUndefined();
      }
    });

    it('still reports a malformed file section rather than hiding it behind an override', () => {
      writeFile('.sfdevrc.json', { vcs: 'gitlab' });

      expect(() => loadSfDevRc({ cwd, env: { SIMPLY_VCS_HOST: 'h' }, warn })).toThrow(/- vcs: /);
    });

    it('reads process.env by default', () => {
      vi.stubEnv('SIMPLY_ALM_PROJECT_KEYS', 'FROM-PROCESS');
      try {
        expect(loadSfDevRc({ cwd, warn }).config).toEqual({ alm: { projectKeys: ['FROM-PROCESS'] } });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe('resolvers', () => {
  const config = {
    vcs: { provider: 'gitlab' as const, host: 'gitlab.example.com', projectId: '42' },
    alm: { provider: 'gitlab-issues' as const, projectKeys: ['ABC', 'ABC', '', 'DEF'] },
  };

  it('resolveVcsProviderKind: explicit > file > fallback', () => {
    expect(resolveVcsProviderKind(config, 'github')).toBe('github');
    expect(resolveVcsProviderKind(config)).toBe('gitlab');
    expect(resolveVcsProviderKind({ vcs: { provider: 'github' } })).toBe('github');
    expect(resolveVcsProviderKind({})).toBe('gitlab');
    expect(resolveVcsProviderKind({}, undefined, 'github')).toBe('github');
  });

  it('resolveAlmProviderKind: explicit > file > fallback', () => {
    expect(resolveAlmProviderKind(config, 'jira')).toBe('jira');
    expect(resolveAlmProviderKind(config)).toBe('gitlab-issues');
    expect(resolveAlmProviderKind({})).toBe('jira');
  });

  it('resolveVcsSettings uses the file host and projectId for the same provider', () => {
    expect(resolveVcsSettings(config)).toEqual({ kind: 'gitlab', host: 'gitlab.example.com', projectId: '42' });
    expect(resolveVcsSettings(config, { host: 'other.example.com' })).toEqual({
      kind: 'gitlab',
      host: 'other.example.com',
      projectId: '42',
    });
  });

  it('resolveVcsSettings ignores file settings that describe a different provider', () => {
    expect(resolveVcsSettings(config, { provider: 'github' })).toEqual({
      kind: 'github',
      host: undefined,
      projectId: undefined,
    });
  });

  it('resolveVcsSettings applies file settings that name no provider', () => {
    expect(resolveVcsSettings({ vcs: { host: 'h' } }, { provider: 'github' })).toEqual({
      kind: 'github',
      host: 'h',
      projectId: undefined,
    });
  });

  it('resolveAlmProjectKeys: explicit wins outright, then file, deduplicated', () => {
    expect(resolveAlmProjectKeys(config, 'XYZ')).toEqual(['XYZ']);
    expect(resolveAlmProjectKeys(config, ['XYZ', 'XYZ'])).toEqual(['XYZ']);
    expect(resolveAlmProjectKeys(config, '')).toEqual(['ABC', 'DEF']);
    expect(resolveAlmProjectKeys(config)).toEqual(['ABC', 'DEF']);
    expect(resolveAlmProjectKeys({})).toEqual([]);
  });
});
