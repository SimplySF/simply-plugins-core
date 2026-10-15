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
import { buildDomainProcessBindingXml, patchDomainProcessBindingXml } from './at4dxDomainProcessBuildXml.js';
import {
  DOMAIN_PROCESS_BINDING_LOCAL_OBJECT_NAME,
  DomainProcessBindingWriteError,
  type AmbiguousDomainProcessBindingRecord,
  type At4dxDomainProcessBindingCreateResult,
  type At4dxDomainProcessBindingUpdateResult,
  type CreateDomainProcessBindingInput,
  type CreateDomainProcessBindingTarget,
  type DomainProcessBindingIssue,
  type DomainProcessBindingSObjectField,
  type MalformedDomainProcessBindingRecord,
  type ProcessContext,
  type RawDomainProcessBindingRecord,
  type TriggerOperation,
  type UpdateDomainProcessBindingInput,
  type UpdateDomainProcessBindingTarget,
} from './at4dxDomainProcessBindingTypes.js';
import { deployMetadataFile } from './at4dxDomainProcessDeploy.js';
import { scanLocalDomainProcessBindings } from './at4dxDomainProcessLocalScan.js';
import { scanOrgDomainProcessBindings } from './at4dxDomainProcessOrgScan.js';
import { validateDomainProcessBindings } from './at4dxDomainProcessResolve.js';
import { UnpatchableValueShapeError } from './customMetadataXml.js';

import { developerNameIssue } from './developerName.js';
const DEFAULT_WAIT = Duration.minutes(33);

/** @throws {DomainProcessBindingWriteError} `invalid-developer-name` if `developerName` doesn't match Custom Metadata's DeveloperName rules. */
function checkDeveloperName(developerName: string): void {
  if (developerNameIssue(developerName)) {
    throw new DomainProcessBindingWriteError(
      'invalid-developer-name',
      `"${developerName}" is not a valid DeveloperName: it must start with a letter, contain only letters, numbers, and single underscores, not end with an underscore, and be 40 characters or fewer.`,
    );
  }
}

/** @throws {DomainProcessBindingWriteError} `label-too-long` if `label` exceeds Custom Metadata's 40-character label limit. */
function checkLabel(label: string): void {
  if (label.length > 40) {
    throw new DomainProcessBindingWriteError('label-too-long', `Label "${label}" exceeds the 40-character limit.`);
  }
}

/**
 * A binding can only be routed by exactly one of `triggerOperation`/`domainMethodToken`, and only the
 * one matching `processContext` — this is a usage error (the caller gave a contradictory combination),
 * distinct from `validateDomainProcessBindings`'s `missing-context-field` rule, which catches the
 * *softer* case of the matching field being entirely absent (recoverable with `force`).
 *
 * @throws {DomainProcessBindingWriteError} `context-field-mismatch` on any contradiction.
 */
function checkContextFieldMismatch(
  processContext: ProcessContext,
  triggerOperation: TriggerOperation | undefined,
  domainMethodToken: string | undefined,
): void {
  if (triggerOperation !== undefined && domainMethodToken !== undefined) {
    throw new DomainProcessBindingWriteError(
      'context-field-mismatch',
      'Only one of triggerOperation/domainMethodToken may be set on a single binding.',
    );
  }
  if (processContext === 'TriggerExecution' && domainMethodToken !== undefined) {
    throw new DomainProcessBindingWriteError(
      'context-field-mismatch',
      'domainMethodToken cannot be set when processContext is TriggerExecution.',
    );
  }
  if (processContext === 'DomainMethodExecution' && triggerOperation !== undefined) {
    throw new DomainProcessBindingWriteError(
      'context-field-mismatch',
      'triggerOperation cannot be set when processContext is DomainMethodExecution.',
    );
  }
}

type ScanContext = {
  records: RawDomainProcessBindingRecord[];
  malformed: MalformedDomainProcessBindingRecord[];
  ambiguous: AmbiguousDomainProcessBindingRecord[];
  source: string;
  /** `true` when writing/deploying should target local source at `localDir` instead of `connection`. */
  isLocal: boolean;
};

