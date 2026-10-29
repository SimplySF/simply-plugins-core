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

// Everything exported from this file is this package's public API and is semver-covered: adding an
// export is a minor/patch change, but removing or renaming one is breaking. `test/index.test.ts`
// pins the exported-key list down so an accidental removal fails a test instead of silently shipping
// in a patch release. See docs/design/0020-simply-document-core.md for why this package is split out
// from `@simplysf/simply-document` (the CLI) rather than being one more relative import inside it.

export { buildChangeReportHtml, type ChangeEntry, type ChangesByComponentType } from './changeReportTemplate.js';
export {
  buildTechnicalDesignDocumentHtml,
  type ApexClassItem,
  type ApexTriggerItem,
  type ApprovalProcessItem,
  type AuraComponentItem,
  type CustomApplicationItem,
  type CustomFieldItem,
  type CustomLabelItem,
  type CustomMetadataItem,
  type DashboardItem,
  type DigitalExperienceBundleItem,
  type EmailTemplateItem,
  type ExperienceBundleItem,
  type FieldSetItem,
  type FlexipageItem,
  type FlowItem,
  type GroupItem,
  type LayoutItem,
  type LightningComponentItem,
  type ObjectItem,
  type PermissionSetGroupItem,
  type PermissionSetItem,
  type QueueItem,
  type RecordTypeItem,
  type ReportItem,
  type SharingRuleItem,
  type StaticResourceItem,
  type TechnicalDesignDocumentData,
  type ValidationRuleItem,
  type VisualforcePageItem,
} from './technicalDesignDocumentTemplate.js';

export {
  buildEntityRelationshipModel,
  splitEntityRelationshipModel,
  renderMermaidErDiagram,
  buildEntityRelationshipDiagramMarkdown,
  type EntityRelationshipModel,
  type ErdEntity,
  type ErdRelationship,
  type ErdRelationshipKind,
  type ErdDiagram,
  type ErdOptions,
} from './entityRelationshipDiagram.js';
