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

import { Eta } from 'eta';
import { AepGenerationError } from '../errors.js';
import type { ArtifactId, Flavor } from '../model.js';
import { apexClassMeta } from './apexClassMeta.js';
import { actionClass } from './actionClass.js';
import { actionUnitTest } from './actionUnitTest.js';
import { criteriaClass } from './criteriaClass.js';
import { criteriaUnitTest } from './criteriaUnitTest.js';
import { domainAt4dxClass } from './domainAt4dxClass.js';
import { domainAt4dxInterface } from './domainAt4dxInterface.js';
import { domainFflibClass } from './domainFflibClass.js';
import { domainFflibInterface } from './domainFflibInterface.js';
import { domainTrigger } from './domainTrigger.js';
import { domainUnitTest } from './domainUnitTest.js';
import { selectorAt4dxClass } from './selectorAt4dxClass.js';
import { selectorAt4dxInterface } from './selectorAt4dxInterface.js';
import { selectorAt4dxUnitTest } from './selectorAt4dxUnitTest.js';
import { selectorFflibClass } from './selectorFflibClass.js';
import { selectorFflibInterface } from './selectorFflibInterface.js';
import { selectorFflibUnitTest } from './selectorFflibUnitTest.js';
import { selectorInclusionFieldSet } from './selectorInclusionFieldSet.js';
import { selectorMethodClass } from './selectorMethodClass.js';
import { selectorMethodUnitTest } from './selectorMethodUnitTest.js';
import { serviceException } from './serviceException.js';
import { serviceFacade } from './serviceFacade.js';
import { serviceImpl } from './serviceImpl.js';
import { serviceInterface } from './serviceInterface.js';
import { serviceUnitTest } from './serviceUnitTest.js';
import { triggerMeta } from './triggerMeta.js';

/**
 * The artifacts rendered from a template. The six Custom Metadata records (`selectorBinding`,
 * `domainBinding`, `serviceBinding`, `unitOfWorkBinding`, `domainProcessBinding`,
 * `selectorConfigFieldSetInclusionBinding`) aren't here: the plan builders serialize them with this
 * package's own `build*Xml` functions, so a generated record and a `create`d one can't differ.
 */
export type TemplatedArtifactId = Exclude<
  ArtifactId,
  | 'selectorBinding'
  | 'domainBinding'
  | 'serviceBinding'
  | 'unitOfWorkBinding'
  | 'domainProcessBinding'
  | 'selectorConfigFieldSetInclusionBinding'
>;

const eta = new Eta({ autoEscape: false, autoTrim: false });

const withFlavor = (artifactId: TemplatedArtifactId, flavor: Flavor): string => `${artifactId}:${flavor}`;

const bothFlavors = (artifactId: TemplatedArtifactId, template: string): Array<[string, string]> => [
  [withFlavor(artifactId, 'at4dx'), template],
  [withFlavor(artifactId, 'fflib'), template],
];

const templateByKey = new Map<string, string>([
  [withFlavor('selectorClass', 'at4dx'), selectorAt4dxClass],
  [withFlavor('selectorClass', 'fflib'), selectorFflibClass],
  [withFlavor('selectorInterface', 'at4dx'), selectorAt4dxInterface],
  [withFlavor('selectorInterface', 'fflib'), selectorFflibInterface],
  [withFlavor('selectorUnitTest', 'at4dx'), selectorAt4dxUnitTest],
  [withFlavor('selectorUnitTest', 'fflib'), selectorFflibUnitTest],
  [withFlavor('criteriaClass', 'at4dx'), criteriaClass],
  [withFlavor('criteriaUnitTest', 'at4dx'), criteriaUnitTest],
  [withFlavor('actionClass', 'at4dx'), actionClass],
  [withFlavor('actionUnitTest', 'at4dx'), actionUnitTest],
  [withFlavor('selectorInclusionFieldSet', 'at4dx'), selectorInclusionFieldSet],
  [withFlavor('domainClass', 'at4dx'), domainAt4dxClass],
  [withFlavor('domainClass', 'fflib'), domainFflibClass],
  [withFlavor('domainInterface', 'at4dx'), domainAt4dxInterface],
  [withFlavor('domainInterface', 'fflib'), domainFflibInterface],
  ...bothFlavors('domainUnitTest', domainUnitTest),
  ...bothFlavors('domainTrigger', domainTrigger),
  ...bothFlavors('serviceFacade', serviceFacade),
  ...bothFlavors('serviceInterface', serviceInterface),
  ...bothFlavors('serviceImpl', serviceImpl),
  ...bothFlavors('serviceException', serviceException),
  ...bothFlavors('serviceUnitTest', serviceUnitTest),
  ...bothFlavors('selectorMethodClass', selectorMethodClass),
  ...bothFlavors('selectorMethodUnitTest', selectorMethodUnitTest),
  ...bothFlavors('apexClassMeta', apexClassMeta),
  ...bothFlavors('triggerMeta', triggerMeta),
]);

/**
 * @param artifactId - The artifact.
 * @param flavor - The framework flavor.
 * @returns The Eta template source.
 * @throws {AepGenerationError} `template-missing` when the artifact has no template for `flavor`.
 */
export const getTemplateSource = (artifactId: TemplatedArtifactId, flavor: Flavor): string => {
  const template = templateByKey.get(withFlavor(artifactId, flavor));
  if (!template) {
    throw new AepGenerationError(
      'template-missing',
      `No template registered for artifact "${artifactId}" and flavor "${flavor}".`,
      { artifactId, flavor },
    );
  }
  return template;
};

/**
 * @param artifactId - The artifact.
 * @param flavor - The framework flavor.
 * @param viewModel - The values the template reads from `it`.
 * @returns The rendered file content.
 * @throws {AepGenerationError} `template-missing` or `template-empty`.
 */
export const render = (artifactId: TemplatedArtifactId, flavor: Flavor, viewModel: object): string => {
  const rendered = eta.renderString(getTemplateSource(artifactId, flavor), viewModel);
  if (typeof rendered !== 'string') {
    throw new AepGenerationError('template-empty', `Template ${artifactId}/${flavor} returned no content.`, {
      artifactId,
      flavor,
    });
  }
  return rendered;
};
