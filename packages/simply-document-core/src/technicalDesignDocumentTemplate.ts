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

import Handlebars from 'handlebars';

/** A record type on a standard or custom object. */
export type RecordTypeItem = {
  fullName: string;
  label?: string;
  active?: string;
  description?: string;
};

/** A page layout on a standard or custom object. */
export type LayoutItem = {
  nameOnly?: string;
};

/** A custom field on a standard object, custom object, custom setting, custom metadata type, or platform event. */
export type CustomFieldItem = {
  fullName: string;
  label?: string;
  type?: string;
  /** Raw parent object(s) of a Lookup or MasterDetail field. */
  referenceTo?: string | string[];
  /** Raw metadata type; `type` can instead hold a formatted display string. */
  fieldType?: string;
  required?: string;
  externalId?: string;
  unique?: string;
  miniDescription?: string;
};

/** A field set on a standard or custom object. */
export type FieldSetItem = {
  fullName: string;
  label?: string;
  description?: string;
  displayedFields?: Array<{ field?: string }>;
};

/** A validation rule on a standard or custom object. */
export type ValidationRuleItem = {
  fullName: string;
  active?: string;
  description?: string;
};

/**
 * A standard object, custom object, custom setting, custom metadata type, or platform event.
 * These all share the same shape, since they're all backed by `CustomObject`-family metadata.
 */
export type ObjectItem = {
  name: string;
  label?: string;
  miniDescription?: string;
  sharingModel?: string;
  externalSharingModel?: string;
  customSettingsType?: string;
  eventType?: string;
  publishBehavior?: string;
  recordTypes?: RecordTypeItem[];
  layouts?: LayoutItem[];
  customFields?: CustomFieldItem[];
  fieldSets?: FieldSetItem[];
  validationRules?: ValidationRuleItem[];
};

export type GroupItem = { label?: string; apiName?: string; doesIncludeBosses?: string };
export type QueueItem = { label?: string; name: string; doesSendEmailToMembers?: string; queueObjects?: string[] };
export type PermissionSetGroupItem = { label?: string; name: string; description?: string };
export type PermissionSetItem = { label?: string; name: string; description?: string };
export type CustomApplicationItem = { label?: string; name: string; description?: string };
export type FlowItem = { label?: string; name: string; processType?: string; description?: string };
export type FlexipageItem = { masterLabel?: string; name: string; type?: string };
export type ApprovalProcessItem = { label?: string; name: string; active?: string; description?: string };
export type CustomLabelItem = { fullName?: string; shortDescription?: string };
export type EmailTemplateItem = { apiName: string; label?: string; type?: string; description?: string };
export type ReportItem = { name: string; folderName?: string; description?: string };
export type DashboardItem = { name: string; folderName?: string; description?: string };
export type ApexClassItem = { name: string; status?: string; apiVersion?: string };
export type ApexTriggerItem = { name: string; status?: string; apiVersion?: string };
export type LightningComponentItem = { name: string; description?: string; apiVersion?: string };
export type AuraComponentItem = { name: string; description?: string; apiVersion?: string };
export type VisualforcePageItem = { name: string; label?: string; description?: string; apiVersion?: string };
export type StaticResourceItem = { name: string; contentType?: string; cacheControl?: string; description?: string };
export type ExperienceBundleItem = { name: string };
export type DigitalExperienceBundleItem = { name: string };
export type CustomMetadataItem = { label?: string; name: string };
export type SharingRuleItem = {
  label?: string;
  fullName?: string;
  object?: string;
  type?: string;
  accessLevel?: string;
  description?: string;
};

/** The full data model rendered by the technical design document template. */
export type TechnicalDesignDocumentData = {
  apexClasses: ApexClassItem[];
  apexTriggers: ApexTriggerItem[];
  approvalProcesses: ApprovalProcessItem[];
  auraComponents: AuraComponentItem[];
  customApplications: CustomApplicationItem[];
  customLabels: CustomLabelItem[];
  customMetadata: CustomMetadataItem[];
  customMetadataTypes: ObjectItem[];
  customObjects: ObjectItem[];
  customSettings: ObjectItem[];
  dashboards: DashboardItem[];
  digitalExperienceBundles: DigitalExperienceBundleItem[];
  emailTemplates: EmailTemplateItem[];
  experienceBundles: ExperienceBundleItem[];
  flexipages: FlexipageItem[];
  flows: FlowItem[];
  groups: GroupItem[];
  lightningComponents: LightningComponentItem[];
  permissionSets: PermissionSetItem[];
  permissionSetGroups: PermissionSetGroupItem[];
  platformEvents: ObjectItem[];
  queues: QueueItem[];
  reports: ReportItem[];
  sharingRules: SharingRuleItem[];
  standardObjects: ObjectItem[];
  staticResources: StaticResourceItem[];
  visualforcePages: VisualforcePageItem[];
};

