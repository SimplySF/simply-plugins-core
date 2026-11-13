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

The VCS clients are defined in `@simplysf/simply-core` and re-exported here unchanged, with one
shared registry, so either import works.

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

## Opening a happy-soup release

`createReleaseBranch` cuts `release/<date>` from the remote's copy of the production branch, commits
the deployment steps and config files copied from their templates in one commit, pushes, and opens a
draft merge request back into production. The config file goes to the path `determineDeployConfigFile`
derives from the branch, so the deploy stages pick it up. `stageReleaseBranch` starts a
`<team>/<app>/<name>` branch for work headed into a release.

```ts
import { createReleaseBranch, resolveHappySoupVcs, stageReleaseBranch } from '@simplysf/simply-cicd-core';

const result = await createReleaseBranch({
  date: '2026-10-19',
  vcs: resolveHappySoupVcs({ token: process.env.SIMPLY_VCS_TOKEN }),
});
console.log(result.status, result.files, result.mergeRequest?.webUrl);

await stageReleaseBranch({ team: 'platform', app: 'core', name: 'PROJ-1058', baseBranch: result.branch });
```

Both read `config/release.json` (searched upward to the repository root), refuse a dirty working tree
before changing anything, and never force a checkout. Pass `dryRun: true` to get the plan without
changing anything. If the branch is already on the remote, it is checked out instead, and
`createReleaseBranch` opens the merge request if it's missing, so a re-run finishes a failed one.

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
