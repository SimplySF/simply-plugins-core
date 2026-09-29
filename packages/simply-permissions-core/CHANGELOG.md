# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