/**
 * Scans for `create`'s validation context. Unlike `set`/`list`/`validate`, an empty local scan is not
 * `at4dx-not-detected` here — it's the ordinary "this is the first binding ever created" case. Only an
 * org missing the Custom Metadata Type entirely is a hard stop, since deploying against it would be
 * pointless.
 */
async function scanCreateContext(target: CreateDomainProcessBindingTarget): Promise<ScanContext> {
  if (target.sourceDir) {
    const { records, malformed, ambiguous } = scanLocalDomainProcessBindings([target.sourceDir]);
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgDomainProcessBindings(connection);
  if (scanResult.missing) {
    throw new DomainProcessBindingWriteError(
      'at4dx-not-detected',
      "AT4DX's Trigger Action Framework doesn't appear to be present in this org: the DomainProcessBinding__mdt Custom Metadata Type wasn't found.",
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    ambiguous: scanResult.ambiguous,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/**
 * Scans for `update`'s lookup, matching `list`/`validate`'s "empty local scan means AT4DX isn't here"
 * heuristic — unlike `create`, `update` always expects to find an existing record, so an empty scan
 * can't be the good case.
 */
async function scanUpdateContext(target: UpdateDomainProcessBindingTarget): Promise<ScanContext> {
  if (target.sourceDirs && target.sourceDirs.length > 0) {
    const { records, malformed, ambiguous } = scanLocalDomainProcessBindings(target.sourceDirs);
    if (records.length === 0 && malformed.length === 0) {
      throw new DomainProcessBindingWriteError(
        'at4dx-not-detected',
        "AT4DX's Trigger Action Framework doesn't appear to be present in this source: the DomainProcessBinding__mdt Custom Metadata Type wasn't found.",
      );
    }
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgDomainProcessBindings(connection);
  if (scanResult.missing) {
    throw new DomainProcessBindingWriteError(
      'at4dx-not-detected',
      "AT4DX's Trigger Action Framework doesn't appear to be present in this org: the DomainProcessBinding__mdt Custom Metadata Type wasn't found.",
    );
  }
  return {
    records: scanResult.records,
    malformed: scanResult.malformed,
    ambiguous: scanResult.ambiguous,
    source: connection.getUsername() ?? 'org',
    isLocal: false,
  };
}

/** @throws {DomainProcessBindingWriteError} `validation-failed` (carrying `issues`) when any issue is `error`-severity and `force` isn't set. */
function checkValidation(issues: DomainProcessBindingIssue[], force: boolean | undefined): void {
  if (!force && issues.some((issue) => issue.severity === 'error')) {
    throw new DomainProcessBindingWriteError(
      'validation-failed',
      'Writing this binding would introduce a wiring problem AT4DX validation already knows how to catch; pass force to write anyway.',
      issues,
    );
  }
}

/**
 * Writes `xml` to `localFilePath` when given, otherwise to a fresh temp directory (removed afterward),
 * then deploys it when `connection` is given. Shared tail end of `createDomainProcessBinding`/
 * `updateDomainProcessBinding` — everything before this point differs (locate-or-reject, merge), but the
 * serialize/write/deploy sequence is identical.
 *
 * @throws {DomainProcessBindingWriteError} `deploy-failed` if a deploy was requested and didn't succeed. The local write (when `localFilePath` was given) is left in place either way — only the deploy step is undone-by-never-having-happened.
 */
async function writeAndDeploy(params: {
  developerName: string;
  sobject: string;
  xml: string;
  issues: DomainProcessBindingIssue[];
  localFilePath?: string;
  connection?: Connection;
  wait?: Duration;
}): Promise<At4dxDomainProcessBindingCreateResult> {
  let filePath = params.localFilePath;
  let tempDir: string | undefined;

  if (filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } else {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-aep-domain-process-binding-'));
    const dir = path.join(tempDir, 'customMetadata');
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${DOMAIN_PROCESS_BINDING_LOCAL_OBJECT_NAME}.${params.developerName}.md-meta.xml`);
  }

  await fs.writeFile(filePath, params.xml, 'utf-8');

  let deploy: At4dxDomainProcessBindingCreateResult['deploy'];
  try {
    if (params.connection) {
      const deployResult = await deployMetadataFile(params.connection, filePath, params.wait ?? DEFAULT_WAIT);
      if (!deployResult.success) {
        const summary =
          deployResult.failures
            .map((failure) => `${failure.fullName} (${failure.type}): ${failure.error}`)
            .join('; ') || deployResult.status;
        throw new DomainProcessBindingWriteError('deploy-failed', `Failed to deploy the binding: ${summary}`);
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
    sobject: params.sobject,
    filePath: tempDir ? undefined : filePath,
    deploy,
    issues: params.issues,
  };
}

/**
 * Creates a new `DomainProcessBinding__mdt` record: validates the inputs, checks the `DeveloperName`
 * doesn't already exist in the scanned scope, runs it through `validateDomainProcessBindings` alongside
 * everything already scanned, then writes (and optionally deploys) the generated `.md-meta.xml`.
 *
 * See docs/design/0012-at4dx-domain-process-binding-create-set.md for the full behavior contract.
 *
 * @throws {DomainProcessBindingWriteError} See the error codes in `DomainProcessBindingWriteErrorCode`.
 */
export async function createDomainProcessBinding(
  input: CreateDomainProcessBindingInput,
  target: CreateDomainProcessBindingTarget,
): Promise<At4dxDomainProcessBindingCreateResult> {
  if (!target.sourceDir && !target.connection) {
    throw new DomainProcessBindingWriteError(
      'source-or-target-required',
      'At least one of sourceDir or connection is required.',
    );
  }

  checkDeveloperName(input.developerName);
  const label = input.label ?? input.developerName;
  checkLabel(label);
  checkContextFieldMismatch(input.processContext, input.triggerOperation, input.domainMethodToken);

  const scan = await scanCreateContext(target);

  if (
    scan.records.some((record) => record.developerName === input.developerName) ||
    scan.malformed.some((record) => record.developerName === input.developerName)
  ) {
    throw new DomainProcessBindingWriteError(
      'developer-name-already-exists',
      `A DomainProcessBinding__mdt record named "${input.developerName}" already exists in ${scan.source}.`,
    );
  }

  const sobjectField: DomainProcessBindingSObjectField = input.sobjectAlternate ? 'alternate' : 'primary';
  const candidate: RawDomainProcessBindingRecord = {
    developerName: input.developerName,
    label,
    sobject: input.sobject,
    sobjectField,
    processContext: input.processContext,
    triggerOperation: input.triggerOperation,
    domainMethodToken: input.domainMethodToken,
    type: input.type,
    classToInject: input.classToInject,
    order: input.order,
    isActive: input.isActive ?? true,
    executeAsynchronous: input.executeAsynchronous ?? false,
    logicalInverse: input.logicalInverse ?? false,
    preventRecursive: input.preventRecursive ?? false,
    description: input.description,
    source: scan.source,
  };

  const issues = validateDomainProcessBindings([...scan.records, candidate], {
    malformed: scan.malformed,
    ambiguous: scan.ambiguous,
  });
  checkValidation(issues, input.force);

  const xml = buildDomainProcessBindingXml(candidate, { label });
  const localFilePath = target.sourceDir
    ? path.join(
        target.sourceDir,
        'customMetadata',
        `${DOMAIN_PROCESS_BINDING_LOCAL_OBJECT_NAME}.${input.developerName}.md-meta.xml`,
      )
    : undefined;

  return writeAndDeploy({
    developerName: input.developerName,
    sobject: input.sobject,
    xml,
    issues,
    localFilePath,
    connection: target.connection,
    wait: target.wait,
  });
}

/**
 * Merges `input`'s given fields onto `existing` — everything `input` leaves `undefined` keeps its
 * current value. `triggerOperation`/`domainMethodToken` are handled specially: giving one explicitly
 * clears the other (rather than leaving a stale opposite-context field behind when switching
 * `processContext`), which is also why the final `checkContextFieldMismatch` call happens here rather
 * than against raw `input` — it needs the post-merge, effective values.
 *
 * @throws {DomainProcessBindingWriteError} `context-field-mismatch` — see `checkContextFieldMismatch`.
 */
function mergeDomainProcessBindingRecord(
  existing: RawDomainProcessBindingRecord,
  input: UpdateDomainProcessBindingInput,
): RawDomainProcessBindingRecord {
  let triggerOperation = existing.triggerOperation;
  let domainMethodToken = existing.domainMethodToken;
  if (input.triggerOperation !== undefined) {
    triggerOperation = input.triggerOperation;
    if (input.domainMethodToken === undefined) {
      domainMethodToken = undefined;
    }
  }
  if (input.domainMethodToken !== undefined) {
    domainMethodToken = input.domainMethodToken;
    if (input.triggerOperation === undefined) {
      triggerOperation = undefined;
    }
  }

  let sobjectField = existing.sobjectField;
  if (input.sobjectAlternate !== undefined) {
    sobjectField = input.sobjectAlternate ? 'alternate' : 'primary';
  }

  const processContext = input.processContext ?? existing.processContext;
  checkContextFieldMismatch(processContext, triggerOperation, domainMethodToken);

  return {
    ...existing,
    label: input.label ?? existing.label,
    sobject: input.sobject ?? existing.sobject,
    sobjectField,
    processContext,
    triggerOperation,
    domainMethodToken,
    type: input.type ?? existing.type,
    classToInject: input.classToInject ?? existing.classToInject,
    order: input.order ?? existing.order,
    isActive: input.isActive ?? existing.isActive,
    executeAsynchronous: input.executeAsynchronous ?? existing.executeAsynchronous,
    logicalInverse: input.logicalInverse ?? existing.logicalInverse,
    preventRecursive: input.preventRecursive ?? existing.preventRecursive,
    description: input.description ?? existing.description,
  };
}

/**
 * Updates an existing `DomainProcessBinding__mdt` record: locates it by `DeveloperName`, merges in only
 * the fields `input` actually sets (everything else keeps its current value, including which SObject
 * reference field it uses — see `DomainProcessBindingSObjectField`), re-validates the result, then
 * rewrites (and optionally deploys) the `.md-meta.xml`.
 *
 * See docs/design/0012-at4dx-domain-process-binding-create-set.md for the full behavior contract and
 * docs/design/0018-domain-process-binding-set-rename-to-update.md for the `set` → `update` rename.
 *
 * @throws {DomainProcessBindingWriteError} See the error codes in `DomainProcessBindingWriteErrorCode`.
 */
export async function updateDomainProcessBinding(
  input: UpdateDomainProcessBindingInput,
  target: UpdateDomainProcessBindingTarget,
): Promise<At4dxDomainProcessBindingUpdateResult> {
  if ((!target.sourceDirs || target.sourceDirs.length === 0) && !target.connection) {
    throw new DomainProcessBindingWriteError(
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
    throw new DomainProcessBindingWriteError(
      'no-fields-to-update',
      'At least one field besides developerName must be given to update.',
    );
  }

  const scan = await scanUpdateContext(target);
  const existing = scan.records.find((record) => record.developerName === input.developerName);
  if (!existing) {
    throw new DomainProcessBindingWriteError(
      'developer-name-not-found',
      `No DomainProcessBinding__mdt record named "${input.developerName}" was found in ${scan.source}.`,
    );
  }

  const merged = mergeDomainProcessBindingRecord(existing, input);

  const otherRecords = scan.records.filter((record) => record.developerName !== input.developerName);
  const issues = validateDomainProcessBindings([...otherRecords, merged], {
    malformed: scan.malformed,
    ambiguous: scan.ambiguous,
  });
  checkValidation(issues, input.force);

  let xml: string;
  if (scan.isLocal) {
    const existingXml = await fs.readFile(existing.filePath!, 'utf-8');
    try {
      xml = patchDomainProcessBindingXml(existingXml, existing, merged, { label: merged.label });
    } catch (err) {
      if (!(err instanceof UnpatchableValueShapeError)) {
        throw err;
      }
      xml = buildDomainProcessBindingXml(merged, { label: merged.label });
    }
  } else {
    xml = buildDomainProcessBindingXml(merged, { label: merged.label });
  }

  return writeAndDeploy({
    developerName: input.developerName,
    sobject: merged.sobject,
    xml,
    issues,
    localFilePath: scan.isLocal ? existing.filePath : undefined,
    connection: target.connection,
    wait: target.wait,
  });
}
