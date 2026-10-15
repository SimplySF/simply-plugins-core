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
import type { z } from 'zod';
import * as schemas from './options.js';
import { AepGenerationError } from './errors.js';
import { describeTarget, resolveApiVersion, resolveOutputBase } from './support.js';
import {
  buildActionNames,
  buildCriteriaNames,
  buildFieldInjectionNames,
  buildSelectorMethodNames,
  buildServiceNames,
  buildSObjectNames,
} from './naming.js';
import {
  buildActionPlan,
  buildCriteriaPlan,
  buildDomainPlan,
  buildFieldInjectionPlan,
  buildSelectorMethodPlan,
  buildSelectorPlan,
  buildServicePlan,
  buildUnitOfWorkPlan,
  combinePlans,
} from './planBuilders.js';
import { PathResolver } from './paths.js';
import type { GenerationPlan } from './model.js';
import { FFLIB_UNIT_OF_WORK_SNIPPET } from './render.js';
import {
  checkCancelled,
  startProgress,
  endProgress,
  requireConnection,
  type AepUseCaseContext,
  type CommandDescriptor,
  type OrgRequirement,
  type WriteUseCase,
} from './useCase.js';
import { applyGeneration, planGeneration, type GenerationPreview, type GenerationOutcome } from './generation.js';

type BuiltGeneration = { plan: GenerationPlan; manualSteps?: string[] };
export type GenerationUseCase<S extends z.ZodType = z.ZodType> = WriteUseCase<S, GenerationPreview, GenerationOutcome>;

const writeUseCase = <S extends z.ZodType>(
  id: string,
  cliId: string,
  title: string,
  requiresOrg: OrgRequirement,
  optionsSchema: S,
  build: (
    conn: Connection | undefined,
    options: z.output<S>,
    ctx?: AepUseCaseContext,
  ) => BuiltGeneration | Promise<BuiltGeneration>,
): GenerationUseCase<S> => {
  const descriptor: CommandDescriptor<S> = {
    id,
    cliId,
    title,
    requiresOrg,
    optionsSchema,
    group: 'generate',
    destructive: false,
  };
  return {
    kind: 'write',
    descriptor,
    async plan(conn, options, ctx): Promise<GenerationPreview> {
      startProgress(ctx, 'plan');
      if (requiresOrg === 'required') requireConnection(conn, descriptor);
      const validation = optionsSchema.safeParse(options);
      if (!validation.success) {
        const selection = validation.error.issues.find(
          (issue) => issue.code === 'custom' && issue.params?.aepCode === 'nothing-selected',
        );
        if (selection) throw new AepGenerationError('nothing-selected', selection.message);
        throw validation.error;
      }
      const parsed = validation.data;
      const built = await build(conn, parsed, ctx);
      checkCancelled(ctx);
      const baseDir = await resolveOutputBase((parsed as { outputPath: string }).outputPath, ctx?.projectRoot);
      const preview = await planGeneration(built.plan, baseDir, id, built.manualSteps, ctx);
      endProgress(ctx, 'planned');
      return preview;
    },
    apply: (_conn, preview, ctx) => applyGeneration(preview, ctx),
  };
};

const objectInputs = async (
  conn: Connection | undefined,
  options: schemas.GenerateSelectorOptions,
  ctx?: AepUseCaseContext,
): Promise<Parameters<typeof buildSelectorPlan>[0]> => {
  // writeUseCase enforces the required connection before entering a builder.
  const view = await describeTarget(conn!, options.sobject);
  checkCancelled(ctx);
  return {
    view,
    names: buildSObjectNames({ apiName: view.apiName, isCustom: view.isCustom, prefix: options.prefix }),
    flavor: options.flavor,
    apiVersion: await resolveApiVersion({ conn, explicit: options.apiVersion }),
    paths: new PathResolver(),
    includeBinding: options.flavor === 'at4dx',
  };
};
const manualSteps = (apiName: string): string[] => [FFLIB_UNIT_OF_WORK_SNIPPET, `${apiName}.SObjectType`];

