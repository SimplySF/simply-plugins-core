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

export const criteriaClass = `public inherited sharing class <%= it.className %> implements IDomainProcessCriteria {
  private List<SObject> recordsToEvaluate = new List<SObject>();

  public IDomainProcessCriteria setRecordsToEvaluate(List<SObject> recordsToEvaluate) {
    this.recordsToEvaluate = recordsToEvaluate == null ? new List<SObject>() : recordsToEvaluate;
    return this;
  }

  public List<SObject> run() {
    List<<%= it.sobjectApiName %>> scopedRecords = (List<<%= it.sobjectApiName %>>) this.recordsToEvaluate;
    // TODO: implement criteria evaluation and return matching records.
    if (scopedRecords.isEmpty()) return new List<SObject>();
    List<SObject> result = new List<SObject>();
    for (<%= it.sobjectApiName %> recordValue : scopedRecords) {
      result.add(recordValue);
    }
    return result;
  }
}
`;
