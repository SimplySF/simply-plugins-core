---
title: simply-cicd-core
description: Usage examples for @simplysf/simply-cicd-core.
---

Salesforce CI/CD pipeline stages (build, deploy, notify, sfdx-dependabot), ALM issue linking (Jira,
GitLab Issues) and VCS API clients (GitHub, GitLab) — the library layer behind `@simplysf/simply-cicd`,
published separately so it can be imported directly without pulling in the CLI framework. Full
signatures and types are in the [API reference](/api/simply-cicd-core/readme/).

```sh
npm install @simplysf/simply-cicd-core
```

## Linking commits to ALM issues

```ts
import { createAlmProvider } from '@simplysf/simply-cicd-core';

const jira = createAlmProvider('jira');
const issues = jira.extractIssues(commitLog, ['PROJ']);
const { html } = jira.render(issues, 'https://example.atlassian.net/browse');
```

## Talking to a VCS platform

```ts
import { createVcsProvider } from '@simplysf/simply-cicd-core';

const gitlab = createVcsProvider('gitlab', { token: process.env.GITLAB_TOKEN });
const mr = await gitlab.findMergeRequest({ sourceBranch: 'feature/x' });
```

## Picking the VCS and ALM provider from `.sfdevrc.json`

`loadCicdSfDevRc` reads the shared base fields plus the sections this package owns
(`deploymentPlugins`, `packageOriginOverrides`). The resolvers from `@simplysf/simply-core` apply
the precedence flag > `SIMPLY_*` environment variable > file > default. The old `SIMPLY_CICD_VCS_*` /
`SIMPLY_CICD_ALM_*` names are not read; see the `simply-core` guide for the variable list.

```ts
import { createAlmProvider, createVcsProvider, loadCicdSfDevRc } from '@simplysf/simply-cicd-core';
import { resolveAlmProjectKeys, resolveAlmProviderKind, resolveVcsSettings } from '@simplysf/simply-core';

const { config } = loadCicdSfDevRc();
const { kind, host } = resolveVcsSettings(config, { provider: flags['vcs-provider'] });
const vcs = createVcsProvider(kind, { host, token: process.env.VCS_TOKEN! });
const alm = createAlmProvider(resolveAlmProviderKind(config, flags['alm-provider']));
const projectKeys = resolveAlmProjectKeys(config, flags['alm-project-key']);
```

## Running a pipeline stage without the CLI

Every `sf simply cicd` stage is a function here that takes the camelCase equivalent of the command's
flags. Stages shell out to `sf` and `git`, so both must be on `PATH`.

```ts
import { deployProject } from '@simplysf/simply-cicd-core';

await deployProject({
  stage: 'install-packaged',
  alias: 'uat',
  ciJobToken: process.env.CI_JOB_TOKEN!,
  vcsProvider: 'gitlab',
  deployConfigFile: 'config/deploy.json',
});
```
