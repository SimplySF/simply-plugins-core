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

import type { Connection } from '@salesforce/core';
import { chunkedInQuery } from '@simplysf/simply-core';
import { FLOW_QUERY_CHUNK_SIZE } from './flowQueries.js';
import type { FlowVersionPruneCandidate, FlowVersionPruneFailure, FlowVersionPruneResult } from './flowTypes.js';

type ObsoleteFlowVersionRecord = { Id: string; Definition: { DeveloperName: string } };

export type PruneObsoleteFlowVersionsOptions = {
  /** Find the obsolete versions but delete nothing. */
  dryRun?: boolean;
  /** Called once before each stage starts. `delete` is never reported for a dry run. */
  onStage?: (stage: 'query' | 'delete') => void;
};

/**
 * Finds the `Status = 'Obsolete'` versions of the named Flows. Never returns an active version.
 *
 * @param connection - The org to query.
 * @param flowNames - Flow DeveloperNames. An empty list returns `[]` without querying.
 * @returns One candidate per obsolete version, in query order.
 */
export async function findObsoleteFlowVersions(
  connection: Connection,
  flowNames: readonly string[],
): Promise<FlowVersionPruneCandidate[]> {
  if (flowNames.length === 0) {
    return [];
  }

  const obsoleteRecords = await chunkedInQuery<ObsoleteFlowVersionRecord>(
    connection,
    flowNames,
    (inClause) =>
      `SELECT Id, Definition.DeveloperName FROM Flow WHERE Status = 'Obsolete' AND Definition.DeveloperName IN (${inClause})`,
    { chunkSize: FLOW_QUERY_CHUNK_SIZE, tooling: true },
  );

  return obsoleteRecords.map((record) => ({ id: record.Id, developerName: record.Definition.DeveloperName }));
}

/**
 * Destroys each Flow version, one Tooling API call per candidate, in order. Per-version failures are
 * collected, never thrown.
 *
 * @param connection - The org to delete from.
 * @param candidates - The versions to delete, typically from `findObsoleteFlowVersions`.
 * @returns One `deleted` entry (the Flow's DeveloperName) per version destroyed, and any failures.
 */
export async function deleteFlowVersions(
  connection: Connection,
  candidates: readonly FlowVersionPruneCandidate[],
): Promise<{ deleted: string[]; failures: FlowVersionPruneFailure[] }> {
  const deleted: string[] = [];
  const failures: FlowVersionPruneFailure[] = [];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deleting one Flow version per iteration; the Tooling API has no bulk destroy for this object
      const result = await connection.tooling.sobject('Flow').destroy(candidate.id);
      if (result.success) {
        deleted.push(candidate.developerName);
      } else {
        failures.push({
          developerName: candidate.developerName,
          message: result.errors.map((e) => e.message).join(', '),
        });
      }
    } catch (error) {
      failures.push({ developerName: candidate.developerName, message: (error as Error).message });
    }
  }

  return { deleted, failures };
}

/**
 * Deletes the obsolete versions of the named Flows: `findObsoleteFlowVersions`, then, unless
 * `options.dryRun`, `deleteFlowVersions`. Unlike `deleteFlows`, this never removes an active Flow.
 *
 * @param connection - The org to prune.
 * @param flowNames - Flow DeveloperNames.
 * @param options - Dry run and stage callback.
 * @returns The obsolete versions found, what was deleted, and any per-version failures.
 */
export async function pruneObsoleteFlowVersions(
  connection: Connection,
  flowNames: readonly string[],
  options: PruneObsoleteFlowVersionsOptions = {},
): Promise<FlowVersionPruneResult> {
  options.onStage?.('query');
  const candidates = await findObsoleteFlowVersions(connection, flowNames);

  if (options.dryRun) {
    return { dryRun: true, candidates, deleted: [], failures: [] };
  }

  options.onStage?.('delete');
  const { deleted, failures } = await deleteFlowVersions(connection, candidates);
  return { dryRun: false, candidates, deleted, failures };
}
