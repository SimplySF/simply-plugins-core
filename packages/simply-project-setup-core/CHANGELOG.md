# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.4.6](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.5...%40simplysf%2Fsimply-project-setup-core%400.4.6) (2026-11-06)

### Bug Fixes

- **deps:** bump minimatch from 10.2.6 to 11.0.1 ([#277](https://github.com/SimplySF/simply-plugins-core/issues/277)) ([97e03f3](https://github.com/SimplySF/simply-plugins-core/commit/97e03f3f72229b7495d0bb247dc41d3a83780cba))

## [0.4.5](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.4...%40simplysf%2Fsimply-project-setup-core%400.4.5) (2026-11-02)

**Note:** Version bump only for package @simplysf/simply-project-setup-core

## [0.4.4](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.3...%40simplysf%2Fsimply-project-setup-core%400.4.4) (2026-09-11)

**Note:** Version bump only for package @simplysf/simply-project-setup-core

## [0.4.3](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.2...%40simplysf%2Fsimply-project-setup-core%400.4.3) (2026-09-09)

**Note:** Version bump only for package @simplysf/simply-project-setup-core

## [0.4.2](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.1...%40simplysf%2Fsimply-project-setup-core%400.4.2) (2026-09-09)

**Note:** Version bump only for package @simplysf/simply-project-setup-core

## [0.4.1](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.4.0...%40simplysf%2Fsimply-project-setup-core%400.4.1) (2026-09-08)

**Note:** Version bump only for package @simplysf/simply-project-setup-core

# [0.4.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.3.0...%40simplysf%2Fsimply-project-setup-core%400.4.0) (2026-09-04)

- feat(simply-project-setup-core)!: remove the .sfdevrc.json config-file opinion (#188) ([6456dcb](https://github.com/SimplySF/simply-plugins-core/commit/6456dcb3fe31a8bb92e68275345ed2262aacf50e)), closes [#188](https://github.com/SimplySF/simply-plugins-core/issues/188)

### BREAKING CHANGES

- sfdevrcSchema, Sfdevrc, loadSfdevrc, findSfdevrcPath, and
  buildBranchRegex are no longer exported. resolveSetupConfig's `sfdevrc` option
  is renamed to `localOverrides` and no longer wraps include/exclude in a
  `setup` key. No simply-plugins consumer exists yet for this unreleased
  package, so there's nothing to coordinate.

  See docs/design/0035-simply-project-setup-core.md.

# [0.3.0](https://github.com/SimplySF/simply-plugins-core/compare/%40simplysf%2Fsimply-project-setup-core%400.2.0...%40simplysf%2Fsimply-project-setup-core%400.3.0) (2026-09-03)

### Features

- **simply-project-setup-core:** add jsonMergeFiles and regexCustomizations file strategies ([#187](https://github.com/SimplySF/simply-plugins-core/issues/187)) ([7cabf04](https://github.com/SimplySF/simply-plugins-core/commit/7cabf0419a65ceaab56950f840ca6596490f0130))

# 0.2.0 (2026-09-03)

### Features

- add simply-project-setup-core ([#182](https://github.com/SimplySF/simply-plugins-core/issues/182)) ([27bfd22](https://github.com/SimplySF/simply-plugins-core/commit/27bfd221533fc52534e65506f0354d57ace25be5))