export const generate = writeUseCase(
  'generate',
  'simply:aep:generate',
  'Generate',
  'required',
  schemas.generateOptionsSchema,
  async (conn, options, ctx) => {
    const inputs = await objectInputs(conn, options, ctx);
    return {
      plan: combinePlans(
        options.selector ? buildSelectorPlan(inputs) : { artifacts: [] },
        options.domain ? buildDomainPlan(inputs) : { artifacts: [] },
        options.unitOfWork
          ? buildUnitOfWorkPlan({ ...inputs, bindingSequenceValue: options.bindingSequence })
          : { artifacts: [] },
      ),
      ...(options.unitOfWork && options.flavor === 'fflib' ? { manualSteps: manualSteps(inputs.view.apiName) } : {}),
    };
  },
);
export const generateSelector = writeUseCase(
  'generate-selector',
  'simply:aep:generate:selector',
  'Generate Selector',
  'required',
  schemas.generateSelectorOptionsSchema,
  async (conn, options, ctx) => ({ plan: buildSelectorPlan(await objectInputs(conn, options, ctx)) }),
);
export const generateDomain = writeUseCase(
  'generate-domain',
  'simply:aep:generate:domain',
  'Generate Domain',
  'required',
  schemas.generateDomainOptionsSchema,
  async (conn, options, ctx) => ({ plan: buildDomainPlan(await objectInputs(conn, options, ctx)) }),
);
export const generateUnitOfWork = writeUseCase(
  'generate-unit-of-work',
  'simply:aep:generate:unit-of-work',
  'Generate Unit of Work',
  'required',
  schemas.generateUnitOfWorkOptionsSchema,
  async (conn, options, ctx) => {
    const inputs = await objectInputs(conn, options, ctx);
    return {
      plan: buildUnitOfWorkPlan({ ...inputs, bindingSequenceValue: options.bindingSequence }),
      ...(options.flavor === 'fflib' ? { manualSteps: manualSteps(inputs.view.apiName) } : {}),
    };
  },
);
export const generateService = writeUseCase(
  'generate-service',
  'simply:aep:generate:service',
  'Generate Service',
  'optional',
  schemas.generateServiceOptionsSchema,
  async (conn, options) => ({
    plan: buildServicePlan({
      names: buildServiceNames({ basename: options.serviceBasename, prefix: options.prefix }),
      flavor: options.flavor,
      apiVersion: await resolveApiVersion({ conn, explicit: options.apiVersion }),
      paths: new PathResolver(),
      includeBinding: options.flavor === 'at4dx',
    }),
  }),
);
export const generateSelectorMethod = writeUseCase(
  'generate-selector-method',
  'simply:aep:generate:selector-method',
  'Generate Selector Method',
  'none',
  schemas.generateSelectorMethodOptionsSchema,
  async (_conn, options) => ({
    plan: buildSelectorMethodPlan({
      names: buildSelectorMethodNames({ ...options, sobjectApiName: options.sobject }),
      flavor: 'at4dx',
      apiVersion: await resolveApiVersion({ explicit: options.apiVersion }),
      paths: new PathResolver(),
    }),
  }),
);
export const generateFieldSetInclusion = writeUseCase(
  'generate-field-set-inclusion',
  'simply:aep:generate:field-set-inclusion',
  'Generate Field Set Inclusion',
  'none',
  schemas.generateFieldSetInclusionOptionsSchema,
  (_conn, options) => {
    const names = buildFieldInjectionNames({ ...options, sobjectApiName: options.sobject });
    return {
      plan: buildFieldInjectionPlan({
        names,
        flavor: 'at4dx',
        fieldNames: options.fields,
        label: options.label ?? names.fieldsetName,
        description: options.description ?? `Generated selector field inclusion for ${names.sobjectApiName}.`,
        paths: new PathResolver(),
      }),
    };
  },
);

const processPlan = async (
  options: schemas.GenerateActionOptions,
  type: 'action' | 'criteria',
): Promise<BuiltGeneration> => {
  const names = (type === 'action' ? buildActionNames : buildCriteriaNames)({
    ...options,
    sobjectApiName: options.sobject,
  });
  return {
    plan: (type === 'action' ? buildActionPlan : buildCriteriaPlan)({
      names,
      flavor: 'at4dx',
      apiVersion: await resolveApiVersion({ explicit: options.apiVersion }),
      triggerOperation: options.triggerOperation,
      orderOfExecution: options.order,
      description: options.description ?? `Review generated ${type} binding for ${names.className}.`,
      paths: new PathResolver(),
    }),
  };
};
export const generateAction = writeUseCase(
  'generate-action',
  'simply:aep:generate:action',
  'Generate Action',
  'none',
  schemas.generateActionOptionsSchema,
  async (_conn, options) => processPlan(options, 'action'),
);
export const generateCriteria = writeUseCase(
  'generate-criteria',
  'simply:aep:generate:criteria',
  'Generate Criteria',
  'none',
  schemas.generateCriteriaOptionsSchema,
  async (_conn, options) => processPlan(options, 'criteria'),
);

/** Every generation use case, keyed by descriptor id. */
export const generationUseCases = {
  generate,
  'generate-selector': generateSelector,
  'generate-domain': generateDomain,
  'generate-service': generateService,
  'generate-unit-of-work': generateUnitOfWork,
  'generate-selector-method': generateSelectorMethod,
  'generate-field-set-inclusion': generateFieldSetInclusion,
  'generate-action': generateAction,
  'generate-criteria': generateCriteria,
};
export const generationCommandDescriptors = Object.values(generationUseCases).map((useCase) => useCase.descriptor);
