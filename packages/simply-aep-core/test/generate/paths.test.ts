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
import { DEFAULT_LAYOUT, PathResolver } from '../../src/generate/paths.js';

describe('aep paths', () => {
  it('returns default layout paths', () => {
    const paths = new PathResolver();
    expect(paths.selectorClassDir()).to.equal('main/classes/selectors');
    expect(paths.selectorBindingDir()).to.equal(
      'main/schema/custommetadata/applicationFactoryBindings/selectorBindings',
    );
    expect(paths.domainClassDir()).to.equal('main/classes/domains');
    expect(paths.triggerDir()).to.equal('main/schema/triggers');
    expect(paths.serviceBindingDir()).to.equal('main/schema/custommetadata/applicationFactoryBindings/serviceBindings');
    expect(paths.uowBindingDir()).to.equal('main/schema/custommetadata/applicationFactoryBindings/unitOfWorkBindings');
    expect(paths.criteriaClassDir()).to.equal('main/classes/criteria');
    expect(paths.actionClassDir()).to.equal('main/classes/actions');
    expect(paths.domainProcessBindingDir()).to.equal(
      'main/schema/custommetadata/applicationFactoryBindings/domainProcessBindings',
    );
    expect(paths.selectorInclusionBindingDir()).to.equal(
      'main/schema/custommetadata/applicationFactoryBindings/selectorConfigFieldSetInclusions',
    );
    expect(paths.fieldSetDir('Account')).to.equal('main/schema/objects/Account/fieldSets');
  });

  it('supports custom layouts', () => {
    const paths = new PathResolver({ ...DEFAULT_LAYOUT, mainClasses: 'x/classes', testClasses: 'x/tests' });
    expect(paths.serviceClassDir()).to.equal('x/classes/services');
    expect(paths.serviceTestDir()).to.equal('x/tests/services');
    expect(paths.criteriaTestDir()).to.equal('x/tests/criteria');
  });
});
