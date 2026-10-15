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

import { developerNameIssue } from '../developerName.js';
import { buildBindingXml } from '../at4dxBuildXml.js';
import { buildDomainProcessBindingXml } from '../at4dxDomainProcessBuildXml.js';
import type { DomainProcessType, TriggerOperation } from '../at4dxDomainProcessBindingTypes.js';
import { buildFieldSetInclusionXml } from '../at4dxFieldSetInclusionBuildXml.js';
import { ENTITY_DEFINITION_STANDARD_OBJECTS, isCustomObjectApiName } from '../entityDefinitionEligibility.js';
import type { SObjectDescribeView } from './describe.js';
import { AepGenerationError } from './errors.js';
import type { Flavor, GenerationPlan, PlannedArtifact } from './model.js';
import {
  type DomainProcessNames,
  type FieldInjectionNames,
  classFilename,
  classMetadataFilename,
  type SelectorMethodNames,
  type ServiceNames,
  type SObjectNames,
  triggerFilename,
  triggerMetadataFilename,
} from './naming.js';
import { PathResolver } from './paths.js';
import { render } from './templates/registry.js';

const artifact = (id: PlannedArtifact['id'], relativePath: string, content: string): PlannedArtifact => ({
  id,
  relativePath,
  content,
});

const checkBindingName = (developerName: string, source: string): void => {
  const rule = developerNameIssue(developerName);
  if (rule)
    throw new AepGenerationError(
      'invalid-developer-name',
      `Invalid generated DeveloperName "${developerName}" for "${source}": ${rule}.`,
      { developerName, source, rule },
    );
};

const escapeXmlText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Which SObject reference field a generated record populates: the primary (EntityDefinition) field
 * when the object can be referenced that way, the alternate (text) field otherwise — the rule
 * `validateBindings`, `validateDomainProcessBindings` and `validateFieldSetInclusions` check. See
 * docs/design/0014-domain-process-binding-entity-definition-eligibility.md.
 */
const sobjectField = (apiName: string): 'primary' | 'alternate' =>
  isCustomObjectApiName(apiName) || ENTITY_DEFINITION_STANDARD_OBJECTS.has(apiName) ? 'primary' : 'alternate';

