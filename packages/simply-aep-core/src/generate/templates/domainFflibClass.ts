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

export const domainFflibClass = `public inherited sharing class <%= it.implementationClassName %> extends fflib_SObjectDomain implements <%= it.interfaceClassName %> {
  public static <%= it.interfaceClassName %> newInstance(List<<%= it.apiName %>> records) {
    return (<%= it.interfaceClassName %>) Application.Domain.newInstance(records);
  }

  public static <%= it.interfaceClassName %> newInstance(Set<Id> recordIds) {
    return (<%= it.interfaceClassName %>) Application.Domain.newInstance(recordIds);
  }

  public <%= it.implementationClassName %>(List<<%= it.apiName %>> records) {
    super(records);
  }

  public class Constructor implements fflib_SObjectDomain.IConstructable {
    public fflib_SObjectDomain construct(List<SObject> sObjectList) {
      return new <%= it.implementationClassName %>(sObjectList);
    }
  }
}
`;
