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

import { promises as fsPromises } from 'node:fs';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSfdxProject } from '@simplysf/simply-core';
import { appendToEnvFile } from '../../src/env.js';
import {
  projectNotifyAfterScript,
  projectNotifyBeforeScript,
  type NotifyProjectOptions,
} from '../../src/notify/projectNotification.js';

vi.mock('execa');
vi.mock('@simplysf/simply-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplysf/simply-core')>();
  return { ...actual, readSfdxProject: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(), writeFile: vi.fn() } };
});
vi.mock('../../src/env.js', () => ({ appendToEnvFile: vi.fn() }));
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

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

/** The options `simply cicd notify project` passes when only `--teams-webhook-url` is given. */
const baseOptions = (overrides: Partial<NotifyProjectOptions> = {}): NotifyProjectOptions => ({
  teamsWebhookUrl: ['http://mock-webhook'],
  almProvider: 'jira',
  debug: false,
  ...overrides,
});

describe('projectNotification', () => {
  let fetchMock: ReturnType<typeof vi.fn<(url: string, options?: RequestInit) => Promise<Response>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    fetchMock = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('projectNotifyBeforeScript', () => {
    it('does nothing outside the pre-destructive stage', async () => {
      await projectNotifyBeforeScript(baseOptions({ ciJobStage: 'post-deploy' }));

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
      expect(appendToEnvFile).not.toHaveBeenCalled();
    });

    it('does nothing when the job was canceled', async () => {
      await projectNotifyBeforeScript(baseOptions({ ciJobStage: 'pre-destructive', ciJobStatus: 'canceled' }));

      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('records N/A versions when org credentials are missing', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);

      await projectNotifyBeforeScript(baseOptions({ ciJobStage: 'pre-destructive' }));

      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        'project-build.env',
        expect.stringContaining('CREATED_BY_JOB_NAME='),
      );
      expect(appendToEnvFile).toHaveBeenCalledWith(
        'project-build.env',
        { PREV_INSTALLED_PACKAGE_VERSION: 'N/A', TARGET_PACKAGE_VERSION: 'N/A' },
        expect.anything(),
      );
    });

    it('queries the pre-authenticated alias/packaging DevHub and resolves both package versions on success', async () => {
      vi.mocked(readSfdxProject).mockResolvedValue({ packageDirectories: [{ default: true, package: 'my-pkg' }] });
      vi.mocked(execa).mockImplementation((async (command: string, args: string[] = []) => {
        if (command === 'sf' && args[0] === 'package' && args[1] === 'installed') {
          return {
            stdout: JSON.stringify({
              result: [{ SubscriberPackageName: 'my-pkg', SubscriberPackageVersionNumber: '2.40.0.10' }],
            }),
          };
        }
        if (command === 'sf' && args[0] === 'package' && args[1] === 'version') {
          return { stdout: JSON.stringify({ result: { Version: '2.41.0.1' } }) };
        }
        throw new Error(`Unexpected execa call: ${command} ${args.join(' ')}`);
      }) as never);

      await projectNotifyBeforeScript(
        baseOptions({
          ciJobStage: 'pre-destructive',
          alias: 'my-org',
          packagingDevhub: 'packaging-devhub',
          subscriberPackageVersionId: '04tSJ000000AKwjYAG',
        }),
      );

      expect(execa).toHaveBeenCalledWith(
        'sf',
        expect.arrayContaining(['package', 'installed', 'list', '--target-org', 'my-org']),
      );
      expect(execa).toHaveBeenCalledWith('sf', expect.arrayContaining(['--target-dev-hub', 'packaging-devhub']));
      expect(execa).not.toHaveBeenCalledWith(expect.stringContaining('sf login org jwt'), expect.anything());
      expect(appendToEnvFile).toHaveBeenCalledWith(
        'project-build.env',
        { PREV_INSTALLED_PACKAGE_VERSION: 'v2.40.0.10', TARGET_PACKAGE_VERSION: 'v2.41.0.1' },
        expect.anything(),
      );
    });
  });

  describe('projectNotifyAfterScript', () => {
    const sentBody = (): string => {
      const [, options] = fetchMock.mock.calls[0];
      return (JSON.parse(options?.body as string) as { content: string }).content;
    };

    it('sends a success card on post-destructive success', async () => {
      const result = await projectNotifyAfterScript(
        baseOptions({ ciJobStage: 'post-destructive', ciJobStatus: 'success', ciProjectTitle: 'My Project' }),
      );

      expect(result.sent).toBe(true);
      expect(sentBody()).toContain('My Project: Completed');
      expect(sentBody()).toContain('Deployment');
    });

    it('sends a failure card on a failed status', async () => {
      const result = await projectNotifyAfterScript(
        baseOptions({ ciJobStage: 'post-destructive', ciJobStatus: 'failed', ciProjectTitle: 'My Project' }),
      );

      expect(result.sent).toBe(true);
      expect(sentBody()).toContain('My Project: Failed');
      expect(sentBody()).toContain('Deployment');
    });

    it('does nothing for a status with no notification logic', async () => {
      const result = await projectNotifyAfterScript(
        baseOptions({ ciJobStage: 'deploy-unpackaged', ciJobStatus: 'running' }),
      );

      expect(result.sent).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
