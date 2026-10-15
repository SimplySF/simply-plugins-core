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

export const selectorAt4dxUnitTest = `@IsTest
private class <%= it.implementationClassName %>Test {
  @IsTest
  private static void testKnownSelectorMethods() {
    Test.startTest();

    System.assert(<%= it.implementationClassName %>.newInstance().selectById(new Set<Id>{fflib_IDGenerator.generate(<%= it.apiName %>.SObjectType)}).isEmpty(), '<%= it.implementationClassName %> selectById verification method failed.');
    System.assert(new <%= it.implementationClassName %>().getAdditionalSObjectFieldList().isEmpty(), '<%= it.implementationClassName %> getAdditionalSObjectFieldList verification method failed.');

    Test.stopTest();
  }
}`;
