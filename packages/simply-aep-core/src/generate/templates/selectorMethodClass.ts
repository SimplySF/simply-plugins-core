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

export const selectorMethodClass = `/**
* AT4DX Selector Method Injection class
*
* @Usage
*   <%= it.className %>.Parameters queryParams = new <%= it.className %>.Parameters();
*   List<<%= it.apiName %>> records = <%= it.selectorImplementationClassName %>.newInstance().selectInjection(<%= it.className %>.class, queryParams);
*/
public inherited sharing class <%= it.className %> extends AbstractSelectorMethodInjectable implements ISelectorMethodInjectable {
  public List<SObject> selectQuery() {
    <%= it.className %>.Parameters params = (<%= it.className %>.Parameters) getParams();
    fflib_QueryFactory qf = newQueryFactory();
    qf.setCondition('');
    return Database.query(qf.toSOQL());
  }

  public class Parameters implements ISelectorMethodParameterable {}
}
`;