export const buildSelectorPlan = (args: {
  names: SObjectNames;
  view: SObjectDescribeView;
  flavor: Flavor;
  apiVersion: string;
  paths: PathResolver;
  includeBinding: boolean;
}): GenerationPlan => {
  const { names, view, flavor, apiVersion, paths } = args;
  const selectorVm = {
    apiName: view.apiName,
    implementationClassName: names.selectorImplementationClassName,
    interfaceClassName: names.selectorInterfaceClassName,
    fieldNames: view.fieldNames,
  };
  const classMetaVm = { apiVersion };

  const artifacts: PlannedArtifact[] = [
    artifact(
      'selectorClass',
      `${paths.selectorClassDir()}/${classFilename(names.selectorImplementationClassName)}`,
      render('selectorClass', flavor, selectorVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.selectorClassDir()}/${classMetadataFilename(names.selectorImplementationClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'selectorInterface',
      `${paths.selectorClassDir()}/${classFilename(names.selectorInterfaceClassName)}`,
      render('selectorInterface', flavor, selectorVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.selectorClassDir()}/${classMetadataFilename(names.selectorInterfaceClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'selectorUnitTest',
      `${paths.selectorTestDir()}/${classFilename(names.selectorUnitTestClassName)}`,
      render('selectorUnitTest', flavor, selectorVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.selectorTestDir()}/${classMetadataFilename(names.selectorUnitTestClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
  ];

  if (args.includeBinding) {
    checkBindingName(names.applicationFactoryLabel, names.apiName);
    artifacts.push(
      artifact(
        'selectorBinding',
        `${paths.selectorBindingDir()}/${names.selectorBindingMetadataFileName}`,
        buildBindingXml(
          {
            bindingType: 'Selector',
            key: names.apiName,
            keyField: sobjectField(names.apiName),
            to: names.selectorImplementationClassName,
          },
          { label: names.applicationFactoryLabel },
        ),
      ),
    );
  }

  return { artifacts };
};

export const buildDomainPlan = (args: {
  names: SObjectNames;
  view: SObjectDescribeView;
  flavor: Flavor;
  apiVersion: string;
  paths: PathResolver;
  includeBinding: boolean;
}): GenerationPlan => {
  const { names, view, flavor, apiVersion, paths } = args;
  const domainVm = {
    apiName: view.apiName,
    implementationClassName: names.domainImplementationClassName,
    interfaceClassName: names.domainInterfaceClassName,
  };
  const classMetaVm = { apiVersion };
  const triggerVm = {
    apiName: view.apiName,
    domainImplementationClassName: names.domainImplementationClassName,
  };

  const artifacts: PlannedArtifact[] = [
    artifact(
      'domainClass',
      `${paths.domainClassDir()}/${classFilename(names.domainImplementationClassName)}`,
      render('domainClass', flavor, domainVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.domainClassDir()}/${classMetadataFilename(names.domainImplementationClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'domainInterface',
      `${paths.domainClassDir()}/${classFilename(names.domainInterfaceClassName)}`,
      render('domainInterface', flavor, domainVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.domainClassDir()}/${classMetadataFilename(names.domainInterfaceClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'domainUnitTest',
      `${paths.domainTestDir()}/${classFilename(names.domainUnitTestClassName)}`,
      render('domainUnitTest', flavor, domainVm),
    ),
    artifact(
      'apexClassMeta',
      `${paths.domainTestDir()}/${classMetadataFilename(names.domainUnitTestClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'domainTrigger',
      `${paths.triggerDir()}/${triggerFilename(names.domainImplementationClassName)}`,
      render('domainTrigger', flavor, triggerVm),
    ),
    artifact(
      'triggerMeta',
      `${paths.triggerDir()}/${triggerMetadataFilename(names.domainImplementationClassName)}`,
      render('triggerMeta', flavor, classMetaVm),
    ),
  ];

  if (args.includeBinding) {
    checkBindingName(names.applicationFactoryLabel, names.apiName);
    artifacts.push(
      artifact(
        'domainBinding',
        `${paths.domainBindingDir()}/${names.domainBindingMetadataFileName}`,
        buildBindingXml(
          {
            bindingType: 'Domain',
            key: names.apiName,
            keyField: sobjectField(names.apiName),
            to: names.domainImplementationClassName,
          },
          { label: names.applicationFactoryLabel },
        ),
      ),
    );
  }

  return { artifacts };
};

export const buildServicePlan = (args: {
  names: ServiceNames;
  flavor: Flavor;
  apiVersion: string;
  paths: PathResolver;
  includeBinding: boolean;
}): GenerationPlan => {
  const { names, flavor, apiVersion, paths, includeBinding } = args;
  const classMetaVm = { apiVersion };

  const artifacts: PlannedArtifact[] = [
    artifact(
      'serviceFacade',
      `${paths.serviceClassDir()}/${classFilename(names.facadeClassName)}`,
      render('serviceFacade', flavor, {
        facadeClassName: names.facadeClassName,
        interfaceClassName: names.interfaceClassName,
      }),
    ),
    artifact(
      'apexClassMeta',
      `${paths.serviceClassDir()}/${classMetadataFilename(names.facadeClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'serviceInterface',
      `${paths.serviceClassDir()}/${classFilename(names.interfaceClassName)}`,
      render('serviceInterface', flavor, {
        interfaceClassName: names.interfaceClassName,
      }),
    ),
    artifact(
      'apexClassMeta',
      `${paths.serviceClassDir()}/${classMetadataFilename(names.interfaceClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'serviceImpl',
      `${paths.serviceClassDir()}/${classFilename(names.implementationClassName)}`,
      render('serviceImpl', flavor, {
        implementationClassName: names.implementationClassName,
        interfaceClassName: names.interfaceClassName,
      }),
    ),
    artifact(
      'apexClassMeta',
      `${paths.serviceClassDir()}/${classMetadataFilename(names.implementationClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'serviceException',
      `${paths.serviceClassDir()}/${classFilename(names.exceptionClassName)}`,
      render('serviceException', flavor, {
        exceptionClassName: names.exceptionClassName,
      }),
    ),
    artifact(
      'apexClassMeta',
      `${paths.serviceClassDir()}/${classMetadataFilename(names.exceptionClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
    artifact(
      'serviceUnitTest',
      `${paths.serviceTestDir()}/${classFilename(names.unitTestClassName)}`,
      render('serviceUnitTest', flavor, {
        unitTestClassName: names.unitTestClassName,
      }),
    ),
    artifact(
      'apexClassMeta',
      `${paths.serviceTestDir()}/${classMetadataFilename(names.unitTestClassName)}`,
      render('apexClassMeta', flavor, classMetaVm),
    ),
  ];

  if (includeBinding) {
    checkBindingName(names.interfaceClassName, names.facadeClassName);
    artifacts.push(
      artifact(
        'serviceBinding',
        `${paths.serviceBindingDir()}/${names.bindingMetadataFileName}`,
        buildBindingXml(
          { bindingType: 'Service', key: names.interfaceClassName, to: names.implementationClassName },
          { label: names.interfaceClassName },
        ),
      ),
    );
  }

  return { artifacts };
};

export const buildUnitOfWorkPlan = (args: {
  names: SObjectNames;
  flavor: Flavor;
  paths: PathResolver;
  bindingSequenceValue: string;
}): GenerationPlan => {
  if (args.flavor !== 'at4dx') return { artifacts: [] };
  checkBindingName(args.names.applicationFactoryLabel, args.names.apiName);
  return {
    artifacts: [
      artifact(
        'unitOfWorkBinding',
        `${args.paths.uowBindingDir()}/${args.names.unitOfWorkBindingMetadataFileName}`,
        buildBindingXml(
          {
            bindingType: 'UnitOfWork',
            key: args.names.apiName,
            keyField: sobjectField(args.names.apiName),
            sequence: Number(args.bindingSequenceValue),
          },
          { label: args.names.applicationFactoryLabel },
        ),
      ),
    ],
  };
};

export const buildSelectorMethodPlan = (args: {
  names: SelectorMethodNames;
  flavor: Flavor;
  apiVersion: string;
  paths: PathResolver;
}): GenerationPlan => {
  const { names, flavor, apiVersion, paths } = args;
  return {
    artifacts: [
      artifact(
        'selectorMethodClass',
        `${paths.selectorClassDir()}/${classFilename(names.className)}`,
        render('selectorMethodClass', flavor, {
          className: names.className,
          apiName: names.sobjectApiName,
          selectorImplementationClassName: names.sobjectSelectorClassName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.selectorClassDir()}/${classMetadataFilename(names.className)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
      artifact(
        'selectorMethodUnitTest',
        `${paths.selectorTestDir()}/${classFilename(names.unitTestClassName)}`,
        render('selectorMethodUnitTest', flavor, {
          unitTestClassName: names.unitTestClassName,
          className: names.className,
          selectorImplementationClassName: names.sobjectSelectorClassName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.selectorTestDir()}/${classMetadataFilename(names.unitTestClassName)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
    ],
  };
};

type DomainProcessPlanArgs = {
  names: DomainProcessNames;
  flavor: Flavor;
  apiVersion: string;
  triggerOperation: string;
  orderOfExecution: string;
  description: string;
  paths: PathResolver;
};

const domainProcessBindingArtifact = (args: DomainProcessPlanArgs, type: DomainProcessType): PlannedArtifact => {
  checkBindingName(args.names.bindingDeveloperName, args.names.sobjectApiName);
  return artifact(
    'domainProcessBinding',
    `${args.paths.domainProcessBindingDir()}/${args.names.bindingMetadataFileName}`,
    buildDomainProcessBindingXml(
      {
        sobject: args.names.sobjectApiName,
        sobjectField: sobjectField(args.names.sobjectApiName),
        processContext: 'TriggerExecution',
        triggerOperation: args.triggerOperation as TriggerOperation,
        domainMethodToken: undefined,
        type,
        classToInject: args.names.className,
        order: Number(args.orderOfExecution),
        isActive: true,
        executeAsynchronous: false,
        logicalInverse: false,
        preventRecursive: false,
        description: args.description,
      },
      { label: args.names.bindingDeveloperName },
    ),
  );
};

export const buildCriteriaPlan = (args: DomainProcessPlanArgs): GenerationPlan => {
  const { names, flavor, apiVersion, paths } = args;
  return {
    artifacts: [
      artifact(
        'criteriaClass',
        `${paths.criteriaClassDir()}/${classFilename(names.className)}`,
        render('criteriaClass', flavor, {
          className: names.className,
          sobjectApiName: names.sobjectApiName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.criteriaClassDir()}/${classMetadataFilename(names.className)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
      artifact(
        'criteriaUnitTest',
        `${paths.criteriaTestDir()}/${classFilename(names.unitTestClassName)}`,
        render('criteriaUnitTest', flavor, {
          className: names.className,
          unitTestClassName: names.unitTestClassName,
          sobjectApiName: names.sobjectApiName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.criteriaTestDir()}/${classMetadataFilename(names.unitTestClassName)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
      domainProcessBindingArtifact(args, 'Criteria'),
    ],
  };
};

export const buildActionPlan = (args: DomainProcessPlanArgs): GenerationPlan => {
  const { names, flavor, apiVersion, paths } = args;
  return {
    artifacts: [
      artifact(
        'actionClass',
        `${paths.actionClassDir()}/${classFilename(names.className)}`,
        render('actionClass', flavor, {
          className: names.className,
          sobjectApiName: names.sobjectApiName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.actionClassDir()}/${classMetadataFilename(names.className)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
      artifact(
        'actionUnitTest',
        `${paths.actionTestDir()}/${classFilename(names.unitTestClassName)}`,
        render('actionUnitTest', flavor, {
          className: names.className,
          unitTestClassName: names.unitTestClassName,
          sobjectApiName: names.sobjectApiName,
        }),
      ),
      artifact(
        'apexClassMeta',
        `${paths.actionTestDir()}/${classMetadataFilename(names.unitTestClassName)}`,
        render('apexClassMeta', flavor, { apiVersion }),
      ),
      domainProcessBindingArtifact(args, 'Action'),
    ],
  };
};

export const buildFieldInjectionPlan = (args: {
  names: FieldInjectionNames;
  flavor: Flavor;
  fieldNames: string[];
  label: string;
  description: string;
  paths: PathResolver;
}): GenerationPlan => {
  const { names, flavor, fieldNames, label, description, paths } = args;
  checkBindingName(names.bindingDeveloperName, names.sobjectApiName);
  return {
    artifacts: [
      artifact(
        'selectorInclusionFieldSet',
        `${paths.fieldSetDir(names.sobjectApiName)}/${names.fieldSetFileName}`,
        render('selectorInclusionFieldSet', flavor, {
          fieldsetName: names.fieldsetName,
          label,
          description: escapeXmlText(description),
          fieldNames,
        }),
      ),
      artifact(
        'selectorConfigFieldSetInclusionBinding',
        `${paths.selectorInclusionBindingDir()}/${names.bindingMetadataFileName}`,
        buildFieldSetInclusionXml(
          {
            sobject: names.sobjectApiName,
            sobjectField: sobjectField(names.sobjectApiName),
            fieldsetName: names.fieldsetName,
            isActive: true,
          },
          { label },
        ),
      ),
    ],
  };
};

export const combinePlans = (...plans: GenerationPlan[]): GenerationPlan => ({
  artifacts: plans.flatMap((plan) => plan.artifacts),
});
