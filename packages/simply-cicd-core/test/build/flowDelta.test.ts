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

import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { installFlowDeltaPlugin } from '../../src/sfPlugins.js';
import { generateFlowDiff, runFlowDelta } from '../../src/build/flowDelta.js';

vi.mock('execa');
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    raw: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../src/sfPlugins.js', () => ({ installFlowDeltaPlugin: vi.fn() }));

describe('flowDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);
  });

  describe('generateFlowDiff', () => {
    it("should skip if disabled (using the --disabled flag the CLI actually wires, fixing the original's dead disableFlowDiff check)", async () => {
      const result = await generateFlowDiff({ from: 'a', to: 'b', disabled: true });

      expect(result).toEqual({ skipped: true, success: false });
      expect(logger.info).toHaveBeenCalledWith('Flow diff generation is disabled. Skipping.');
      expect(installFlowDeltaPlugin).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('should call runFlowDelta and log success', async () => {
      const result = await generateFlowDiff({ from: 'a', to: 'b' });

      expect(result).toEqual({ skipped: false, success: true });
      expect(logger.info).toHaveBeenCalledWith('Generating flow diff using flow-delta...');
      expect(installFlowDeltaPlugin).toHaveBeenCalled();
      expect(execa).toHaveBeenCalledTimes(2);
      expect(logger.success).toHaveBeenCalledWith('Flow diff generation completed.');
    });

    it('should log error on failure, without throwing', async () => {
      const error = new Error('test error');
      vi.mocked(execa).mockRejectedValue(error);

      const result = await generateFlowDiff({ from: 'a', to: 'b' });

      expect(result).toEqual({ skipped: false, success: false });
      expect(logger.error).toHaveBeenCalledWith('Flow diff generation failed.');
      expect(logger.error).toHaveBeenCalledWith('test error');
    });
  });

  describe('runFlowDelta', () => {
    it('should throw error if from or to is missing', async () => {
      await expect(runFlowDelta({ from: 'a' } as never)).rejects.toThrow(
        'Missing "from" or "to" commit SHA. Provide --from/--to arguments.',
      );
      await expect(runFlowDelta({ to: 'b' } as never)).rejects.toThrow(
        'Missing "from" or "to" commit SHA. Provide --from/--to arguments.',
      );
    });

    it('should call execa with correct arguments', async () => {
      await runFlowDelta({
        from: 'a',
        to: 'b',
        out: 'test-out',
        projectAccessToken: 'token',
        ciProjectId: '123',
        ciMergeRequestIid: '456',
      });

      expect(installFlowDeltaPlugin).toHaveBeenCalled();
      expect(execa).toHaveBeenCalledWith(
        'flow-delta',
        [
          '--repo',
          '.',
          '--from',
          'a',
          '--to',
          'b',
          '--path',
          '**/*.flow-meta.xml',
          '--changed-only',
          '--out',
          'test-out',
          '--json',
        ],
        { stdio: 'inherit' },
      );
      expect(execa).toHaveBeenCalledWith(
        'flow-delta-gitlab',
        [
          '--in',
          'test-out',
          '--token',
          'token',
          '--api-url',
          'https://gitlab.com/api/v4',
          '--project-id',
          '123',
          '--mr-iid',
          '456',
        ],
        { stdio: 'inherit' },
      );
    });

    it('should pass only --in when no reporter context is provided', async () => {
      await runFlowDelta({ from: 'a', to: 'b' });

      expect(execa).toHaveBeenNthCalledWith(2, 'flow-delta-gitlab', ['--in', 'flow-delta-out'], {
        stdio: 'inherit',
      });
    });

    it('should run the GitHub reporter with GitHub context when the provider is github', async () => {
      await runFlowDelta({
        from: 'a',
        to: 'b',
        vcsProvider: 'github',
        projectAccessToken: 'ghp-token',
        commitSha: 'sha123',
        ciRepository: 'my-org/my-repo',
        ciPullRequestNumber: '45',
        ciRunId: '987',
        // GitLab context is ignored for a GitHub run.
        ciProjectId: '123',
        ciMergeRequestIid: '456',
      });

      expect(execa).toHaveBeenNthCalledWith(
        2,
        'flow-delta-github',
        [
          '--in',
          'flow-delta-out',
          '--token',
          'ghp-token',
          '--commit-sha',
          'sha123',
          '--api-url',
          'https://api.github.com',
          '--repo',
          'my-org/my-repo',
          '--pr',
          '45',
          '--run-id',
          '987',
        ],
        { stdio: 'inherit' },
      );
    });

    it('should derive the reporter api-url from a self-hosted vcs-host', async () => {
      await runFlowDelta({
        from: 'a',
        to: 'b',
        projectAccessToken: 'token',
        vcsHost: 'gitlab.example.com',
      });

      expect(execa).toHaveBeenNthCalledWith(
        2,
        'flow-delta-gitlab',
        ['--in', 'flow-delta-out', '--token', 'token', '--api-url', 'https://gitlab.example.com/api/v4'],
        { stdio: 'inherit' },
      );
    });
  });
});
