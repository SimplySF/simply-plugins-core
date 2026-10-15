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

import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * Pins down this package's public API surface. Types are erased at runtime and so can't be checked
 * here — TypeScript's own compilation of this file is what catches a type export being removed or
 * renamed (this file also imports the type-only exports below). This test guards the *value* exports
 * (functions, constants) that survive to runtime.
 *
 * Updating this list is expected when the API deliberately grows. A test failure from a removed or
 * renamed key is the signal to treat the change as breaking (see `src/index.ts`'s header comment).
 */
it('exports the expected set of runtime values', () => {
  expect(Object.keys(api).sort()).toStrictEqual(
    [
      'ALL_BINDING_TYPES',
      'ALL_WRITABLE_BINDING_TYPES',
      'AT4DX_BINDING_OBJECTS',
      'AT4DX_BINDING_LOCAL_OBJECT_NAMES',
      'BINDING_TYPE_BY_FLAG',
      'BINDING_RULES',
      'WRITABLE_BINDING_TYPE_BY_FLAG',
      'bindingTypeForLocalObjectName',
      'BindingWriteError',
      'buildBindingXml',
      'scanLocalApexTriggers',
      'scanOrgApexTriggers',
      'scanLocalBindings',
      'scanOrgBindings',
      'resolveBindings',
      'validateBindings',
      'createBinding',
      'updateBinding',
      'ALL_TRIGGER_OPERATIONS',
      'DOMAIN_PROCESS_BINDING_OBJECT',
      'DOMAIN_PROCESS_BINDING_LOCAL_OBJECT_NAME',
      'DOMAIN_PROCESS_BINDING_RULES',
      'ENTITY_DEFINITION_STANDARD_OBJECTS',
      'isCustomObjectApiName',
      'scanLocalDomainProcessBindings',
      'scanOrgDomainProcessBindings',
      'resolveDomainProcessBindings',
      'validateDomainProcessBindings',
      'filterDomainProcessBindingIssues',
      'DomainProcessBindingWriteError',
      'buildDomainProcessBindingXml',
      'deployMetadataFile',
      'createDomainProcessBinding',
      'updateDomainProcessBinding',
      'FIELD_SET_INCLUSION_OBJECT',
      'FIELD_SET_INCLUSION_LOCAL_OBJECT_NAME',
      'FIELD_SET_INCLUSION_RULES',
      'FieldSetInclusionWriteError',
      'buildFieldSetInclusionXml',
      'scanLocalFieldSetInclusions',
      'scanOrgFieldSetInclusions',
      'validateFieldSetInclusions',
      'createFieldSetInclusion',
      'updateFieldSetInclusion',
      'ALL_MATCHER_RULES',
      'PLATFORM_EVENT_SUBSCRIPTION_OBJECT',
      'PLATFORM_EVENT_SUBSCRIPTION_LOCAL_OBJECT_NAME',
      'PLATFORM_EVENT_SUBSCRIPTION_RULES',
      'PlatformEventSubscriptionWriteError',
      'buildPlatformEventSubscriptionXml',
      'scanLocalPlatformEventSubscriptions',
      'scanOrgPlatformEventSubscriptions',
      'resolvePlatformEventDistribution',
      'validatePlatformEventSubscriptions',
      'createPlatformEventSubscription',
      'updatePlatformEventSubscription',
      // AEP code generation (docs/design/0045).
      'AepGenerationError',
      'isAepGenerationError',
      'TRIGGER_OPERATION_OPTIONS',
      'checkCancelled',
      'endProgress',
      'requireConnection',
      'startProgress',
      'uiHints',
      'generateActionOptionsSchema',
      'generateCriteriaOptionsSchema',
      'generateDomainOptionsSchema',
      'generateFieldSetInclusionOptionsSchema',
      'generateOptionsSchema',
      'generateSelectorMethodOptionsSchema',
      'generateSelectorOptionsSchema',
      'generateServiceOptionsSchema',
      'generateUnitOfWorkOptionsSchema',
      'generate',
      'generateAction',
      'generateCriteria',
      'generateDomain',
      'generateFieldSetInclusion',
      'generateSelector',
      'generateSelectorMethod',
      'generateService',
      'generateUnitOfWork',
      'generationCommandDescriptors',
      'generationUseCases',
      'applyGeneration',
      'planGeneration',
      'PLANNED_SOURCE',
      'planValidation',
      'FFLIB_UNIT_OF_WORK_SNIPPET',
      'FIELD_INJECTION_BINDING_REVIEW',
      'PROCESS_BINDING_REVIEW',
      'describeGenerationError',
      'renderGenerationPlan',
      'renderGenerationResult',
      'toDescribeView',
      'DEFAULT_API_VERSION',
      'DEFAULT_OUTPUT_PATH',
      'ORDER_PATTERN',
      'describeTarget',
      'isValidOrderValue',
      'isWithinCustomMetadataNameLimit',
      'resolveApiVersion',
      'resolveOutputBase',
      'resolveProjectApiVersion',
      'buildActionNames',
      'buildCriteriaNames',
      'buildFieldInjectionNames',
      'buildSObjectNames',
      'buildSelectorMethodNames',
      'buildServiceNames',
      'domainProcessBindingDeveloperName',
      'DEFAULT_LAYOUT',
      'PathResolver',
      'buildActionPlan',
      'buildCriteriaPlan',
      'buildDomainPlan',
      'buildFieldInjectionPlan',
      'buildSelectorMethodPlan',
      'buildSelectorPlan',
      'buildServicePlan',
      'buildUnitOfWorkPlan',
      'combinePlans',
      'GenerationEngine',
    ].sort(),
  );
});

describe('type-only exports compile', () => {
  it('AepConnection is assignable from a minimal duck-typed connection', () => {
    const connection: import('../src/index.js').AepConnection = {
      autoFetchQuery: (() => Promise.resolve({ records: [] })) as never,
      getUsername: () => 'test@example.com',
    };
    expect(connection.getUsername()).toBe('test@example.com');
  });
});
