# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.10.2](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.10.1...%40simplysf%2Fsimply-permissions-core%400.10.2) (2026-10-28)

**Note:** Version bump only for package @simplysf/simply-permissions-core

## [0.10.1](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.10.0...%40simplysf%2Fsimply-permissions-core%400.10.1) (2026-10-22)

### Bug Fixes

- **simply-permissions-core:** write permission set elements in Salesforce order ([#250](https://github.com/SimplySF/simply-plugins-core/issues/250)) ([55c121b](https://github.com/SimplySF/simply-plugins-core/commit/55c121b7bcc908b10f08c59b775c572fe69feccf))

# [0.10.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.9.0...%40simplysf%2Fsimply-permissions-core%400.10.0) (2026-10-22)

- feat(simply-permissions-core)!: name override sections after permission set metadata (#248), closes [#248](https://github.com/SimplySF/simply-plugins-core/issues/248)

### BREAKING CHANGES

- a permission set build config's `objects`, `fields`, and
  `tabs` sections are now `objectPermissions`, `fieldPermissions`, and
  `tabSettings`.

# [0.9.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.8.0...%40simplysf%2Fsimply-permissions-core%400.9.0) (2026-10-22)

- feat(simply-permissions-core)!: match override keys to permission set metadata (#247), closes [#247](https://github.com/SimplySF/simply-plugins-core/issues/247)

### BREAKING CHANGES

- `objects` entries use `allowRead`, `allowCreate`, `allowEdit`,
  and `allowDelete`; `tabs` entries use `visibility` instead of `visible`. The
  exported `TabSetting` type is now `{ tab, visibility }`.

# [0.8.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.7.0...%40simplysf%2Fsimply-permissions-core%400.8.0) (2026-10-22)

- feat(simply-permissions-core)!: rename viewAll/modifyAll to viewAllRecords/modifyAllRecords (#246), closes [#246](https://github.com/SimplySF/simply-plugins-core/issues/246)

### BREAKING CHANGES

- `objects` entries in a permission set build config must use
  `viewAllRecords` and `modifyAllRecords`; `viewAll` and `modifyAll` are rejected.

# [0.7.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.6.0...%40simplysf%2Fsimply-permissions-core%400.7.0) (2026-10-21)

- feat(simply-permissions-core)!: one permission set per .psbuild.json file (#244) ([6c3cfa0](https://github.com/SimplySF/simply-plugins-core/commit/6c3cfa0fd9756bd9ebf559dbdee3f624822565ef)), closes [#244](https://github.com/SimplySF/simply-plugins-core/issues/244)

### BREAKING CHANGES

- the permission sets file format and the exports above are
  replaced. simply-permissions and simply-cicd in simply-plugins move to the new
  API in a coordinated follow-up that depends on ^0.7.0.

# [0.6.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.5.0...%40simplysf%2Fsimply-permissions-core%400.6.0) (2026-10-21)

### Features

- **simply-permissions-core:** export findPermissionSetsFiles ([#242](https://github.com/SimplySF/simply-plugins-core/issues/242)) ([5bb17c9](https://github.com/SimplySF/simply-plugins-core/commit/5bb17c93cb4cf32d4ddc7c7234754b7308bce3e6))

# [0.5.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.4.0...%40simplysf%2Fsimply-permissions-core%400.5.0) (2026-10-21)

### Features

- **simply-permissions-core:** export PERMISSION_SETS_FILE_SUFFIX ([#241](https://github.com/SimplySF/simply-plugins-core/issues/241)) ([cadc325](https://github.com/SimplySF/simply-plugins-core/commit/cadc325a4bed7c27ef63d5e917637c373aa94c76))

# [0.4.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.3.2...%40simplysf%2Fsimply-permissions-core%400.4.0) (2026-10-20)

### Features

- **simply-permissions-core:** add checkPermissionSets for permission set drift detection ([#239](https://github.com/SimplySF/simply-plugins-core/issues/239)) ([fe6d343](https://github.com/SimplySF/simply-plugins-core/commit/fe6d34358ebe29b391041ae9521a9df26a60e6c1))

## [0.3.2](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.3.1...%40simplysf%2Fsimply-permissions-core%400.3.2) (2026-10-13)

**Note:** Version bump only for package @simplysf/simply-permissions-core

## [0.3.1](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.3.0...%40simplysf%2Fsimply-permissions-core%400.3.1) (2026-10-13)

**Note:** Version bump only for package @simplysf/simply-permissions-core

# [0.3.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.2.4...%40simplysf%2Fsimply-permissions-core%400.3.0) (2026-09-29)

### Features

- **simply-permissions-core:** add the permission set build service ([#219](https://github.com/SimplySF/simply-plugins-core/issues/219)) ([e78e54d](https://github.com/SimplySF/simply-plugins-core/commit/e78e54d874fe0c03e5354661454e65c7ed92eef0))

## [0.2.4](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.2.3...%40simplysf%2Fsimply-permissions-core%400.2.4) (2026-09-11)

**Note:** Version bump only for package @simplysf/simply-permissions-core

## [0.2.3](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.2.2...%40simplysf%2Fsimply-permissions-core%400.2.3) (2026-09-09)

**Note:** Version bump only for package @simplysf/simply-permissions-core

## [0.2.2](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.2.1...%40simplysf%2Fsimply-permissions-core%400.2.2) (2026-09-02)

**Note:** Version bump only for package @simplysf/simply-permissions-core

## [0.2.1](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-permissions-core%400.2.0...%40simplysf%2Fsimply-permissions-core%400.2.1) (2026-09-02)

### Bug Fixes

- republish with the `@simplysf/simply-report` dependency correctly resolved. 0.2.0 was published via a plain `npm publish` (working around npm's trusted-publisher block on a brand-new package's first release), which doesn't understand pnpm's `workspace:` protocol and published it verbatim instead of rewriting it to a real semver range — 0.2.0 is unusable as a result. No source or behavior change.

# 0.2.0 (2026-09-02)

### Features

- add simply-permissions-core ([a983450](https://github.com/SimplySF/simply-plugins-core/commit/a98345066fed7187f20ddb3d0bf9acd5ef3b5979))
