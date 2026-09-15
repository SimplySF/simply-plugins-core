# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.2.5](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-sobject-core%400.2.4...%40simplysf%2Fsimply-sobject-core%400.2.5) (2026-09-15)

### Bug Fixes

- **deps:** bump zod from 4.4.3 to 4.5.4 ([#203](https://github.com/SimplySF/simply-plugins-core/issues/203)) ([9e76b76](https://github.com/SimplySF/simply-plugins-core/commit/9e76b76de7c8601c362c4df2a5f40e1348e6de8f))

## [0.2.4](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-sobject-core%400.2.3...%40simplysf%2Fsimply-sobject-core%400.2.4) (2026-09-11)

**Note:** Version bump only for package @simplysf/simply-sobject-core

## [0.2.3](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-sobject-core%400.2.2...%40simplysf%2Fsimply-sobject-core%400.2.3) (2026-09-09)

**Note:** Version bump only for package @simplysf/simply-sobject-core

## [0.2.2](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-sobject-core%400.2.1...%40simplysf%2Fsimply-sobject-core%400.2.2) (2026-09-02)

**Note:** Version bump only for package @simplysf/simply-sobject-core

## [0.2.1](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-sobject-core%400.2.0...%40simplysf%2Fsimply-sobject-core%400.2.1) (2026-09-02)

### Bug Fixes

- republish with the `@simplysf/simply-report` dependency correctly resolved. 0.2.0 was published via a plain `npm publish` (working around npm's trusted-publisher block on a brand-new package's first release), which doesn't understand pnpm's `workspace:` protocol and published it verbatim instead of rewriting it to a real semver range — 0.2.0 is unusable as a result. No source or behavior change.

# 0.2.0 (2026-09-02)

### Features

- add simply-sobject-core ([764dcf3](https://github.com/SimplySF/simply-plugins-core/commit/764dcf382a8cd46e1f4b14e178f5d085b62f34af))
