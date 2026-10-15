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

import pluralize from 'pluralize';
import type { DomainProcessType } from '../at4dxDomainProcessBindingTypes.js';

export const CLASS_FILE_EXTENSION = '.cls';
export const METADATA_FILE_EXTENSION = '-meta.xml';
export const TRIGGER_FILE_EXTENSION = '.trigger';
export const FIELD_SET_FILE_EXTENSION = '.fieldSet-meta.xml';
export const MAX_APEX_TYPE_NAME_LENGTH = 40;
export const MAX_CUSTOM_METADATA_RECORD_NAME_LENGTH = 40;

export const classFilename = (className: string): string => `${className}${CLASS_FILE_EXTENSION}`;
export const classMetadataFilename = (className: string): string =>
  `${classFilename(className)}${METADATA_FILE_EXTENSION}`;
export const triggerFilename = (triggerName: string): string => `${triggerName}${TRIGGER_FILE_EXTENSION}`;
export const triggerMetadataFilename = (triggerName: string): string =>
  `${triggerFilename(triggerName)}${METADATA_FILE_EXTENSION}`;
export const fieldSetFilename = (fieldSetName: string): string => `${fieldSetName}${FIELD_SET_FILE_EXTENSION}`;

export type SObjectNameInput = { apiName: string; isCustom: boolean; prefix?: string };

export type SObjectNames = {
  apiName: string;
  isCustom: boolean;
  selectorInterfaceClassName: string;
  selectorImplementationClassName: string;
  selectorUnitTestClassName: string;
  selectorBindingMetadataFileName: string;
  domainInterfaceClassName: string;
  domainImplementationClassName: string;
  domainUnitTestClassName: string;
  domainBindingMetadataFileName: string;
  unitOfWorkBindingMetadataFileName: string;
  applicationFactoryLabel: string;
};

export type ServiceNameInput = { basename: string; prefix?: string };
export type ServiceNames = {
  facadeClassName: string;
  interfaceClassName: string;
  implementationClassName: string;
  exceptionClassName: string;
  unitTestClassName: string;
  bindingMetadataFileName: string;
};

export type SelectorMethodNameInput = {
  className: string;
  sobjectApiName: string;
  sobjectSelectorClassName: string;
};

export type SelectorMethodNames = {
  className: string;
  unitTestClassName: string;
  sobjectApiName: string;
  sobjectSelectorClassName: string;
};

export type DomainProcessNameInput = {
  className: string;
  sobjectApiName: string;
  processName?: string;
  order: string;
};

export type DomainProcessNames = {
  className: string;
  unitTestClassName: string;
  sobjectApiName: string;
  bindingDeveloperName: string;
  bindingMetadataFileName: string;
};

export type FieldInjectionNameInput = {
  sobjectApiName: string;
  fieldsetName?: string;
};

export type FieldInjectionNames = {
  sobjectApiName: string;
  fieldsetName: string;
  fieldSetFileName: string;
  bindingDeveloperName: string;
  bindingMetadataFileName: string;
};

const classPrefix = (prefix?: string): string => (prefix ? `${prefix.toUpperCase()}_` : '');
const withUnitTestSuffix = (className: string): string => {
  const suffix = 'Test';
  const maxBaseLength = MAX_APEX_TYPE_NAME_LENGTH - suffix.length;
  const base = className.length > maxBaseLength ? className.slice(0, maxBaseLength) : className;
  return `${base}${suffix}`;
};
const truncateToMaxLength = (value: string, maxLength: number): string =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

