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

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Connection } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  buildPlatformEventSubscriptionXml,
  patchPlatformEventSubscriptionXml,
} from './at4dxPlatformEventSubscriptionBuildXml.js';
import {
  PLATFORM_EVENT_SUBSCRIPTION_LOCAL_OBJECT_NAME,
  PlatformEventSubscriptionWriteError,
  type At4dxPlatformEventSubscriptionCreateResult,
  type At4dxPlatformEventSubscriptionUpdateResult,
  type CreatePlatformEventSubscriptionInput,
  type CreatePlatformEventSubscriptionTarget,
  type MalformedPlatformEventSubscriptionRecord,
  type PlatformEventSubscriptionIssue,
  type RawPlatformEventSubscriptionRecord,
  type UpdatePlatformEventSubscriptionInput,
  type UpdatePlatformEventSubscriptionTarget,
} from './at4dxPlatformEventSubscriptionTypes.js';
import { deployMetadataFile } from './at4dxDomainProcessDeploy.js';
import { scanLocalPlatformEventSubscriptions } from './at4dxPlatformEventSubscriptionLocalScan.js';
import { scanOrgPlatformEventSubscriptions } from './at4dxPlatformEventSubscriptionOrgScan.js';
import { validatePlatformEventSubscriptions } from './at4dxPlatformEventSubscriptionResolve.js';
import { UnpatchableValueShapeError } from './customMetadataXml.js';

import { developerNameIssue } from './developerName.js';
const DEFAULT_WAIT = Duration.minutes(33);

/** @throws {PlatformEventSubscriptionWriteError} `invalid-developer-name` if `developerName` doesn't match Custom Metadata's DeveloperName rules. */
function checkDeveloperName(developerName: string): void {
  if (developerNameIssue(developerName)) {
    throw new PlatformEventSubscriptionWriteError(
      'invalid-developer-name',
      `"${developerName}" is not a valid DeveloperName: it must start with a letter, contain only letters, numbers, and single underscores, not end with an underscore, and be 40 characters or fewer.`,
    );
  }
}

/** @throws {PlatformEventSubscriptionWriteError} `label-too-long` if `label` exceeds Custom Metadata's 40-character label limit. */
function checkLabel(label: string): void {
  if (label.length > 40) {
    throw new PlatformEventSubscriptionWriteError('label-too-long', `Label "${label}" exceeds the 40-character limit.`);
  }
}

type ScanContext = {
  records: RawPlatformEventSubscriptionRecord[];
  malformed: MalformedPlatformEventSubscriptionRecord[];
  source: string;
  /** `true` when writing/deploying should target local source at `localDir` instead of `connection`. */
  isLocal: boolean;
};

/**
 * Scans for `createPlatformEventSubscription`'s validation context. Unlike
 * `updatePlatformEventSubscription`/`list`/`validate`, an empty local scan is not `at4dx-not-detected`
 * here — it's the ordinary "this is the first platform event subscription ever created" case. Only an
 * org missing the Custom Metadata Type entirely is a hard stop, since deploying against it would be
 * pointless.
 */
