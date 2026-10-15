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
import { buildFieldSetInclusionXml, patchFieldSetInclusionXml } from './at4dxFieldSetInclusionBuildXml.js';
import {
  FIELD_SET_INCLUSION_LOCAL_OBJECT_NAME,
  FieldSetInclusionWriteError,
  type AmbiguousFieldSetInclusionRecord,
  type At4dxFieldSetInclusionCreateResult,
  type At4dxFieldSetInclusionUpdateResult,
  type CreateFieldSetInclusionInput,
  type CreateFieldSetInclusionTarget,
  type FieldSetInclusionIssue,
  type MalformedFieldSetInclusionRecord,
  type RawFieldSetInclusionRecord,
  type UpdateFieldSetInclusionInput,
  type UpdateFieldSetInclusionTarget,
} from './at4dxFieldSetInclusionTypes.js';
import { deployMetadataFile } from './at4dxDomainProcessDeploy.js';
import { scanLocalFieldSetInclusions } from './at4dxFieldSetInclusionLocalScan.js';
import { scanOrgFieldSetInclusions } from './at4dxFieldSetInclusionOrgScan.js';
import { validateFieldSetInclusions } from './at4dxFieldSetInclusionResolve.js';
import { UnpatchableValueShapeError } from './customMetadataXml.js';

import { developerNameIssue } from './developerName.js';
const DEFAULT_WAIT = Duration.minutes(33);

/** @throws {FieldSetInclusionWriteError} `invalid-developer-name` if `developerName` doesn't match Custom Metadata's DeveloperName rules. */
function checkDeveloperName(developerName: string): void {
  if (developerNameIssue(developerName)) {
    throw new FieldSetInclusionWriteError(
      'invalid-developer-name',
      `"${developerName}" is not a valid DeveloperName: it must start with a letter, contain only letters, numbers, and single underscores, not end with an underscore, and be 40 characters or fewer.`,
    );
  }
}

/** @throws {FieldSetInclusionWriteError} `label-too-long` if `label` exceeds Custom Metadata's 40-character label limit. */
function checkLabel(label: string): void {
  if (label.length > 40) {
    throw new FieldSetInclusionWriteError('label-too-long', `Label "${label}" exceeds the 40-character limit.`);
  }
}

type ScanContext = {
  records: RawFieldSetInclusionRecord[];
  malformed: MalformedFieldSetInclusionRecord[];
  ambiguous: AmbiguousFieldSetInclusionRecord[];
  source: string;
  /** `true` when writing/deploying should target local source at `localDir` instead of `connection`. */
  isLocal: boolean;
};

/**
 * Scans for `createFieldSetInclusion`'s validation context. Unlike `updateFieldSetInclusion`/`list`/
 * `validate`, an empty local scan is not `at4dx-not-detected` here — it's the ordinary "this is the
 * first field set inclusion ever created" case. Only an org missing the Custom Metadata Type entirely
 * is a hard stop, since deploying against it would be pointless.
 */