const handlebars = Handlebars.create();

handlebars.registerHelper('loud', (aString: string): string => aString.toUpperCase());

const technicalDesignDocumentSource = `<h2>Objects</h2>
<h3>Standard Objects</h3>
{{#each standardObjects}}
<h4 class="auto-cursor-target">{{this.label}}</h4>
<h5>Record Types</h5>
{{#if this.recordTypes}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Active</th>
      <th>Description</th>
    </tr>
    {{#each this.recordTypes}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td style="text-align: center">
        {{#if this.active}} {{loud this.active}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Page Layouts</h5>
{{#if this.layouts}}
<table class="wrapped">
  <colgroup>
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
    </tr>
    {{#each this.layouts}}
    <tr>
      <td>{{this.nameOnly}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Fields</h5>
{{#if this.customFields}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Type</th>
      <th>Required</th>
      <th>External ID</th>
      <th>Unique</th>
      <th>Description</th>
    </tr>
    {{#each this.customFields}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.type}}</td>
      <td style="text-align: center">
        {{#if this.required}} {{loud this.required}} {{else}} FALSE {{/if}}
      </td>
      <td style="text-align: center">
        {{#if this.externalId}} {{loud this.externalId}} {{else}} FALSE {{/if}}
      </td>
      <td style="text-align: center">
        {{#if this.unique}} {{loud this.unique}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Field Sets</h5>
{{#if this.fieldSets}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>API Name</th>
      <th>Label</th>
      <th>Description</th>
    </tr>
    {{#each this.fieldSets}}
    <tr>
      <td>{{this.fullName}}</td>
      <td>{{this.label}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
<h6>Displayed Fields</h6>
{{#each this.fieldSets}}
<ol>
  {{#each this.displayedFields}}
  <li>{{this.field}}</li>
  {{/each}}
</ol>
{{/each}}
{{else}}
<p>None</p>
{{/if}}
<h5>Validation Rules</h5>
{{#if this.validationRules}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>API Name</th>
      <th>Active</th>
      <th>Description</th>
    </tr>
    {{#each this.validationRules}}
    <tr>
      <td>{{this.fullName}}</td>
      <td style="text-align: center">
        {{#if this.active}} {{loud this.active}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}} {{/each}}
<h3>Custom Objects</h3>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Description</th>
    </tr>
    {{#each customObjects}}
    <tr>
      <td><ac:link ac:anchor="{{this.label}}"/></td>
      <td>{{this.name}}</td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#each customObjects}}
<h4 class="auto-cursor-target">{{this.label}}</h4>
<h5>Record Types</h5>
{{#if this.recordTypes}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Active</th>
      <th>Description</th>
    </tr>
    {{#each this.recordTypes}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td style="text-align: center">
        {{#if this.active}} {{loud this.active}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Page Layouts</h5>
{{#if this.layouts}}
<table class="wrapped">
  <colgroup>
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
    </tr>
    {{#each this.layouts}}
    <tr>
      <td>{{this.nameOnly}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Fields</h5>
{{#if this.customFields}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Type</th>
      <th>Required</th>
      <th>External ID</th>
      <th>Unique</th>
      <th>Description</th>
    </tr>
    {{#each this.customFields}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.type}}</td>
      <td style="text-align: center">
        {{#if this.required}} {{loud this.required}} {{else}} FALSE {{/if}}
      </td>
      <td style="text-align: center">
        {{#if this.externalId}} {{loud this.externalId}} {{else}} FALSE {{/if}}
      </td>
      <td style="text-align: center">
        {{#if this.unique}} {{loud this.unique}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h5>Field Sets</h5>
{{#if this.fieldSets}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>API Name</th>
      <th>Label</th>
      <th>Description</th>
    </tr>
    {{#each this.fieldSets}}
    <tr>
      <td>{{this.fullName}}</td>
      <td>{{this.label}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
<h6>Displayed Fields</h6>
{{#each this.fieldSets}}
<ol>
  {{#each this.displayedFields}}
  <li>{{this.field}}</li>
  {{/each}}
</ol>
{{/each}}
{{else}}
<p>None</p>
{{/if}}
<h5>Validation Rules</h5>
{{#if this.validationRules}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>API Name</th>
      <th>Active</th>
      <th>Description</th>
    </tr>
    {{#each this.validationRules}}
    <tr>
      <td>{{this.fullName}}</td>
      <td style="text-align: center">
        {{#if this.active}} {{loud this.active}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}} {{/each}}
<h1 class="auto-cursor-target">Security Model</h1>
<h2>Organization-Wide Defaults</h2>
<p>
  A Salesforce object&#8217;s visibility is controlled at the top level by the
  security model of visibility defined for the object.
</p>
<p>The object visibility may be:</p>
<ul>
  <li>Public Read Only</li>
  <li>Public Read/Write</li>
  <li>Private</li>
  <li>Controlled By Parent</li>
</ul>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Object</th>
      <th>Default Internal Access</th>
      <th>Default External Access</th>
    </tr>
  </thead>
  <tbody>
    {{#if customObjects}} {{#each customObjects}}<tr>
      <td>{{this.name}}</td>
      <td>{{this.sharingModel}}</td>
      <td>{{this.externalSharingModel}}</td>
    </tr>
    {{/each}} {{else}}<tr>
      <td><br /></td>
      <td><br /></td>
      <td><br /></td>
    </tr>{{/if}}
  </tbody>
</table>
<h2 class="auto-cursor-target">Sharing Rules</h2>
<p>Salesforce records can be shared in the following ways:</p>
<ul>
  <li>Criteria-Based Sharing Rules</li>
  <li>Owner-Based Sharing Rules</li>
  <li>Apex Managed Sharing Rules</li>
</ul>
<p>
  A private object can be shared from a public group; a role; a role and all its
  subordinates to a public group; a role; and / or a role and all its
  subordinates.
</p>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>API Name</th>
      <th>Object</th>
      <th>Type</th>
      <th>Access Level</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#if sharingRules}} {{#each sharingRules}}<tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.object}}</td>
      <td>{{this.type}}</td>
      <td>{{this.accessLevel}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}} {{else}}<tr>
      <td><br /></td>
      <td><br /></td>
      <td><br /></td>
      <td><br /></td>
      <td><br /></td>
      <td><br /></td>
    </tr>
    {{/if}}
  </tbody>
</table>
<h1 class="auto-cursor-target">Groups/Queues/Permissions</h1>
<h2>Groups</h2>
{{#if groups}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Includes Bosses?</th>
    </tr>
  </thead>
  <tbody>
    {{#each groups}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.apiName}}</td>
      <td>{{this.doesIncludeBosses}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Queues</h2>
{{#if queues}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Send Email?</th>
      <th>Supported Objects</th>
    </tr>
  </thead>
  <tbody>
    {{#each queues}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td style="text-align: center">
        {{#if this.doesSendEmailToMembers}} {{loud this.doesSendEmailToMembers}}
        {{else}} FALSE {{/if}}
      </td>
      <td>
        {{#each this.queueObjects}}
        <p>{{this}}</p>
        {{/each}}
      </td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Permission Set Groups</h2>
{{#if permissionSetGroups}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each permissionSetGroups}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Permission Sets</h2>
{{#if permissionSets}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each permissionSets}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h1 class="auto-cursor-target">Solution Inventory</h1>
<h2>Apps</h2>
{{#if customApplications}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each customApplications}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<!-- TODO: Workflow -->
<h2>Flows</h2>
{{#if flows}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Process Type</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each flows}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.processType}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Lightning App Pages</h2>
{{#if flexipages}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Type</th>
    </tr>
  </thead>
  <tbody>
    {{#each flexipages}}
    <tr>
      <td>{{this.masterLabel}}</td>
      <td>{{this.name}}</td>
      <td>{{this.type}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Approval Processes</h2>
{{#if approvalProcesses}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Active</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each approvalProcesses}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.active}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Custom Settings</h2>
{{#if customSettings}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Type</th>
    </tr>
  </thead>
  <tbody>
    {{#each customSettings}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.customSettingsType}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#each customSettings}}
<h4 class="auto-cursor-target">{{this.label}}</h4>
<h5>Fields</h5>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Type</th>
      <th>Required</th>
      <th>Description</th>
    </tr>
    {{#each this.customFields}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.type}}</td>
      <td style="text-align: center">
        {{#if this.required}} {{loud this.required}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/each}}
{{else}}
<p>None</p>
{{/if}}
<h2>Custom Metadata Types</h2>
{{#if customMetadataTypes}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each customMetadataTypes}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#each customMetadataTypes}}
<h4 class="auto-cursor-target">{{this.label}}</h4>
<h5>Fields</h5>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Type</th>
      <th>Required</th>
      <th>Description</th>
    </tr>
    {{#each this.customFields}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.type}}</td>
      <td style="text-align: center">
        {{#if this.required}} {{loud this.required}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/each}}
{{else}}
<p>None</p>
{{/if}}
<h2>Custom Metadata</h2>
{{#if customMetadata}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
    </tr>
  </thead>
  <tbody>
    {{#each customMetadata}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Platform Events</h2>
{{#if platformEvents}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Label</th>
      <th>Name</th>
      <th>Type</th>
      <th>Publish Behavior</th>
    </tr>
  </thead>
  <tbody>
    {{#each platformEvents}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.name}}</td>
      <td>{{this.eventType}}</td>
      <td>{{this.publishBehavior}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#each platformEvents}}
<h4 class="auto-cursor-target">{{this.label}}</h4>
<h5>Fields</h5>
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <th>Name</th>
      <th>API Name</th>
      <th>Type</th>
      <th>Required</th>
      <th>Description</th>
    </tr>
    {{#each this.customFields}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{this.fullName}}</td>
      <td>{{this.type}}</td>
      <td style="text-align: center">
        {{#if this.required}} {{loud this.required}} {{else}} FALSE {{/if}}
      </td>
      <td>{{this.miniDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/each}}
{{else}}
<p>None</p>
{{/if}}
<h2>Custom Labels</h2>
{{#if customLabels}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Short Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each customLabels}}
    <tr>
      <td>{{this.fullName}}</td>
      <td>{{this.shortDescription}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Email Templates</h2>
{{#if emailTemplates}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Label</th>
      <th>Type</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each emailTemplates}}
    <tr>
      <td>{{this.apiName}}</td>
      <td>{{this.label}}</td>
      <td>{{this.type}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Reports</h2>
{{#if reports}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Folder Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each reports}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.folderName}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Dashboards</h2>
{{#if dashboards}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Folder Name</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each dashboards}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.folderName}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h1 class="auto-cursor-target">Custom Code Inventory</h1>
<h2>Apex Triggers</h2>
{{#if apexTriggers}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Status</th>
      <th>API Version</th>
    </tr>
  </thead>
  <tbody>
    {{#each apexTriggers}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.status}}</td>
      <td>{{this.apiVersion}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Apex Classes</h2>
{{#if apexClasses}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Status</th>
      <th>API Version</th>
    </tr>
  </thead>
  <tbody>
    {{#each apexClasses}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.status}}</td>
      <td>{{this.apiVersion}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Lightning Web Components</h2>
{{#if lightningComponents}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Description</th>
      <th>API Version</th>
    </tr>
  </thead>
  <tbody>
    {{#each lightningComponents}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
      <td>{{this.apiVersion}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Aura Components</h2>
{{#if auraComponents}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Description</th>
      <th>API Version</th>
    </tr>
  </thead>
  <tbody>
    {{#each auraComponents}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.description}}</td>
      <td>{{this.apiVersion}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Visualforce Pages</h2>
{{#if visualforcePages}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Label</th>
      <th>Description</th>
      <th>API Version</th>
    </tr>
  </thead>
  <tbody>
    {{#each visualforcePages}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.label}}</td>
      <td>{{this.description}}</td>
      <td>{{this.apiVersion}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Static Resources</h2>
{{#if staticResources}}
<table class="wrapped">
  <colgroup>
    <col />
    <col />
    <col />
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
      <th>Content Type</th>
      <th>Cache Control</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    {{#each staticResources}}
    <tr>
      <td>{{this.name}}</td>
      <td>{{this.contentType}}</td>
      <td>{{this.cacheControl}}</td>
      <td>{{this.description}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h1 class="auto-cursor-target">Digital Experiences</h1>
<h2>Experience Bundles</h2>
{{#if experienceBundles}}
<table class="wrapped">
  <colgroup>
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
    </tr>
  </thead>
  <tbody>
    {{#each experienceBundles}}
    <tr>
      <td>{{this.name}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
<h2>Digital Experience Bundles</h2>
{{#if digitalExperienceBundles}}
<table class="wrapped">
  <colgroup>
    <col />
  </colgroup>
  <thead>
    <tr>
      <th>Name</th>
    </tr>
  </thead>
  <tbody>
    {{#each digitalExperienceBundles}}
    <tr>
      <td>{{this.name}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p>None</p>
{{/if}}
`;

const renderTechnicalDesignDocument = handlebars.compile(technicalDesignDocumentSource);

/**
 * Render a Confluence-storage-format technical design document from a Salesforce project's
 * scanned metadata, covering objects/data model, security model, groups/queues/permissions,
 * solution inventory, and custom code inventory.
 *
 * @param data - The scanned project metadata to render.
 * @param customTemplateSource - A user-supplied Handlebars template to render instead of the
 * built-in one. Compiled against the same Handlebars instance as the built-in template, so it
 * can also use the `loud` helper. See the README's "Custom Templates" section for the `data`
 * shape.
 * @returns The rendered XHTML document.
 */
export function buildTechnicalDesignDocumentHtml(
  data: TechnicalDesignDocumentData,
  customTemplateSource?: string,
): string {
  const render = customTemplateSource ? handlebars.compile(customTemplateSource) : renderTechnicalDesignDocument;
  return render(data);
}
