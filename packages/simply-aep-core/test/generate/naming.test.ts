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
import {
  buildActionNames,
  buildCriteriaNames,
  buildFieldInjectionNames,
  buildSelectorMethodNames,
  buildServiceNames,
  buildSObjectNames,
  classFilename,
  domainProcessBindingDeveloperName,
  fieldSetFilename,
  classMetadataFilename,
  selectorInclusionBindingFilename,
  triggerFilename,
  triggerMetadataFilename,
} from '../../src/generate/naming.js';

describe('aep naming', () => {
  it('builds standard object names', () => {
    const names = buildSObjectNames({ apiName: 'Account', isCustom: false });
    expect(names.selectorImplementationClassName).to.equal('AccountsSelector');
    expect(names.selectorInterfaceClassName).to.equal('IAccountsSelector');
    expect(names.domainImplementationClassName).to.equal('Accounts');
    expect(names.applicationFactoryLabel).to.equal('Account');
    expect(names.selectorBindingMetadataFileName).to.equal('ApplicationFactory_SelectorBinding.Account.md-meta.xml');
  });

  it('builds custom object names with prefix', () => {
    const names = buildSObjectNames({ apiName: 'FOOBAR_Property__c', isCustom: true, prefix: 'foobar' });
    expect(names.selectorImplementationClassName).to.equal('FOOBAR_PropertiesSelector');
    expect(names.domainImplementationClassName).to.equal('FOOBAR_Properties');
    expect(names.applicationFactoryLabel).to.equal('FOOBAR_Property');
    expect(names.selectorBindingMetadataFileName).to.equal(
      'ApplicationFactory_SelectorBinding.FOOBAR_Property.md-meta.xml',
    );
    expect(names.domainBindingMetadataFileName).to.equal(
      'ApplicationFactory_DomainBinding.FOOBAR_Property.md-meta.xml',
    );
    expect(names.unitOfWorkBindingMetadataFileName).to.equal(
      'ApplicationFactory_UnitOfWorkBinding.FOOBAR_Property.md-meta.xml',
    );
  });

  it('builds service and selector-method names', () => {
    const service = buildServiceNames({ basename: 'LimitMonitors' });
    expect(service.interfaceClassName).to.equal('ILimitMonitorsService');
    expect(service.bindingMetadataFileName).to.equal(
      'ApplicationFactory_ServiceBinding.ILimitMonitorsService.md-meta.xml',
    );

    const method = buildSelectorMethodNames({
      className: 'SelectBySloganMethod',
      sobjectApiName: 'Account',
      sobjectSelectorClassName: 'AccountsSelector',
    });
    expect(method.unitTestClassName).to.equal('SelectBySloganMethodTest');
  });

  it('builds canonical apex filenames', () => {
    expect(classFilename('Foo')).to.equal('Foo.cls');
    expect(classMetadataFilename('Foo')).to.equal('Foo.cls-meta.xml');
    expect(triggerFilename('Foo')).to.equal('Foo.trigger');
    expect(triggerMetadataFilename('Foo')).to.equal('Foo.trigger-meta.xml');
    expect(fieldSetFilename('SelectorInclusion_AccountFields')).to.equal(
      'SelectorInclusion_AccountFields.fieldSet-meta.xml',
    );
  });

  it('builds domain-process names with process-name and class fallback', () => {
    const devName = domainProcessBindingDeveloperName({
      className: 'AccountNameContainsFishCriteria',
      processName: 'FishCompanySlogans',
      order: '10.10',
      type: 'Criteria',
    });
    expect(devName).to.equal('FishCompanySlogans10_10Criteria');

    const criteria = buildCriteriaNames({
      className: 'AccountNameContainsFishCriteria',
      sobjectApiName: 'Account',
      order: '10.1',
    });
    expect(criteria.bindingDeveloperName).to.equal('AccountNameContainsFishCriteria');
    expect(criteria.bindingMetadataFileName).to.equal(
      'DomainProcessBinding.AccountNameContainsFishCriteria.md-meta.xml',
    );

    const action = buildActionNames({
      className: 'DefaultAccountSloganBasedOnNameAction',
      sobjectApiName: 'Account',
      processName: 'FishCompanySlogans',
      order: '10.2',
    });
    expect(action.bindingDeveloperName).to.equal('FishCompanySlogans10_2Action');
    expect(action.unitTestClassName).to.equal('DefaultAccountSloganBasedOnNameActioTest');
  });

  it('builds field-injection names and filenames', () => {
    const defaults = buildFieldInjectionNames({ sobjectApiName: 'Account' });
    expect(defaults.fieldsetName).to.equal('SelectorInclusion_AccountFields');
    expect(defaults.fieldSetFileName).to.equal('SelectorInclusion_AccountFields.fieldSet-meta.xml');
    expect(defaults.bindingMetadataFileName).to.equal(
      'SelectorConfig_FieldSetInclusion.SelectorInclusion_AccountFields.md-meta.xml',
    );
    expect(selectorInclusionBindingFilename('CustomBinding')).to.equal(
      'SelectorConfig_FieldSetInclusion.CustomBinding.md-meta.xml',
    );

    const explicit = buildFieldInjectionNames({
      sobjectApiName: 'Account',
      fieldsetName: 'AccountFieldsFromMarketing',
    });
    expect(explicit.fieldsetName).to.equal('AccountFieldsFromMarketing');

    const customDefault = buildFieldInjectionNames({ sobjectApiName: 'CKR_ChecklistInstance__c' });
    expect(customDefault.fieldsetName).to.equal('SelectorInclusion_CKRChecklistInstFields');
    expect(customDefault.fieldsetName.length).to.equal(40);
  });
});