async function scanCreateContext(target: CreateFieldSetInclusionTarget): Promise<ScanContext> {
  if (target.sourceDir) {
    const { records, malformed, ambiguous } = scanLocalFieldSetInclusions([target.sourceDir]);
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgFieldSetInclusions(connection);
  if (scanResult.missing) {
    throw new FieldSetInclusionWriteError(
      'at4dx-not-detected',
      "AT4DX doesn't appear to be present in this org: the SelectorConfig_FieldSetInclusion__mdt Custom Metadata Type wasn't found.",
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
 * Scans for `updateFieldSetInclusion`'s lookup, matching `list`/`validate`'s "empty local scan means
 * AT4DX isn't here" heuristic — unlike `createFieldSetInclusion`, `updateFieldSetInclusion` always
 * expects to find an existing record.
 */
async function scanUpdateContext(target: UpdateFieldSetInclusionTarget): Promise<ScanContext> {
  if (target.sourceDirs && target.sourceDirs.length > 0) {
    const { records, malformed, ambiguous } = scanLocalFieldSetInclusions(target.sourceDirs);
    if (records.length === 0 && malformed.length === 0) {
      throw new FieldSetInclusionWriteError(
        'at4dx-not-detected',
        "AT4DX doesn't appear to be present in this source: the SelectorConfig_FieldSetInclusion__mdt Custom Metadata Type wasn't found.",
      );
    }
    return { records, malformed, ambiguous, source: 'local', isLocal: true };
  }

  const connection = target.connection!;
  const scanResult = await scanOrgFieldSetInclusions(connection);
  if (scanResult.missing) {
    throw new FieldSetInclusionWriteError(
      'at4dx-not-detected',
      "AT4DX doesn't appear to be present in this org: the SelectorConfig_FieldSetInclusion__mdt Custom Metadata Type wasn't found.",
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

/** @throws {FieldSetInclusionWriteError} `validation-failed` (carrying `issues`) when any issue is `error`-severity and `force` isn't set. */
function checkValidation(issues: FieldSetInclusionIssue[], force: boolean | undefined): void {
  if (!force && issues.some((issue) => issue.severity === 'error')) {
    throw new FieldSetInclusionWriteError(
      'validation-failed',
      'Writing this record would introduce a wiring problem AT4DX validation already knows how to catch; pass force to write anyway.',
      issues,
    );
  }
}

/**
 * Writes `xml` to `localFilePath` when given, otherwise to a fresh temp directory (removed afterward),
 * then deploys it when `connection` is given. Shared tail end of `createFieldSetInclusion`/
 * `updateFieldSetInclusion` — mirrors `at4dxDomainProcessWrite.ts`'s `writeAndDeploy`.
 *
 * @throws {FieldSetInclusionWriteError} `deploy-failed` if a deploy was requested and didn't succeed. The local write (when `localFilePath` was given) is left in place either way — only the deploy step is undone-by-never-having-happened.
 */
async function writeAndDeploy(params: {
  developerName: string;
  sobject: string;
  xml: string;
  issues: FieldSetInclusionIssue[];
  localFilePath?: string;
  connection?: Connection;
  wait?: Duration;
}): Promise<At4dxFieldSetInclusionCreateResult> {
  let filePath = params.localFilePath;
  let tempDir: string | undefined;

  if (filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } else {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simply-aep-field-set-inclusion-'));
    const dir = path.join(tempDir, 'customMetadata');
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${FIELD_SET_INCLUSION_LOCAL_OBJECT_NAME}.${params.developerName}.md-meta.xml`);
  }

  await fs.writeFile(filePath, params.xml, 'utf-8');

  let deploy: At4dxFieldSetInclusionCreateResult['deploy'];
  try {
    if (params.connection) {
      const deployResult = await deployMetadataFile(params.connection, filePath, params.wait ?? DEFAULT_WAIT);
      if (!deployResult.success) {
        const summary =
          deployResult.failures
            .map((failure) => `${failure.fullName} (${failure.type}): ${failure.error}`)
            .join('; ') || deployResult.status;
        throw new FieldSetInclusionWriteError('deploy-failed', `Failed to deploy the record: ${summary}`);
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
 * Creates a new `SelectorConfig_FieldSetInclusion__mdt` record: validates the inputs, checks the
 * `DeveloperName` doesn't already exist in the scanned scope, runs it through `validateFieldSetInclusions`
 * alongside everything already scanned, then writes (and optionally deploys) the generated `.md-meta.xml`.
 *
 * See docs/design/0016-at4dx-selector-config-field-set-inclusion.md for the full behavior contract.
 *
 * @throws {FieldSetInclusionWriteError} See the error codes in `FieldSetInclusionWriteErrorCode`.
 */
export async function createFieldSetInclusion(
  input: CreateFieldSetInclusionInput,
  target: CreateFieldSetInclusionTarget,
): Promise<At4dxFieldSetInclusionCreateResult> {
  if (!target.sourceDir && !target.connection) {
    throw new FieldSetInclusionWriteError(
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
    throw new FieldSetInclusionWriteError(
      'developer-name-already-exists',
      `A SelectorConfig_FieldSetInclusion__mdt record named "${input.developerName}" already exists in ${scan.source}.`,
    );
  }

  const candidate: RawFieldSetInclusionRecord = {
    developerName: input.developerName,
    label,
    sobject: input.sobject,
    sobjectField: input.sobjectAlternate ? 'alternate' : 'primary',
    fieldsetName: input.fieldsetName,
    isActive: input.isActive ?? true,
    source: scan.source,
  };

  const issues = validateFieldSetInclusions([...scan.records, candidate], {
    malformed: scan.malformed,
    ambiguous: scan.ambiguous,
  });
  checkValidation(issues, input.force);

  const xml = buildFieldSetInclusionXml(candidate, { label });
  const localFilePath = target.sourceDir
    ? path.join(
        target.sourceDir,
        'customMetadata',
        `${FIELD_SET_INCLUSION_LOCAL_OBJECT_NAME}.${input.developerName}.md-meta.xml`,
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
 * current value.
 */
function mergeFieldSetInclusionRecord(
  existing: RawFieldSetInclusionRecord,
  input: UpdateFieldSetInclusionInput,
): RawFieldSetInclusionRecord {
  let sobjectField = existing.sobjectField;
  if (input.sobjectAlternate !== undefined) {
    sobjectField = input.sobjectAlternate ? 'alternate' : 'primary';
  }

  return {
    ...existing,
    label: input.label ?? existing.label,
    sobject: input.sobject ?? existing.sobject,
    sobjectField,
    fieldsetName: input.fieldsetName ?? existing.fieldsetName,
    isActive: input.isActive ?? existing.isActive,
  };
}

/**
 * Updates an existing `SelectorConfig_FieldSetInclusion__mdt` record: locates it by `DeveloperName`,
 * merges in only the fields `input` actually sets (everything else keeps its current value, including
 * which SObject reference field it uses — see `FieldSetInclusionSObjectField`), re-validates the
 * result, then rewrites (and optionally deploys) the `.md-meta.xml`.
 *
 * See docs/design/0016-at4dx-selector-config-field-set-inclusion.md for the full behavior contract.
 *
 * @throws {FieldSetInclusionWriteError} See the error codes in `FieldSetInclusionWriteErrorCode`.
 */
export async function updateFieldSetInclusion(
  input: UpdateFieldSetInclusionInput,
  target: UpdateFieldSetInclusionTarget,
): Promise<At4dxFieldSetInclusionUpdateResult> {
  if ((!target.sourceDirs || target.sourceDirs.length === 0) && !target.connection) {
    throw new FieldSetInclusionWriteError(
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
    throw new FieldSetInclusionWriteError(
      'no-fields-to-update',
      'At least one field besides developerName must be given to update.',
    );
  }

  const scan = await scanUpdateContext(target);
  const existing = scan.records.find((record) => record.developerName === input.developerName);
  if (!existing) {
    throw new FieldSetInclusionWriteError(
      'developer-name-not-found',
      `No SelectorConfig_FieldSetInclusion__mdt record named "${input.developerName}" was found in ${scan.source}.`,
    );
  }

  const merged = mergeFieldSetInclusionRecord(existing, input);

  const otherRecords = scan.records.filter((record) => record.developerName !== input.developerName);
  const issues = validateFieldSetInclusions([...otherRecords, merged], {
    malformed: scan.malformed,
    ambiguous: scan.ambiguous,
  });
  checkValidation(issues, input.force);

  let xml: string;
  if (scan.isLocal) {
    const existingXml = await fs.readFile(existing.filePath!, 'utf-8');
    try {
      xml = patchFieldSetInclusionXml(existingXml, existing, merged, { label: merged.label });
    } catch (err) {
      if (!(err instanceof UnpatchableValueShapeError)) {
        throw err;
      }
      xml = buildFieldSetInclusionXml(merged, { label: merged.label });
    }
  } else {
    xml = buildFieldSetInclusionXml(merged, { label: merged.label });
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
