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

/** Teams notification card templates, keyed the same as the original `.hbs` file names. */
export const NOTIFY_TEMPLATES = {
  'build-failure-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkred;">{{projectTitle}}: Failed Build</th></tr>
  <tr><th colspan="3" style="color: white; background-color: grey;">Job: {{jobName}} (Stage:
      {{stage}})</th></tr>
  <tr><td>Branch</td><td colspan="2">Pipeline</td></tr>
  <tr><td>{{refName}}</td><td colspan="2"><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
</table>
`,
  'build-package-version-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkgreen;">{{projectTitle}}: Package Version
      Created</th></tr>
  <tr><td>Version</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{packageVersion}}<br />{{subscriberPackageVersionId}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
  <tr><td colspan="3">Stories since {{packageVersionPrevious}}</td></tr>
  <tr><td colspan="3">{{{storiesLinked}}}</td></tr>
</table>
`,
  'happy-soup-failure-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkred;">Failed Stage:
      {{stage}}</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
</table>
`,
  'happy-soup-final-failure-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkred;">Happy Soup Deployment Failed</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
</table>
`,
  'happy-soup-final-success-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkgreen;">Happy Soup Deployment
      Completed</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
{{#if upgradedPackages.length}}
  <tr><td colspan="3">Upgraded Packages</td></tr>
{{#each upgradedPackages}}
  <tr><td colspan="1">{{packageName}}</td><td colspan="2">{{{storiesLinked}}}</td></tr>
{{/each}}
{{/if}}
</table>
`,
  'happy-soup-starting-stage-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: #007acc;">Starting Stage:
      {{stage}}</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
</table>
`,
  'happy-soup-success-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkgreen;">Completed Stage:
      {{stage}}</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
{{#if upgradedPackages.length}}
  <tr><td colspan="3">Upgraded Packages</td></tr>
{{#each upgradedPackages}}
  <tr><td colspan="1">{{packageName}}</td><td colspan="2">{{{storiesLinked}}}</td></tr>
{{/each}}
{{/if}}
</table>
`,
  'project-failure-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkred;">{{projectTitle}}: Failed
      Deployment</th></tr>
  <tr><th colspan="3" style="color: white; background-color: grey;">Stage:
      {{stage}}</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
</table>
`,
  'project-success-notification': `<table>
  <tr><th colspan="3" style="color: white; background-color: darkgreen;">{{projectTitle}}: Completed
      Deployment</th></tr>
  <tr><td>Environment</td><td>Branch</td><td>Pipeline</td></tr>
  <tr><td>{{environmentName}}</td><td>{{refName}}</td><td><a
        href="{{pipelineUrl}}"
      >{{pipelineId}}</a></td></tr>
  <tr><td colspan="3">Stories</td></tr>
  <tr><td colspan="3">{{{storiesLinked}}}</td></tr>
</table>
`,
} as const;

export type NotifyTemplateName = keyof typeof NOTIFY_TEMPLATES;