async function scanCreateContext(target: CreatePlatformEventSubscriptionTarget): Promise<ScanContext> {
  if (target.sourceDir) {
    const { records, malformed } = scanLocalPlatformEventSubscriptions([target.sourceDir]);
    return { records, malformed, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgPlatformEventSubscriptions(connection);
  if (scanResult.missing) {
    throw new PlatformEventSubscriptionWriteError(
      'at4dx-not-detected',
      "AT4DX doesn't appear to be present in this org: the PlatformEvents_Subscription__mdt Custom Metadata Type wasn't found.",
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/**
 * Scans for `updatePlatformEventSubscription`'s lookup, matching `list`/`validate`'s "empty local scan
 * means AT4DX isn't here" heuristic — unlike `createPlatformEventSubscription`,
 * `updatePlatformEventSubscription` always expects to find an existing record.
 */
async function scanUpdateContext(target: UpdatePlatformEventSubscriptionTarget): Promise<ScanContext> {
  if (target.sourceDirs && target.sourceDirs.length > 0) {
    const { records, malformed } = scanLocalPlatformEventSubscriptions(target.sourceDirs);
    if (records.length === 0 && malformed.length === 0) {
      throw new PlatformEventSubscriptionWriteError(
        'at4dx-not-detected',
        "AT4DX doesn't appear to be present in this source: the PlatformEvents_Subscription__mdt Custom Metadata Type wasn't found.",
      );
    }
    return { records, malformed, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgPlatformEventSubscriptions(connection);
  if (scanResult.missing) {
    throw new PlatformEventSubscriptionWriteError(
      'at4dx-not-detected',
      "AT4DX doesn't appear to be present in this org: the PlatformEvents_Subscription__mdt Custom Metadata Type wasn't found.",
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/** @throws {PlatformEventSubscriptionWriteError} `validation-failed` (carrying `issues`) when any issue is `error`-severity and `force` isn't set. */
function checkValidation(issues: PlatformEventSubscriptionIssue[], force: boolean | undefined): void {
  if (!force && issues.some((issue) => issue.severity === 'error')) {
    throw new PlatformEventSubscriptionWriteError(
      'validation-failed',
      'Writing this record would introduce a wiring problem AT4DX validation already knows how to catch; pass force to write anyway.',
      issues,
    );
  }
}

/**
 * Writes `xml` to `localFilePath` when given, otherwise to a fresh temp directory (removed afterward),
 * then deploys it when `connection` is given. Shared tail end of `createPlatformEventSubscription`/
 * `updatePlatformEventSubscription` — mirrors `at4dxFieldSetInclusionWrite.ts`'s `writeAndDeploy`.
 *
 * @throws {PlatformEventSubscriptionWriteError} `deploy-failed` if a deploy was requested and didn't succeed. The local write (when `localFilePath` was given) is left in place either way — only the deploy step is undone-by-never-having-happened.
 */
async function writeAndDeploy(params: {
  developerName: string;
  eventBus: string;
  consumer: string;
  xml: string;
  issues: PlatformEventSubscriptionIssue[];
  localFilePath?: string;
  connection?: Connection;
  wait?: Duration;
}): Promise<At4dxPlatformEventSubscriptionCreateResult> {
  let filePath = params.localFilePath;
  let tempDir: string | undefined;

  if (filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } else {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-aep-platform-event-subscription-'));
    const dir = path.join(tempDir, 'customMetadata');
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${PLATFORM_EVENT_SUBSCRIPTION_LOCAL_OBJECT_NAME}.${params.developerName}.md-meta.xml`);
  }

  await fs.writeFile(filePath, params.xml, 'utf-8');

  let deploy: At4dxPlatformEventSubscriptionCreateResult['deploy'];
  try {
    if (params.connection) {
      const deployResult = await deployMetadataFile(params.connection, filePath, params.wait ?? DEFAULT_WAIT);
      if (!deployResult.success) {
        const summary =
          deployResult.failures
            .map((failure) => `${failure.fullName} (${failure.type}): ${failure.error}`)
            .join('; ') || deployResult.status;
        throw new PlatformEventSubscriptionWriteError('deploy-failed', `Failed to deploy the record: ${summary}`);
      }
      deploy = { id: deployResult.id, status: deployResult.status, success: deployResult.success };
    }
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  return {
    developerName: params.developerName,
    eventBus: params.eventBus,
    consumer: params.consumer,
    filePath: tempDir ? undefined : filePath,
    deploy,
    issues: params.issues,
  };
}

/**
 * Creates a new `PlatformEvents_Subscription__mdt` record: validates the inputs, checks the
 * `DeveloperName` doesn't already exist in the scanned scope, runs it through
 * `validatePlatformEventSubscriptions` alongside everything already scanned, then writes (and
 * optionally deploys) the generated `.md-meta.xml`.
 *
 * See docs/design/0025-at4dx-platform-event-subscription-support.md for the full behavior contract.
 *
 * @throws {PlatformEventSubscriptionWriteError} See the error codes in `PlatformEventSubscriptionWriteErrorCode`.
 */
export async function createPlatformEventSubscription(
  input: CreatePlatformEventSubscriptionInput,
  target: CreatePlatformEventSubscriptionTarget,
): Promise<At4dxPlatformEventSubscriptionCreateResult> {
  if (!target.sourceDir && !target.connection) {
    throw new PlatformEventSubscriptionWriteError(
      'source-or-target-required',
      'At least one of sourceDir or connection is required.',
    );
  }

  checkDeveloperName(input.developerName);
  const label = input.label ?? input.developerName;
  checkLabel(label);

  const scan = await scanCreateContext(target);

  if (
    scan.records.some((record) => record.developerName === input.developerName) ||
    scan.malformed.some((record) => record.developerName === input.developerName)
  ) {
    throw new PlatformEventSubscriptionWriteError(
      'developer-name-already-exists',
      `A PlatformEvents_Subscription__mdt record named "${input.developerName}" already exists in ${scan.source}.`,
    );
  }

  const candidate: RawPlatformEventSubscriptionRecord = {
    developerName: input.developerName,
    label,
    eventBus: input.eventBus,
    consumer: input.consumer,
    eventCategory: input.eventCategory,
    event: input.event,
    matcherRule: input.matcherRule,
    isActive: input.isActive ?? true,
    executeSynchronous: input.executeSynchronous ?? false,
    source: scan.source,
  };

  const issues = validatePlatformEventSubscriptions({
    records: [...scan.records, candidate],
    malformed: scan.malformed,
  });
  checkValidation(issues, input.force);

  const xml = buildPlatformEventSubscriptionXml(candidate, { label });
  const localFilePath = target.sourceDir
    ? path.join(
        target.sourceDir,
        'customMetadata',
        `${PLATFORM_EVENT_SUBSCRIPTION_LOCAL_OBJECT_NAME}.${input.developerName}.md-meta.xml`,
      )
    : undefined;

  return writeAndDeploy({
    developerName: input.developerName,
    eventBus: input.eventBus,
    consumer: input.consumer,
    xml,
    issues,
    localFilePath,
    connection: target.connection,
    wait: target.wait,
  });
}

/**
 * Merges `input`'s given fields onto `existing` — everything `input` leaves `undefined` keeps its
 * current value.
 */
function mergePlatformEventSubscriptionRecord(
  existing: RawPlatformEventSubscriptionRecord,
  input: UpdatePlatformEventSubscriptionInput,
): RawPlatformEventSubscriptionRecord {
  return {
    ...existing,
    label: input.label ?? existing.label,
    eventBus: input.eventBus ?? existing.eventBus,
    consumer: input.consumer ?? existing.consumer,
    eventCategory: input.eventCategory ?? existing.eventCategory,
    event: input.event ?? existing.event,
    matcherRule: input.matcherRule ?? existing.matcherRule,
    isActive: input.isActive ?? existing.isActive,
    executeSynchronous: input.executeSynchronous ?? existing.executeSynchronous,
  };
}

/**
 * Updates an existing `PlatformEvents_Subscription__mdt` record: locates it by `DeveloperName`, merges
 * in only the fields `input` actually sets (everything else keeps its current value), re-validates the
 * result, then rewrites (and optionally deploys) the `.md-meta.xml`.
 *
 * `Consumer__c` is a value change like any other here, not the create-plus-delete dance `DeveloperName`
 * requires — it reads as the record's identity in the UI (see docs/design/0025's "What makes this
 * family shaped differently" section), but `DeveloperName` remains the record's actual key.
 *
 * See docs/design/0025-at4dx-platform-event-subscription-support.md for the full behavior contract.
 *
 * @throws {PlatformEventSubscriptionWriteError} See the error codes in `PlatformEventSubscriptionWriteErrorCode`.
 */
export async function updatePlatformEventSubscription(
  input: UpdatePlatformEventSubscriptionInput,
  target: UpdatePlatformEventSubscriptionTarget,
): Promise<At4dxPlatformEventSubscriptionUpdateResult> {
  if ((!target.sourceDirs || target.sourceDirs.length === 0) && !target.connection) {
    throw new PlatformEventSubscriptionWriteError(
      'source-or-target-required',
      'At least one of sourceDirs or connection is required.',
    );
  }

  checkDeveloperName(input.developerName);
  if (input.label !== undefined) {
    checkLabel(input.label);
  }

  const hasFieldUpdate = Object.entries(input).some(
    ([key, value]) => key !== 'developerName' && key !== 'force' && value !== undefined,
  );
  if (!hasFieldUpdate) {
    throw new PlatformEventSubscriptionWriteError(
      'no-fields-to-update',
      'At least one field besides developerName must be given to update.',
    );
  }

  const scan = await scanUpdateContext(target);
  const existing = scan.records.find((record) => record.developerName === input.developerName);
  if (!existing) {
    throw new PlatformEventSubscriptionWriteError(
      'developer-name-not-found',
      `No PlatformEvents_Subscription__mdt record named "${input.developerName}" was found in ${scan.source}.`,
    );
  }

  const merged = mergePlatformEventSubscriptionRecord(existing, input);

  const otherRecords = scan.records.filter((record) => record.developerName !== input.developerName);
  const issues = validatePlatformEventSubscriptions({
    records: [...otherRecords, merged],
    malformed: scan.malformed,
  });
  checkValidation(issues, input.force);

  let xml: string;
  if (scan.isLocal) {
    const existingXml = await fs.readFile(existing.filePath!, 'utf-8');
    try {
      xml = patchPlatformEventSubscriptionXml(existingXml, existing, merged, { label: merged.label });
    } catch (err) {
      if (!(err instanceof UnpatchableValueShapeError)) {
        throw err;
      }
      xml = buildPlatformEventSubscriptionXml(merged, { label: merged.label });
    }
  } else {
    xml = buildPlatformEventSubscriptionXml(merged, { label: merged.label });
  }

  return writeAndDeploy({
    developerName: input.developerName,
    eventBus: merged.eventBus,
    consumer: merged.consumer,
    xml,
    issues,
    localFilePath: scan.isLocal ? existing.filePath : undefined,
    connection: target.connection,
    wait: target.wait,
  });
}
