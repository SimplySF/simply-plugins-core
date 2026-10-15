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

type DescribeFieldLike = { name: string; type?: string; filterable?: boolean };
type DescribeSObjectLike = { name: string; custom: boolean; fields: DescribeFieldLike[] };

export type SObjectDescribeView = { apiName: string; isCustom: boolean; fieldNames: string[] };

const includeField = (field: DescribeFieldLike): boolean =>
  field.name.toLowerCase() !== 'isdeleted' && field.type !== 'textarea' && field.filterable !== false;

export const toDescribeView = (describe: DescribeSObjectLike): SObjectDescribeView => ({
  apiName: describe.name,
  isCustom: describe.custom,
  fieldNames: describe.fields.filter(includeField).map((f) => f.name),
});
