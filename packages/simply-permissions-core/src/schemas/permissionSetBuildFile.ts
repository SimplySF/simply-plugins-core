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
 * The filename suffix that marks a permission set build file, e.g. `config/app-admin.psbuild.json`.
 * It's how `sf simply permissions build` and `sf simply cicd build check-permission-sets` find them.
 * `loadPermissionSetBuildFile` itself accepts any filename.
 */
export const PERMISSION_SET_BUILD_FILE_SUFFIX = '.psbuild.json';

/**
 * Schema for a permission set build file: the definition of one permission set to generate, with
 * the same settings as one `simply permissions build` run with the single-permission-set flags.
 */
export const PermissionSetBuildFileSchema = z.object({
  /** The permission set's API name; also used for the output filename. */
  name: z.string().min(1),
  /** The baseline permission level. */
  type: z.enum(['read-only', 'view-all', 'modify-all']),
  label: z.string().optional(),
  description: z.string().optional(),
  /** The Salesforce source directory to scan. */
  directory: z.string().min(1),
  /** The directory to write the generated permission set XML file to. */
  output: z.string().min(1),
  /** Whether to include record type visibilities discovered in the source. Defaults to `false`. */
  includeRecordTypes: z.boolean().optional(),
  /** Overrides on top of the `type` baseline: inline, or a path to a {@link PermissionSetBuildConfigSchema} file. */
  config: z.union([z.string().min(1), PermissionSetBuildConfigSchema]).optional(),
});

/** A parsed, validated permission set build file. */
export type PermissionSetBuildFile = z.infer<typeof PermissionSetBuildFileSchema>;
