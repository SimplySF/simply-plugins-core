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

/** Object-level CRUD/access permissions, as granted for a single sObject in `objects`. */
const ObjectPermissionConfigSchema = z.object({
  read: z.boolean().optional(),
  create: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
  modifyAll: z.boolean().optional(),
  viewAll: z.boolean().optional(),
  viewAllFields: z.boolean().optional(),
});

/** Field-level read/edit permissions, as granted for a single field in `fields`. */
const FieldPermissionConfigSchema = z.object({
  readable: z.boolean().optional(),
  editable: z.boolean().optional(),
});

/** Tab visibility, as granted for a single tab in `tabs`. */
const TabPermissionConfigSchema = z.object({
  visible: z.boolean().optional(),
});

/** Record type visibility, as granted for a single record type in `recordTypeVisibilities`. */
const RecordTypeVisibilityConfigSchema = z.object({
  visible: z.boolean().optional(),
});

/**
 * Schema for a permission set's overrides: the file passed to `simply permissions build --config`,
 * or a {@link PermissionSetsFileSchema} entry's `config`. `objects`, `fields`, `tabs`, and
 * `recordTypeVisibilities` are keyed by `Object` / `Object.Field` / `Tab` / `Object.RecordType` API
 * names; `hasActivationRequired` applies to the permission set as a whole.
 */
export const PermissionSetBuildConfigSchema = z.object({
  objects: z.record(z.string(), ObjectPermissionConfigSchema).optional(),
  fields: z.record(z.string(), FieldPermissionConfigSchema).optional(),
  tabs: z.record(z.string(), TabPermissionConfigSchema).optional(),
  recordTypeVisibilities: z.record(z.string(), RecordTypeVisibilityConfigSchema).optional(),
  userPermissions: z.record(z.string(), z.boolean()).optional(),
  /** Whether the permission set requires activation before it grants access. Defaults to `false`. */
  hasActivationRequired: z.boolean().optional().default(false),
});

/** A parsed, validated permission set build config. */
export type PermissionSetBuildConfig = z.infer<typeof PermissionSetBuildConfigSchema>;
