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
import { generateFlexipageDiff, runFlexipageDelta } from '../../src/build/flexipageDelta.js';

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

describe('flexipageDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '' } as never);
  });

  describe('generateFlexipageDiff', () => {
    it("should skip if disabled (using the --disabled flag the CLI actually wires, fixing the original's dead disableFlexipageDiff check)", async () => {
      const result = await generateFlexipageDiff({ from: 'a', to: 'b', disabled: true });

      expect(result).toEqual({ skipped: true, success: false });
      expect(logger.info).toHaveBeenCalledWith('Flexipage diff generation is disabled. Skipping.');
      expect(installFlowDeltaPlugin).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('should call runFlexipageDelta and log success', async () => {
      const result = await generateFlexipageDiff({ from: 'a', to: 'b' });

      expect(result).toEqual({ skipped: false, success: true });
      expect(logger.info).toHaveBeenCalledWith('Generating flexipage diff using flexipage-delta...');
      expect(installFlowDeltaPlugin).toHaveBeenCalled();
      expect(execa).toHaveBeenCalledTimes(2);
      expect(logger.success).toHaveBeenCalledWith('Flexipage diff generation completed.');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log an error if runFlexipageDelta throws an error, without throwing itself', async () => {
      const error = new Error('Test error');
      vi.mocked(execa).mockRejectedValueOnce(error);

      const result = await generateFlexipageDiff({ from: 'a', to: 'b' });

      expect(result).toEqual({ skipped: false, success: false });
      expect(logger.info).toHaveBeenCalledWith('Generating flexipage diff using flexipage-delta...');
      expect(logger.error).toHaveBeenCalledWith('Flexipage diff generation failed.');
      expect(logger.error).toHaveBeenCalledWith(error.message);
    });
  });

  describe('runFlexipageDelta', () => {
    const baseOptions = { from: 'commit-a', to: 'commit-b' };

    it("should throw an error if 'from' or 'to' are missing", async () => {
      await expect(runFlexipageDelta({ to: 'b' } as never)).rejects.toThrow(
        'Missing "from" or "to" commit SHA. Provide --from/--to arguments.',
      );
      await expect(runFlexipageDelta({ from: 'a' } as never)).rejects.toThrow(
        'Missing "from" or "to" commit SHA. Provide --from/--to arguments.',
      );
    });

    it('should call installFlowDeltaPlugin', async () => {
      await runFlexipageDelta(baseOptions);

      expect(installFlowDeltaPlugin).toHaveBeenCalled();
    });

    it('should call execa with correct args for flexipage-delta', async () => {
      await runFlexipageDelta(baseOptions);

      expect(execa).toHaveBeenCalledWith(
        'flexipage-delta',
        [
          '--repo',
          '.',
          '--from',
          baseOptions.from,
          '--to',
          baseOptions.to,
          '--path',
          '**/*.flexipage-meta.xml',
          '--changed-only',
          '--out',
          'flexipage-delta-out',
          '--json',
        ],
        { stdio: 'inherit' },
      );
    });

    it('should call execa with correct args for flexipage-delta-gitlab with all options', async () => {
      await runFlexipageDelta({
        ...baseOptions,
        out: 'custom-out',
        projectAccessToken: 'token',
        ciProjectId: '123',
        ciMergeRequestIid: '456',
      });

      expect(execa).toHaveBeenCalledWith(
        'flexipage-delta-gitlab',
        [
          '--in',
          'custom-out',
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
      await runFlexipageDelta(baseOptions);

      expect(execa).toHaveBeenNthCalledWith(2, 'flexipage-delta-gitlab', ['--in', 'flexipage-delta-out'], {
        stdio: 'inherit',
      });
    });

    it('should run the GitHub reporter when the provider is github', async () => {
      await runFlexipageDelta({
        ...baseOptions,
        vcsProvider: 'github',
        projectAccessToken: 'ghp-token',
        ciRepository: 'my-org/my-repo',
        ciPullRequestNumber: '45',
      });

      expect(execa).toHaveBeenNthCalledWith(
        2,
        'flexipage-delta-github',
        [
          '--in',
          'flexipage-delta-out',
          '--token',
          'ghp-token',
          '--api-url',
          'https://api.github.com',
          '--repo',
          'my-org/my-repo',
          '--pr',
          '45',
        ],
        { stdio: 'inherit' },
      );
    });
  });
});
