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

import { ZodError } from 'zod';
import { isAepGenerationError } from './errors.js';
import type { GenerationOutcome, GenerationPreview } from './generation.js';

// Runtime English text shared by callers; help and flag descriptions stay in the CLI.
export const FFLIB_UNIT_OF_WORK_SNIPPET =
  'Please add the following binding to Application.cls (fflib_Application.UnitOfWorkFactory entry):';
export const PROCESS_BINDING_REVIEW =
  'Review the generated binding defaults: ExecuteAsynchronous__c=false, LogicalInverse__c=false, PreventRecursive__c=false, ProcessContext__c=TriggerExecution, DomainMethodToken__c (nil), and Description__c.';
export const FIELD_INJECTION_BINDING_REVIEW =
  'Review the generated binding defaults: IsActive__c=true, and metadata label/description values.';

const renderManualSteps = (steps?: string[]): string[] =>
  steps?.map((step, index) => (index === 0 ? step : `    ${step}`)) ?? [];

/**
 * @param preview - From `planGeneration`.
 * @returns One line per planned file (`NEW` or `OVERWRITE`), then any manual steps.
 */
export const renderGenerationPlan = (preview: GenerationPreview): string[] => [
  ...preview.files.map((file) => `${file.status === 'new' ? 'NEW' : 'OVERWRITE'}  ${file.relativePath}`),
  ...renderManualSteps(preview.manualSteps),
];

/**
 * @param outcome - From `applyGeneration`, or a dry run's `wouldCreate`.
 * @param options - `commandId` selects the command-specific summary lines.
 * @returns The human-readable summary.
 */
export const renderGenerationResult = (outcome: GenerationOutcome, options: { commandId?: string } = {}): string[] => {
  const lines = renderManualSteps(outcome.manualSteps);
  if (options.commandId === 'generate-unit-of-work' && outcome.manualSteps) return lines;
  lines.push(
    outcome.wouldCreate
      ? `Dry-run planned ${outcome.wouldCreate.length} files.`
      : `Generated ${outcome.created.length} files (${outcome.skipped.length} skipped).`,
  );
  if (options.commandId === 'generate-action' || options.commandId === 'generate-criteria')
    lines.push(PROCESS_BINDING_REVIEW);
  if (options.commandId === 'generate-field-set-inclusion') lines.push(FIELD_INJECTION_BINDING_REVIEW);
  return lines;
};

/**
 * @param error - Anything a use case threw, including a zod validation error from its options schema.
 * @returns A one-line title and, for several validation issues, the rest as detail.
 */
export const describeGenerationError = (error: unknown): { title: string; detail?: string } => {
  if (isAepGenerationError(error)) return { title: error.message };
  if (error instanceof ZodError) {
    return {
      title: error.issues[0]?.message ?? 'Invalid options.',
      ...(error.issues.length > 1
        ? {
            detail: error.issues
              .slice(1)
              .map((issue) => issue.message)
              .join('\n'),
          }
        : {}),
    };
  }
  return { title: error instanceof Error ? error.message : String(error) };
};
