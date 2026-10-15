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

export type Flavor = 'fflib' | 'at4dx';

export type ArtifactId =
  | 'selectorClass'
  | 'selectorInterface'
  | 'selectorUnitTest'
  | 'selectorBinding'
  | 'criteriaClass'
  | 'criteriaUnitTest'
  | 'actionClass'
  | 'actionUnitTest'
  | 'domainProcessBinding'
  | 'selectorInclusionFieldSet'
  | 'selectorConfigFieldSetInclusionBinding'
  | 'domainClass'
  | 'domainInterface'
  | 'domainUnitTest'
  | 'domainTrigger'
  | 'domainBinding'
  | 'serviceFacade'
  | 'serviceInterface'
  | 'serviceImpl'
  | 'serviceException'
  | 'serviceUnitTest'
  | 'serviceBinding'
  | 'unitOfWorkBinding'
  | 'selectorMethodClass'
  | 'selectorMethodUnitTest'
  | 'apexClassMeta'
  | 'triggerMeta';

export type PlannedArtifact = { id: ArtifactId; relativePath: string; content: string };
export type GenerationPlan = { artifacts: PlannedArtifact[] };

export type OverwritePolicy = 'error' | 'skip' | 'overwrite';
export type EngineOptions = {
  baseDir: string;
  dryRun?: boolean;
  /** Default `error`: refuse to write anything when any planned path already exists. */
  overwrite?: OverwritePolicy;
  signal?: AbortSignal;
  onFile?: (event: { absolutePath: string; status: 'created' | 'skipped'; done: number; total: number }) => void;
};

export type GenerationManifest = {
  created: string[];
  skipped: string[];
  wouldCreate?: string[];
};

export type AepCommandResult = {
  baseDir: string;
  created: string[];
  skipped: string[];
  wouldCreate?: string[];
  manualSteps?: string[];
};

export const TRIGGER_OPERATION_OPTIONS = [
  'Before_Insert',
  'Before_Update',
  'Before_Delete',
  'After_Insert',
  'After_Update',
  'After_Delete',
  'After_Undelete',
] as const;