const stripLeadingPrefix = (apiName: string, prefixValue: string): string => {
  if (!prefixValue) return apiName;
  const matcher = new RegExp(`^${prefixValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return apiName.replace(matcher, '');
};

const baseNameFromApi = (apiName: string, prefix?: string): string => {
  const pref = classPrefix(prefix);
  const withoutPrefix = stripLeadingPrefix(apiName, pref);
  const cleaned = withoutPrefix.replace('__c', '').replaceAll('_', '');
  return pluralize(cleaned);
};

const nonPluralBaseNameFromApi = (apiName: string): string => apiName.replace('__c', '').replaceAll('_', '');

export const buildSObjectNames = ({ apiName, isCustom, prefix }: SObjectNameInput): SObjectNames => {
  const pref = classPrefix(prefix);
  const base = baseNameFromApi(apiName, prefix);
  const selectorImplementationClassName = `${pref}${base}Selector`;
  const selectorInterfaceClassName = `${pref}I${base}Selector`;
  const domainImplementationClassName = `${pref}${base}`;
  const domainInterfaceClassName = `${pref}I${base}`;
  const applicationFactoryLabel = apiName.replace(/__c$/i, '');
  return {
    apiName,
    isCustom,
    selectorInterfaceClassName,
    selectorImplementationClassName,
    selectorUnitTestClassName: `${selectorImplementationClassName}Test`,
    selectorBindingMetadataFileName: `ApplicationFactory_SelectorBinding.${applicationFactoryLabel}.md-meta.xml`,
    domainInterfaceClassName,
    domainImplementationClassName,
    domainUnitTestClassName: `${domainImplementationClassName}Test`,
    domainBindingMetadataFileName: `ApplicationFactory_DomainBinding.${applicationFactoryLabel}.md-meta.xml`,
    unitOfWorkBindingMetadataFileName: `ApplicationFactory_UnitOfWorkBinding.${applicationFactoryLabel}.md-meta.xml`,
    applicationFactoryLabel,
  };
};

export const buildServiceNames = ({ basename, prefix }: ServiceNameInput): ServiceNames => {
  const pref = classPrefix(prefix);
  const facadeClassName = `${pref}${basename}Service`;
  const interfaceClassName = `${pref}I${basename}Service`;
  const implementationClassName = `${pref}${basename}ServiceImpl`;
  const exceptionClassName = `${pref}${basename}ServiceException`;
  return {
    facadeClassName,
    interfaceClassName,
    implementationClassName,
    exceptionClassName,
    unitTestClassName: `${facadeClassName}Test`,
    bindingMetadataFileName: `ApplicationFactory_ServiceBinding.${interfaceClassName}.md-meta.xml`,
  };
};

export const buildSelectorMethodNames = ({
  className,
  sobjectApiName,
  sobjectSelectorClassName,
}: SelectorMethodNameInput): SelectorMethodNames => ({
  className,
  unitTestClassName: withUnitTestSuffix(className),
  sobjectApiName,
  sobjectSelectorClassName,
});

const toBindingOrderToken = (order: string): string => order.replaceAll('.', '_');

export const domainProcessBindingDeveloperName = (args: {
  className: string;
  processName?: string;
  order: string;
  type: DomainProcessType;
}): string => {
  const processName = args.processName?.trim();
  return processName ? `${processName}${toBindingOrderToken(args.order)}${args.type}` : args.className;
};

const domainProcessBindingFilename = (developerName: string): string =>
  `DomainProcessBinding.${developerName}.md-meta.xml`;

const buildDomainProcessNames = (args: DomainProcessNameInput, type: DomainProcessType): DomainProcessNames => {
  const bindingDeveloperName = domainProcessBindingDeveloperName({
    className: args.className,
    processName: args.processName,
    order: args.order,
    type,
  });
  return {
    className: args.className,
    unitTestClassName: withUnitTestSuffix(args.className),
    sobjectApiName: args.sobjectApiName,
    bindingDeveloperName,
    bindingMetadataFileName: domainProcessBindingFilename(bindingDeveloperName),
  };
};

export const buildCriteriaNames = (args: DomainProcessNameInput): DomainProcessNames =>
  buildDomainProcessNames(args, 'Criteria');

export const buildActionNames = (args: DomainProcessNameInput): DomainProcessNames =>
  buildDomainProcessNames(args, 'Action');

export const selectorInclusionBindingFilename = (developerName: string): string =>
  `SelectorConfig_FieldSetInclusion.${developerName}.md-meta.xml`;

export const buildFieldInjectionNames = ({
  sobjectApiName,
  fieldsetName,
}: FieldInjectionNameInput): FieldInjectionNames => {
  const prefix = 'SelectorInclusion_';
  const suffix = 'Fields';
  const maxFieldsetNameLength = MAX_APEX_TYPE_NAME_LENGTH;
  const maxBaseLength = Math.max(1, maxFieldsetNameLength - prefix.length - suffix.length);
  const defaultBase = truncateToMaxLength(nonPluralBaseNameFromApi(sobjectApiName), maxBaseLength);
  const defaultFieldsetName = `${prefix}${defaultBase}${suffix}`;
  const trimmedFieldsetName = fieldsetName?.trim() ?? '';
  const candidateFieldsetName = trimmedFieldsetName.length > 0 ? trimmedFieldsetName : defaultFieldsetName;
  const resolvedFieldsetName = truncateToMaxLength(candidateFieldsetName, maxFieldsetNameLength);
  const bindingDeveloperName = truncateToMaxLength(resolvedFieldsetName, MAX_APEX_TYPE_NAME_LENGTH);
  return {
    sobjectApiName,
    fieldsetName: resolvedFieldsetName,
    fieldSetFileName: fieldSetFilename(resolvedFieldsetName),
    bindingDeveloperName,
    bindingMetadataFileName: selectorInclusionBindingFilename(bindingDeveloperName),
  };
};
