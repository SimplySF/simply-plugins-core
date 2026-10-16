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

/** The `deleteFlows` stage a failure happened in, and the value its `onStage` callback receives. */
export type FlowDeleteStage = 'deactivate' | 'delete';

/** A Flow that couldn't be deactivated, or one of its versions that couldn't be deleted. */
export type FlowDeleteFailure = {
  developerName: string;
  stage: FlowDeleteStage;
  message: string;
};

/** The outcome of `deleteFlows`. `deleted` has one entry per Flow version destroyed. */
export type FlowDeleteResult = {
  deactivated: string[];
  deleted: string[];
  failures: FlowDeleteFailure[];
};

/** A `Status = 'Obsolete'` Flow version: its Tooling API `Flow` Id and its Flow's DeveloperName. */
export type FlowVersionPruneCandidate = { id: string; developerName: string };

/** An obsolete Flow version that couldn't be deleted. */
export type FlowVersionPruneFailure = { developerName: string; message: string };

/** The outcome of `pruneObsoleteFlowVersions`. `deleted` and `failures` are always empty for a dry run. */
export type FlowVersionPruneResult = {
  dryRun: boolean;
  candidates: FlowVersionPruneCandidate[];
  deleted: string[];
  failures: FlowVersionPruneFailure[];
};
