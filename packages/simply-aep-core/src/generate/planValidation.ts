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
import { ALL_BINDING_TYPES, type BindingIssue } from '../at4dxBindingTypes.js';
import type { DomainProcessBindingIssue } from '../at4dxDomainProcessBindingTypes.js';
import { scanLocalDomainProcessBindings, type DomainProcessLocalScanResult } from '../at4dxDomainProcessLocalScan.js';
import { validateDomainProcessBindings } from '../at4dxDomainProcessResolve.js';
import type { FieldSetInclusionIssue } from '../at4dxFieldSetInclusionTypes.js';
import {
  scanLocalFieldSetInclusions,
  type FieldSetInclusionLocalScanResult,
} from '../at4dxFieldSetInclusionLocalScan.js';
import { validateFieldSetInclusions } from '../at4dxFieldSetInclusionResolve.js';
import { scanLocalBindings, type LocalScanResult } from '../at4dxLocalScan.js';
import { validateBindings } from '../at4dxValidate.js';
import type { ArtifactId } from './model.js';
import type { GenerationPreview, PlannedFile } from './generation.js';

/** A validation issue a generation run would introduce, tagged with which record type it's about. */
export type GenerationIssue =
  | ({ record: 'binding' } & BindingIssue)
  | ({ record: 'domain-process-binding' } & DomainProcessBindingIssue)
  | ({ record: 'field-set-inclusion' } & FieldSetInclusionIssue);

/** The `source` every planned record (and any issue about one) carries. */
export const PLANNED_SOURCE = 'planned';

type RecordKind = GenerationIssue['record'];

const KIND_BY_ARTIFACT: Partial<Record<ArtifactId, RecordKind>> = {
  selectorBinding: 'binding',
  domainBinding: 'binding',
  serviceBinding: 'binding',
  unitOfWorkBinding: 'binding',
  domainProcessBinding: 'domain-process-binding',
  selectorConfigFieldSetInclusionBinding: 'field-set-inclusion',
};

type Located = { filePath?: string; source: string };
type Scan = { records: Located[]; malformed: Located[]; ambiguous: Located[] };

/** What one record kind needs: its local scanner, and its validator with the issues tagged. */
type Kind<S extends Scan> = {
  scan(sourceDirs: string[]): S;
  validate(scan: S): GenerationIssue[];
};

const bindingKind: Kind<LocalScanResult> = {
  scan: (sourceDirs): LocalScanResult => scanLocalBindings(sourceDirs, ALL_BINDING_TYPES),
  // No trigger scan, so `missing-domain-trigger` is skipped — see docs/design/0045.
  validate: (scan): GenerationIssue[] => validateBindings(scan).map((issue) => ({ record: 'binding', ...issue })),
};
const domainProcessBindingKind: Kind<DomainProcessLocalScanResult> = {
  scan: scanLocalDomainProcessBindings,
  validate: (scan): GenerationIssue[] =>
    validateDomainProcessBindings(scan).map((issue) => ({ record: 'domain-process-binding', ...issue })),
};
const fieldSetInclusionKind: Kind<FieldSetInclusionLocalScanResult> = {
  scan: scanLocalFieldSetInclusions,
  validate: (scan): GenerationIssue[] =>
    validateFieldSetInclusions(scan).map((issue) => ({ record: 'field-set-inclusion', ...issue })),
};
// `Kind`'s methods are bivariant in their parameter, so each kind widens to `Kind<Scan>`: validateKind
// only filters and appends a scan's arrays, and hands each validator back entries its own scanner made.
const KINDS: Record<RecordKind, Kind<Scan>> = {
  binding: bindingKind,
  'domain-process-binding': domainProcessBindingKind,
  'field-set-inclusion': fieldSetInclusionKind,
};

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

/** @returns The entries of `after` not matched one-for-one by an equal entry of `before`. */
function introduced<I>(before: I[], after: I[]): I[] {
  const remaining = new Map<string, number>();
  for (const issue of before) {
    const key = JSON.stringify(issue);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return after.filter((issue) => {
    const key = JSON.stringify(issue);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

function validateKind(
  kind: Kind<Scan>,
  planned: PlannedFile[],
  sourceDirs: string[],
  tempDir: string,
): GenerationIssue[] {
  // The scanners key a record's package off a `customMetadata` folder, so the planned files go in one.
  const plannedDir = path.join(tempDir, 'customMetadata');
  fs.mkdirSync(plannedDir, { recursive: true });
  const plannedPathByTemp = new Map<string, string>();
  for (const file of planned) {
    const tempPath = path.join(plannedDir, path.basename(file.relativePath));
    fs.writeFileSync(tempPath, file.content, 'utf8');
    plannedPathByTemp.set(path.resolve(tempPath), file.absolutePath);
  }

  const relocate = <T extends Located>(entry: T): T => ({
    ...entry,
    source: PLANNED_SOURCE,
    filePath: entry.filePath ? (plannedPathByTemp.get(path.resolve(entry.filePath)) ?? entry.filePath) : undefined,
  });
  const plannedScan = kind.scan([tempDir]);

  // A planned file replacing an existing one (an overwrite) supersedes it rather than joining it.
  const notReplaced = <T extends Located>(entry: T): boolean =>
    !entry.filePath || !planned.some((file) => samePath(file.absolutePath, entry.filePath!));
  const baselineScan = sourceDirs.length > 0 ? kind.scan(sourceDirs) : { records: [], malformed: [], ambiguous: [] };
  const baseline: Scan = {
    records: baselineScan.records.filter(notReplaced),
    malformed: baselineScan.malformed.filter(notReplaced),
    ambiguous: baselineScan.ambiguous.filter(notReplaced),
  };
  const withPlanned: Scan = {
    records: [...baseline.records, ...plannedScan.records.map(relocate)],
    malformed: [...baseline.malformed, ...plannedScan.malformed.map(relocate)],
    ambiguous: [...baseline.ambiguous, ...plannedScan.ambiguous.map(relocate)],
  };

  return introduced(kind.validate(baseline), kind.validate(withPlanned));
}

/**
 * The validation issues a generation run would introduce: scans the existing directories among
 * `sourceDirs`, adds the planned Custom Metadata records (scanned back from their rendered XML, so
 * they're exactly what a later `validate` reads), and returns only the issues that appear because of
 * them. A pre-existing problem elsewhere in the project isn't one. Writes nothing to `sourceDirs`.
 *
 * See docs/design/0045-aep-core-generation-engine.md.
 *
 * @param preview - From a generation use case's `plan`.
 * @param sourceDirs - Directories to validate against — typically the project's package directories
 * and the output directory. Ones that don't exist are skipped.
 * @returns The introduced issues, each tagged with its record type. Empty when the preview plans no
 * Custom Metadata record, without scanning anything.
 */
export function planValidation(preview: GenerationPreview, sourceDirs: string[]): GenerationIssue[] {
  const plannedByKind = new Map<RecordKind, PlannedFile[]>();
  for (const file of preview.files) {
    const kind = KIND_BY_ARTIFACT[file.artifactId];
    if (kind) plannedByKind.set(kind, [...(plannedByKind.get(kind) ?? []), file]);
  }
  if (plannedByKind.size === 0) return [];

  const existingDirs = [...new Set(sourceDirs.map((dir) => path.resolve(dir)))].filter((dir) => fs.existsSync(dir));
  const issues: GenerationIssue[] = [];
  for (const [record, planned] of plannedByKind) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-aep-generate-'));
    try {
      issues.push(...validateKind(KINDS[record], planned, existingDirs, tempDir));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
  return issues;
}
