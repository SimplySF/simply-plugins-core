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
import type { FlowDeleteFailure, FlowDeleteResult, FlowDeleteStage } from './flowTypes.js';

type FlowDefinitionRecord = { Definition: { Id: string; DeveloperName: string } };
type FlowVersionRecord = { Id: string; Definition: { DeveloperName: string } };

/** The `deactivate` failure message for a requested name with no Flow in the org. Exported for tests, not from the package index. */
export const FLOW_NOT_FOUND_MESSAGE = 'No Flow with this DeveloperName exists in the org.';

export type DeleteFlowsOptions = {
  /** Called once before each stage starts, e.g. to drive a spinner or send a progress notification. */
  onStage?: (stage: FlowDeleteStage) => void;
};

/**
 * Deactivates and hard-deletes every version of the named Flows — the pre-step a destructive
 * metadata deploy needs, since Salesforce won't remove a Flow that still has an active version.
 *
 * Each distinct `FlowDefinition` is deactivated once (`activeVersionNumber = 0`), then every `Flow`
 * version is destroyed, whether or not its deactivation succeeded. A requested name with no Flow in
 * the org is a `deactivate` failure. Per-item failures are collected into `failures`, never thrown;
 * a failed query rejects.
 *
 * @param connection - The org to delete the Flows from.
 * @param flowNames - Flow DeveloperNames. An empty list returns an empty result without touching the org.
 * @param options - Optional stage callback.
 * @returns Which Flows were deactivated, one `deleted` entry per version destroyed, and any failures.
 */
export async function deleteFlows(
  connection: Connection,
  flowNames: readonly string[],
  options: DeleteFlowsOptions = {},
): Promise<FlowDeleteResult> {
  if (flowNames.length === 0) {
    return { deactivated: [], deleted: [], failures: [] };
  }

  const failures: FlowDeleteFailure[] = [];

  options.onStage?.('deactivate');
  const definitionRecords = await chunkedInQuery<FlowDefinitionRecord>(
    connection,
    flowNames,
    (inClause) =>
      `SELECT Definition.Id, Definition.DeveloperName FROM Flow WHERE Definition.DeveloperName IN (${inClause})`,
    { chunkSize: FLOW_QUERY_CHUNK_SIZE, tooling: true },
  );

  const distinctDefinitions = new Map<string, string>();
  for (const record of definitionRecords) {
    distinctDefinitions.set(record.Definition.Id, record.Definition.DeveloperName);
  }

  // SOQL matches DeveloperName case-insensitively, so a name is missing only if no case variant came back.
  const foundNames = new Set([...distinctDefinitions.values()].map((name) => name.toLowerCase()));
  const reportedMissing = new Set<string>();
  for (const developerName of flowNames) {
    const key = developerName.toLowerCase();
    if (!foundNames.has(key) && !reportedMissing.has(key)) {
      reportedMissing.add(key);
      failures.push({ developerName, stage: 'deactivate', message: FLOW_NOT_FOUND_MESSAGE });
    }
  }

  const deactivated: string[] = [];
  for (const [definitionId, developerName] of distinctDefinitions) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deactivating one FlowDefinition per iteration; failures must attribute to the right flow
      const result = await connection.tooling.sobject('FlowDefinition').update({
        Id: definitionId,
        Metadata: { activeVersionNumber: 0 },
      });
      if (result.success) {
        deactivated.push(developerName);
      } else {
        failures.push({
          developerName,
          stage: 'deactivate',
          message: result.errors.map((e) => e.message).join(', '),
        });
      }
    } catch (error) {
      failures.push({ developerName, stage: 'deactivate', message: (error as Error).message });
    }
  }

  options.onStage?.('delete');
  const versionRecords = await chunkedInQuery<FlowVersionRecord>(
    connection,
    flowNames,
    (inClause) => `SELECT Id, Definition.DeveloperName FROM Flow WHERE Definition.DeveloperName IN (${inClause})`,
    { chunkSize: FLOW_QUERY_CHUNK_SIZE, tooling: true },
  );

  const deleted: string[] = [];
  for (const version of versionRecords) {
    const developerName = version.Definition.DeveloperName;
    try {
      // eslint-disable-next-line no-await-in-loop -- deleting one Flow version per iteration; the Tooling API has no bulk destroy for this object
      const result = await connection.tooling.sobject('Flow').destroy(version.Id);
      if (result.success) {
        deleted.push(developerName);
      } else {
        failures.push({ developerName, stage: 'delete', message: result.errors.map((e) => e.message).join(', ') });
      }
    } catch (error) {
      failures.push({ developerName, stage: 'delete', message: (error as Error).message });
    }
  }

  return { deactivated, deleted, failures };
}
