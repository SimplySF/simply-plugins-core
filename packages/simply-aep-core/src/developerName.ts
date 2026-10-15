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

/** @returns The broken Custom Metadata DeveloperName rule, or undefined when valid. */
export const developerNameIssue = (value: string): string | undefined => {
  if (value.length > 40) return 'must be 40 characters or fewer';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))
    return 'must start with a letter and contain only letters, numbers, and underscores';
  if (value.includes('__')) return 'must not contain consecutive underscores';
  if (value.endsWith('_')) return 'must not end with an underscore';
  return undefined;
};
