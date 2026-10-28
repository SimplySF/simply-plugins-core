# @simplysf/simply-cicd-core

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-cicd-core?label=@simplysf/simply-cicd-core)](https://npmjs.com/@simplysf/simply-cicd-core) [![Downloads/week](https://img.shields.io/npm/dw/@simplysf/simply-cicd-core.svg)](https://npmjs.com/@simplysf/simply-cicd-core) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt)

Salesforce CI/CD pipeline stages (build, deploy, notify, sfdx-dependabot), ALM issue linking (Jira, GitLab Issues) and VCS API clients (GitHub, GitLab). This is not a Salesforce CLI plugin — it's the library layer behind [`@simplysf/simply-cicd`](https://github.com/SimplySF/simply-plugins/tree/main/packages/simply-cicd), published separately so it can be imported directly by anything that wants the same logic (a bot, a script, a CI job) without pulling in the CLI framework.

`@simplysf/simply-cicd` is a thin command layer over this package: its commands parse flags and call the functions below. Only its oclif flag declarations stay in the plugin. See [docs/design/0037-simply-cicd-core.md](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0037-simply-cicd-core.md) for the original `alm/`/`vcs/` split and [docs/design/0053-simply-cicd-core-common.md](https://github.com/SimplySF/simply-plugins-core/blob/main/docs/design/0053-simply-cicd-core-common.md) for the move of everything else.

## Install

```bash
npm install @simplysf/simply-cicd-core
```

Requires Node.js `>=22` and either `"type": "module"` or a dynamic `import()` — this package ships ESM only. `vcs/`'s GitHub/GitLab clients use the platform `fetch`. The pipeline stages shell out to the `sf` and `git` binaries (via `execa`), so those must be on `PATH` wherever a stage runs, and they write `[SIMPLY-CICD]`-prefixed progress output to the console.

## API

### ALM and VCS

Everything below is exported from the package root. Removing or renaming an export is a breaking change; see [`src/index.ts`](src/index.ts).

| Export                             | Description                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createAlmProvider(kind)`          | Builds an `AlmProvider` for a registered ALM tool (`'jira'`, `'gitlab-issues'`).                             |
| `listAlmProviderKinds()`           | The ALM tools currently registered, for flag options and error messages.                                     |
| `registerAlmProvider(...)`         | Registers a custom `AlmProvider` implementation without modifying this package.                              |
| `JiraProvider`                     | Extracts `PROJECT-123`-style issue keys from commit-log text and renders them as plain-text/HTML links.      |
| `GitLabIssuesProvider`             | Extracts GitLab's bare `#123` issue references from commit-log text; project keys are not used.              |
| `createVcsProvider(kind, options)` | Builds a `VcsProvider` for a registered platform (`'github'`, `'gitlab'`), given host/token options.         |
| `listVcsProviderKinds()`           | The VCS platforms currently registered.                                                                      |
| `registerVcsProvider(...)`         | Registers a custom `VcsProvider` implementation without modifying this package.                              |
| `GitHubProvider`                   | A `VcsProvider` backed by the GitHub REST API — branches, merge requests (pull requests), CI variables, etc. |
| `GitLabProvider`                   | A `VcsProvider` backed by the GitLab REST API v4 — same surface as `GitHubProvider`.                         |

Types (`AlmProviderKind`, `AlmIssueRef`, `AlmIssueRendering`, `AlmProvider`, `AlmProviderFactory`,
`VcsProviderKind`, `VcsProject`, `VcsProjectRef`, `VcsBranch`, `VcsCommit`, `VcsCommitLogEntry`,
`VcsMergeRequest`, `VcsProjectVariable`, `VcsTerminology`, `VcsCiContext`, `VcsProviderOptions`,
`VcsProvider`, `VcsProviderFactory`) are also exported from the package root.

```ts
import { createAlmProvider } from '@simplysf/simply-cicd-core';

const jira = createAlmProvider('jira');
const issues = jira.extractIssues(commitLog, ['PROJ']);
const { html } = jira.render(issues, 'https://example.atlassian.net/browse');
```

```ts
import { createVcsProvider } from '@simplysf/simply-cicd-core';

const gitlab = createVcsProvider('gitlab', { token: process.env.GITLAB_TOKEN });
const mr = await gitlab.findMergeRequest({ sourceBranch: 'feature/x' });
```

### Pipeline stages

The modules `@simplysf/simply-cicd`'s commands run, also exported from the package root. Each stage function takes a plain options object (the camelCase equivalent of the command's flags) and throws on failure. Full signatures are in the [API reference](https://simplysf.github.io/simply-plugins-core/api/simply-cicd-core/readme/).

| Area                                  | Main exports                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build                                 | `createScratchOrg`, `deleteScratchOrg`, `cleanupScratchOrgs`, `pushToScratch`, `runScratchApexTests`, `installDependencies`, `createPackageVersion`, `createFallbackTag`, `determinePackageChanges`, `runLwcJest`, `runCheckPermissionSets`, `runFlowDelta`, `runFlexipageDelta`, `publishUtamPageObjects`, `VersionTagFormat` |
| Deploy                                | `deployProject`, `deployHappySoup`, `runDeployStage`, `validateDeployFiles`, `toProjectStageOptions`, `toHappySoupStageOptions`, plus the `deployCommon` helpers (`runDeploymentSteps`, `loadProgress`, `updateProgress`, `installDeployPackageDependencies`, `runDeployApexTests`, …)                                         |
| Notify                                | `sendBuildNotification`, `projectNotifyBeforeScript`/`projectNotifyAfterScript`, `happySoupNotifyBeforeScript`/`happySoupNotifyAfterScript`, `getCommitStories`, `getRemoteCommitStories`, `sendNotification`, `renderNotifyTemplate`, `NOTIFY_TEMPLATES`                                                                      |
| sfdx-dependabot                       | `discoverEligibleProjects`, `processProject`, `applyProjectUpdate`, `updateSfdxProject`                                                                                                                                                                                                                                        |
| Schemas (zod)                         | `deployConfigSchema`, `deployProgressSchema`, `deployRulesSchema`, `deployStageSchema`                                                                                                                                                                                                                                         |
| Salesforce org and package operations | `authenticateOrg` (JWT or SFDX auth URL), `getPackageVersionReport`, `listInstalledPackages`, `getOrgConnection`, `getOrgInstanceUrl`, `getRemainingDailyScratchOrgs`, `assignPermissionSets`, `assignPermissionSetLicenses` (`AssignmentError`) (in-process via `@salesforce/core` / `@salesforce/packaging`, no `sf` needed) |
| `sf`/`git`/env utilities              | `runSf`, `runSfJson`, `installPackageDependencies`, `runApexTests`, `installPlugin`, `cloneRepo`, `appendToEnvFile`, `resolveString`/`resolveBoolean`, `logger`                                                                                                                                                                |

```ts
import { deployProject } from '@simplysf/simply-cicd-core';

// The same work `sf simply cicd deploy project install-packaged` does, without the CLI.
await deployProject({
  stage: 'install-packaged',
  alias: 'uat',
  ciJobToken: process.env.CI_JOB_TOKEN!,
  vcsProvider: 'gitlab',
  deployConfigFile: 'config/deploy.json',
});
```

## Issues

Please report any issues at https://github.com/SimplySF/simply-plugins-core/issues

## Contributing

This package is part of the [`@simplysf/simply`](https://github.com/SimplySF/simply-plugins-core) monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's specific to this package, and the repo's [root CONTRIBUTING.md](https://github.com/SimplySF/simply-plugins-core/blob/main/CONTRIBUTING.md) for repo structure, setup, commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-plugins-core/blob/main/CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache-2.0](https://raw.githubusercontent.com/SimplySF/simply-plugins-core/main/LICENSE.txt) license.
