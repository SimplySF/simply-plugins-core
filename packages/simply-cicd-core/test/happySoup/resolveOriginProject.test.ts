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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOriginPipelineUrl, resolvePackageOrigin } from '../../src/happySoup/resolveOriginProject.js';

vi.mock('node:fs');

describe('parseOriginPipelineUrl', () => {
  it('parses a GitLab pipeline URL, including nested groups', () => {
    expect(parseOriginPipelineUrl('https://gitlab.com/my-group/my-subgroup/my-project/-/pipelines/6578690')).toEqual({
      vcsProvider: 'gitlab',
      host: 'gitlab.com',
      projectPath: 'my-group/my-subgroup/my-project',
    });
  });

  it('parses a GitHub Actions run URL', () => {
    expect(parseOriginPipelineUrl('https://github.com/my-org/my-repo/actions/runs/123456')).toEqual({
      vcsProvider: 'github',
      host: 'github.com',
      projectPath: 'my-org/my-repo',
    });
  });

  it('respects a self-hosted host', () => {
    expect(parseOriginPipelineUrl('https://gitlab.example.com/group/project/-/pipelines/1')).toEqual({
      vcsProvider: 'gitlab',
      host: 'gitlab.example.com',
      projectPath: 'group/project',
    });
  });

  it('returns undefined for an unrecognized URL shape', () => {
    expect(parseOriginPipelineUrl('https://example.com/not-a-pipeline-url')).toBeUndefined();
  });

  it('returns undefined for a non-URL string', () => {
    expect(parseOriginPipelineUrl('not a url')).toBeUndefined();
  });
});

describe('resolvePackageOrigin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('prefers an override from .sfdevrc.json over the pipeline URL', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        packageOriginOverrides: { MyVendorPackage: { vcsProvider: 'gitlab', projectPath: 'vendor/actual-repo' } },
      }),
    );

    expect(resolvePackageOrigin('MyVendorPackage', 'https://gitlab.com/other/project/-/pipelines/1')).toEqual({
      vcsProvider: 'gitlab',
      host: 'gitlab.com',
      projectPath: 'vendor/actual-repo',
    });
  });

  it('defaults the override host from the provider kind when not specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ packageOriginOverrides: { MyPackage: { vcsProvider: 'github', projectPath: 'vendor/repo' } } }),
    );

    expect(resolvePackageOrigin('MyPackage', undefined)).toEqual({
      vcsProvider: 'github',
      host: 'github.com',
      projectPath: 'vendor/repo',
    });
  });

  it('falls back to parsing the pipeline URL when no override exists', () => {
    expect(resolvePackageOrigin('MyPackage', 'https://gitlab.com/group/project/-/pipelines/1')).toEqual({
      vcsProvider: 'gitlab',
      host: 'gitlab.com',
      projectPath: 'group/project',
    });
  });

  it('returns undefined when there is no override and no description to parse', () => {
    expect(resolvePackageOrigin('MyPackage', undefined)).toBeUndefined();
  });
});
