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
import { TAB_VISIBILITIES } from '../permissionSetXmlTemplate.js';

/**
 * Wraps `schema` so each key in `renamed` (an old key, mapped to the key that replaced it) is rejected
 * rather than stripped, so an old config fails loudly instead of silently granting less.
 */
function rejectingRenamedKeys<T extends z.ZodType>(renamed: Record<string, string>, schema: T): z.ZodPreprocess<T> {
  return z.preprocess((value, ctx) => {
    if (value && typeof value === 'object') {
      for (const [oldKey, newKey] of Object.entries(renamed)) {
        if (oldKey in value) {
          ctx.addIssue({ code: 'custom', message: `${oldKey} was renamed to ${newKey}.`, path: [oldKey] });
        }
      }
    }
    return value;
  }, schema);
}

/**
 * Object-level CRUD/access permissions, as granted for a single sObject in `objectPermissions`. Keys are the
 * `<objectPermissions>` element names.
 */
const ObjectPermissionConfigSchema = rejectingRenamedKeys(
  {
    read: 'allowRead',
    create: 'allowCreate',
    edit: 'allowEdit',
    delete: 'allowDelete',
    modifyAll: 'modifyAllRecords',
    viewAll: 'viewAllRecords',
  },
  z.object({
    allowRead: z.boolean().optional(),
    allowCreate: z.boolean().optional(),
    allowEdit: z.boolean().optional(),
    allowDelete: z.boolean().optional(),
    modifyAllRecords: z.boolean().optional(),
    viewAllRecords: z.boolean().optional(),
    viewAllFields: z.boolean().optional(),
  }),
);

/** Field-level read/edit permissions, as granted for a single field in `fieldPermissions`. */
const FieldPermissionConfigSchema = z.object({
  readable: z.boolean().optional(),
  editable: z.boolean().optional(),
});

/** Tab visibility, as granted for a single tab in `tabSettings`: the `<tabSettings>` `<visibility>` value. */
const TabPermissionConfigSchema = rejectingRenamedKeys(
  { visible: 'visibility (Visible, Available, or None)' },
  z.object({
    visibility: z.enum(TAB_VISIBILITIES).optional(),
  }),
);

/** Record type visibility, as granted for a single record type in `recordTypeVisibilities`. */
const RecordTypeVisibilityConfigSchema = z.object({
  visible: z.boolean().optional(),
});

/**
 * Schema for a permission set's overrides: the file passed to `simply permissions build --config`,
 * or a {@link PermissionSetBuildFileSchema}'s `config`. Each section is named for the PermissionSet
 * element it sets. `objectPermissions`, `fieldPermissions`, `tabSettings`, and `recordTypeVisibilities`
 * are keyed by `Object` / `Object.Field` / `Tab` / `Object.RecordType` API names;
 * `hasActivationRequired` applies to the permission set as a whole.
 */
export const PermissionSetBuildConfigSchema = rejectingRenamedKeys(
  { objects: 'objectPermissions', fields: 'fieldPermissions', tabs: 'tabSettings' },
  z.object({
    objectPermissions: z.record(z.string(), ObjectPermissionConfigSchema).optional(),
    fieldPermissions: z.record(z.string(), FieldPermissionConfigSchema).optional(),
    tabSettings: z.record(z.string(), TabPermissionConfigSchema).optional(),
    recordTypeVisibilities: z.record(z.string(), RecordTypeVisibilityConfigSchema).optional(),
    userPermissions: z.record(z.string(), z.boolean()).optional(),
    /** Whether the permission set requires activation before it grants access. Defaults to `false`. */
    hasActivationRequired: z.boolean().optional().default(false),
  }),
);

/** A parsed, validated permission set build config. */
export type PermissionSetBuildConfig = z.infer<typeof PermissionSetBuildConfigSchema>;
