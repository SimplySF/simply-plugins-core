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

import { z } from 'zod';
import { PermissionSetBuildConfigSchema } from './permissionSetBuildConfig.js';

/**
 * Settings shared by every permission set in the file. Each can be overridden per permission set;
 * `directory` and `output` must end up set one way or the other.
 */
const PermissionSetsFileDefaultsSchema = z.object({
  /** The Salesforce source directory to scan. */
  directory: z.string().min(1).optional(),
  /** The directory to write generated permission set XML files to. */
  output: z.string().min(1).optional(),
  /** Whether to include record type visibilities discovered in the source. */
  includeRecordTypes: z.boolean().optional(),
});

/** One permission set to generate: the equivalent of a single `simply permissions build` run. */
const PermissionSetsFileEntrySchema = PermissionSetsFileDefaultsSchema.extend({
  /** The permission set's API name; also used for the output filename. */
  name: z.string().min(1),
  /** The baseline permission level. */
  type: z.enum(['read-only', 'view-all', 'modify-all']),
  label: z.string().optional(),
  description: z.string().optional(),
  /** Overrides on top of the `type` baseline: inline, or a path to a {@link PermissionSetBuildConfigSchema} file. */
  config: z.union([z.string().min(1), PermissionSetBuildConfigSchema]).optional(),
});

/**
 * Schema for a permission sets file: every permission set a project generates, so all of them can
 * be regenerated in one run (`simply permissions build --file`). Names must be unique, and each
 * entry must end up with a `directory` and `output`, from itself or from `defaults`.
 */
export const PermissionSetsFileSchema = z
  .object({
    defaults: PermissionSetsFileDefaultsSchema.optional(),
    permissionSets: z.array(PermissionSetsFileEntrySchema).min(1),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.permissionSets.forEach((permissionSet, index) => {
      if (seen.has(permissionSet.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissionSets', index, 'name'],
          message: `Duplicate permission set name '${permissionSet.name}'`,
        });
      }
      seen.add(permissionSet.name);

      for (const key of ['directory', 'output'] as const) {
        if (!permissionSet[key] && !value.defaults?.[key]) {
          ctx.addIssue({
            code: 'custom',
            path: ['permissionSets', index, key],
            message: `'${key}' must be set on the permission set or in 'defaults'`,
          });
        }
      }
    });
  });

/** A parsed, validated permission sets file. */
export type PermissionSetsFile = z.infer<typeof PermissionSetsFileSchema>;
