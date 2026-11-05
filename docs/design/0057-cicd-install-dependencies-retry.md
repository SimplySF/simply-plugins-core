# 0057 — `simply-cicd-core`: `installDependencies` retry support

**Status:** Planned  
**Package:** `packages/simply-cicd-core`  
**Date:** 2026-11-05

## Problem

Package dependency installation during CI/CD build runs (via `installDependencies` when setting up a scratch org) can encounter transient network failures, temporary packaging service hiccups, or concurrency issues.

`@simplysf/simply-package-core` already provides retry capabilities (`retryAttempts`, `retryBackoff`, and `packageRetryAttempts`) within its underlying `installPackageDependencies` engine. The `simply-package` CLI plugin's `package dependencies install` command exposes these via `--retry-attempts`, `--retry-backoff`, and `--package-retry-attempts`.

However, `@simplysf/simply-cicd-core`'s `installDependencies` and its underlying `installPackageDependencies` in `sfPackages.ts` did not accept or forward retry options, leaving scratch org builds unable to configure retries when installing packaged dependencies.

## Decision

Expose `retryAttempts`, `retryBackoff`, and `packageRetryAttempts` on both `InstallDependenciesOptions` (in `build/installDependencies.ts`) and `InstallPackageDependenciesConfig` (in `sfPackages.ts`).

- `retryAttempts` (`number`): The number of additional attempts to make when a package install fails (default: 0).
- `retryBackoff` (`number`): The backoff multiplier factor between retries (default: 2).
- `packageRetryAttempts` (`Record<string, number> | string[]`): Per-package override configuration, accepting either a direct `Record<string, number>` mapping of `<aliasOrId>` to attempts, or an array of `'<aliasOrId>:<attempts>'` strings as produced by CLI flags. String entries are strictly validated against `/^\w+:\d+$/`.

These options are forwarded directly to `@simplysf/simply-package-core`'s `installPackageDependencies`, which executes the retries with exponential backoff using `@simplysf/simply-core`'s `retryWithBackoff`.

## Behavior

### `InstallDependenciesOptions` & `InstallPackageDependenciesConfig`

```ts
export type InstallPackageDependenciesConfig = {
  alias?: string;
  wait?: string;
  installType?: PackageInstallType;
  upgradeType?: PackageInstallUpgradeType;
  /** Number of additional attempts to make when a package install fails. Default: 0. */
  retryAttempts?: number;
  /** Factor the delay between install retries grows by after each failed attempt. Default: 2. */
  retryBackoff?: number;
  /** Per-package retry attempts overrides as key-count record or array of '<aliasOrId>:<count>' strings. */
  packageRetryAttempts?: Record<string, number> | string[];
};

export type InstallDependenciesOptions = {
  jwtKeyFile?: string;
  debug?: boolean;
  installType?: 'All' | 'Delta' | 'Upgrade';
  upgradeType?: PackageInstallUpgradeType;
  /** Number of additional attempts to make when a package install fails. Default: 0. */
  retryAttempts?: number;
  /** Factor the delay between install retries grows by after each failed attempt. Default: 2. */
  retryBackoff?: number;
  /** Per-package retry attempts overrides as key-count record or array of '<aliasOrId>:<count>' strings. */
  packageRetryAttempts?: Record<string, number> | string[];
};
```

### String Normalization & Validation

When `packageRetryAttempts` is passed as `string[]`:

- Each item is trimmed and validated against `/^\w+:\d+$/`.
- If invalid, an `Error` is thrown:
  `--package-retry-attempts should have the key:value format of SubscriberPackageVersionId:RetryAttempts, where RetryAttempts is a non-negative integer.`
- Valid entries are parsed into a `Record<string, number>` (`{ [aliasOrId]: parseInt(count, 10) }`).

When `packageRetryAttempts` is passed as `Record<string, number>`, it is forwarded directly.

## Alternatives considered

1. **Only support `Record<string, number>`**: Forces CLI callers (e.g., `@simplysf/simply-cicd`'s commands) to parse strings manually. Supporting both `Record<string, number>` and `string[]` makes the library function convenient for both programmatic and CLI usage.
2. **Propagate retry parameters to deploy stages (`deployCommon` / `deployHappySoup`)**: Deploy stages follow different deployment progress rules and configuration structures. Keeping this change focused on `installDependencies` avoids unnecessary coupling while addressing the immediate scratch org build requirement.

## Implementation plan

1. `packages/simply-cicd-core/src/sfPackages.ts`: Add `normalizePackageRetryAttempts` helper, extend `InstallPackageDependenciesConfig`, and pass retry parameters to `installPackageDependenciesCore`.
2. `packages/simply-cicd-core/src/build/installDependencies.ts`: Extend `InstallDependenciesOptions` and pass retry options to `installPackageDependenciesCommon`.
3. `packages/simply-cicd-core/test/sfPackages.test.ts`: Add unit tests for retry parameter passing, string parsing, and format validation.
4. `packages/simply-cicd-core/test/build/installDependencies.test.ts`: Add unit tests asserting retry parameter forwarding.
5. `packages/simply-cicd-core/README.md`: Update documentation.
6. `docs/design/README.md`: Add row to design index table.

## Testing

- Unit tests in `packages/simply-cicd-core/test/sfPackages.test.ts`:
  - When retry parameters are omitted, options are undefined / defaults preserved.
  - When `retryAttempts` and `retryBackoff` are provided, they are forwarded to `@simplysf/simply-package-core`.
  - When `packageRetryAttempts` is an object, it is forwarded directly.
  - When `packageRetryAttempts` is an array of strings, it is normalized to an object and forwarded.
  - When an invalid string is provided in `packageRetryAttempts`, an error is thrown without invoking core.
- Unit tests in `packages/simply-cicd-core/test/build/installDependencies.test.ts`:
  - Asserts `installPackageDependenciesCommon` receives the retry options.

## Open questions

None.
