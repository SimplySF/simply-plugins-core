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

import { create } from 'xmlbuilder2';

/** One `<objectPermissions>` entry in a PermissionSet metadata file. */
export type ObjectPermission = {
  object: string;
  allowCreate: boolean;
  allowDelete: boolean;
  allowEdit: boolean;
  allowRead: boolean;
  modifyAllRecords: boolean;
  viewAllRecords: boolean;
  viewAllFields: boolean;
};

/** One `<fieldPermissions>` entry in a PermissionSet metadata file. */
export type FieldPermission = {
  field: string;
  readable: boolean;
  editable: boolean;
};

/** The values a PermissionSet's `<tabSettings>` `<visibility>` accepts. */
export const TAB_VISIBILITIES = ['Visible', 'Available', 'None'] as const;
export type TabVisibility = (typeof TAB_VISIBILITIES)[number];

/** One `<tabSettings>` entry in a PermissionSet metadata file. */
export type TabSetting = {
  tab: string;
  visibility: TabVisibility;
};

/** One `<recordTypeVisibilities>` entry in a PermissionSet metadata file. */
export type RecordTypeVisibility = {
  recordType: string;
  visible: boolean;
};

/** One `<userPermissions>` entry in a PermissionSet metadata file. */
export type UserPermission = {
  name: string;
  enabled: boolean;
};

/** Everything needed to render a complete PermissionSet metadata XML file. */
export type PermissionSetTemplateData = {
  label: string;
  description?: string;
  hasActivationRequired: boolean;
  objectPermissions: ObjectPermission[];
  fieldPermissions: FieldPermission[];
  tabSettings: TabSetting[];
  recordTypeVisibilities: RecordTypeVisibility[];
  userPermissions: UserPermission[];
};

/**
 * Render a complete PermissionSet metadata XML document from template data.
 *
 * Element text content is set via `.txt()`, which xmlbuilder2 escapes for us — there's no
 * hand-rolled escaping (and no risk of it drifting out of sync with what's actually unsafe in
 * XML text content).
 *
 * @param data - The permission set's label, description, activation requirement, and permission
 * entries.
 * @returns The rendered `<PermissionSet>` XML document, ready to write to a `.permissionset-meta.xml` file.
 */
export function buildPermissionSetXml(data: PermissionSetTemplateData): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('PermissionSet', {
    xmlns: 'http://soap.sforce.com/2006/04/metadata',
  });

  if (data.description) {
    root.ele('description').txt(data.description).up();
  }

  for (const permission of data.fieldPermissions) {
    root
      .ele('fieldPermissions')
      .ele('editable')
      .txt(String(permission.editable))
      .up()
      .ele('field')
      .txt(permission.field)
      .up()
      .ele('readable')
      .txt(String(permission.readable))
      .up()
      .up();
  }

  root.ele('hasActivationRequired').txt(String(data.hasActivationRequired)).up();

  root.ele('label').txt(data.label).up();

  for (const permission of data.objectPermissions) {
    root
      .ele('objectPermissions')
      .ele('allowCreate')
      .txt(String(permission.allowCreate))
      .up()
      .ele('allowDelete')
      .txt(String(permission.allowDelete))
      .up()
      .ele('allowEdit')
      .txt(String(permission.allowEdit))
      .up()
      .ele('allowRead')
      .txt(String(permission.allowRead))
      .up()
      .ele('modifyAllRecords')
      .txt(String(permission.modifyAllRecords))
      .up()
      .ele('object')
      .txt(permission.object)
      .up()
      .ele('viewAllRecords')
      .txt(String(permission.viewAllRecords))
      .up()
      .ele('viewAllFields')
      .txt(String(permission.viewAllFields))
      .up()
      .up();
  }

  for (const setting of data.tabSettings) {
    root.ele('tabSettings').ele('tab').txt(setting.tab).up().ele('visibility').txt(setting.visibility).up().up();
  }

  for (const visibility of data.recordTypeVisibilities) {
    root
      .ele('recordTypeVisibilities')
      .ele('recordType')
      .txt(visibility.recordType)
      .up()
      .ele('visible')
      .txt(String(visibility.visible))
      .up()
      .up();
  }

  for (const permission of data.userPermissions) {
    root
      .ele('userPermissions')
      .ele('name')
      .txt(permission.name)
      .up()
      .ele('enabled')
      .txt(String(permission.enabled))
      .up()
      .up();
  }

  return root.end({ prettyPrint: true });
}
