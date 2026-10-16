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

import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier';
import headerPlugin from 'eslint-plugin-header';
import importPlugin from 'eslint-plugin-import-x';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import sfPluginPlugin from 'eslint-plugin-sf-plugin';
import unicornPlugin from 'eslint-plugin-unicorn';
import { minimatch } from 'minimatch';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eslint-plugin-header's rule predates meta.schema entirely, and flat config (as of ESLint 10)
// treats an undeclared schema as "no options allowed" instead of "unvalidated" — reject our
// headerRule options outright. Restore the old permissive behavior explicitly.
headerPlugin.rules.header.meta.schema = false;

// The plugin also only ever calls the long-deprecated context.getSourceCode(), which ESLint 10
// removed outright (the replacement, the context.sourceCode property, has existed since ESLint 8.40
// and still works). The plugin is unmaintained, so shim the method back in rather than fork it.
const originalHeaderCreate = headerPlugin.rules.header.create;
headerPlugin.rules.header.create = (context) =>
  originalHeaderCreate(Object.assign(Object.create(context), { getSourceCode: () => context.sourceCode }));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

// All published packages; every one carries the same Apache-2.0 header.
// Every package in this repo is a plain library (no oclif commands of its own) since 0026 split
// the CLI plugins out to simply-plugins - see docs/design/0026-split-simply-node-simply-plugins-repos.md.
const allPackages = [
  'packages/simply-aep-core',
  'packages/simply-apex-core',
  'packages/simply-cicd-core',
  'packages/simply-community-core',
  'packages/simply-core',
  'packages/simply-data-core',
  'packages/simply-document-core',
  'packages/simply-flow-core',
  'packages/simply-package-core',
  'packages/simply-permissions-core',
  'packages/simply-project-setup-core',
  'packages/simply-report',
  'packages/simply-schema-core',
  'packages/simply-settings-core',
  'packages/simply-sobject-core',
];

// The shared libraries: plain packages consumed by the plugins, with no oclif commands of their own.
const libraryPackages = [
  'packages/simply-aep-core',
  'packages/simply-apex-core',
  'packages/simply-cicd-core',
  'packages/simply-community-core',
  'packages/simply-core',
  'packages/simply-data-core',
  'packages/simply-document-core',
  'packages/simply-flow-core',
  'packages/simply-package-core',
  'packages/simply-permissions-core',
  'packages/simply-project-setup-core',
  'packages/simply-report',
  'packages/simply-schema-core',
  'packages/simply-settings-core',
  'packages/simply-sobject-core',
];

// sf-plugin's recommended rules only ever applied to the oclif command packages, not the libraries or simply.
const sfPluginPackages = allPackages.filter((pkg) => !libraryPackages.includes(pkg) && pkg !== 'packages/simply');

// Every package's test suite relaxes a handful of rules; the libraries' test overrides skip the mocha env.
const mochaTestPackages = allPackages.filter((pkg) => !libraryPackages.includes(pkg));

const headerRule = [
  2,
  'block',
  [
    '',
    {
      pattern: ' \\* Copyright \\(c\\) \\d{4}, SimplySF\\.',
      template: ' * Copyright (c) 2026, SimplySF.',
    },
    ' *',
    ' * Licensed under the Apache License, Version 2.0 (the "License");',
    ' * you may not use this file except in compliance with the License.',
    ' * You may obtain a copy of the License at',
    ' *',
    ' *     http://www.apache.org/licenses/LICENSE-2.0',
    ' *',
    ' * Unless required by applicable law or agreed to in writing, software',
    ' * distributed under the License is distributed on an "AS IS" BASIS,',
    ' * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
    ' * See the License for the specific language governing permissions and',
    ' * limitations under the License.',
    ' ',
  ],
];

const testOverrideRules = {
  // Allow assert style expressions. i.e. expect(true).to.be.true
  'no-unused-expressions': 'off',
  '@typescript-eslint/no-unused-expressions': 'off',
  // It is common for tests to stub out method.
  '@typescript-eslint/ban-ts-comment': 'off',
  // Return types are defined by the source code. Allows for quick overwrites.
  '@typescript-eslint/explicit-function-return-type': 'off',
  // Mocked out the methods that shouldn't do anything in the tests.
  '@typescript-eslint/no-empty-function': 'off',
  // Stubs/mocks commonly return loosely-typed values.
  '@typescript-eslint/no-unsafe-function-type': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  // Easily return a promise in a mocked method.
  '@typescript-eslint/require-await': 'off',
};

const filesFor = (pkgs, glob) => pkgs.map((pkg) => `${pkg}/${glob}`);
const toSrcFiles = (pkgs) => filesFor(pkgs, '**/*.ts');
const toProductionFiles = (pkgs) => filesFor(pkgs, 'src/**/*.ts');
const toTestFiles = (pkgs) => filesFor(pkgs, 'test/**/*.ts');

// Some eslintrc configs come from nested `overrides` blocks (e.g. rules scoped to certain files
// only). FlatCompat translates those into a `files: [predicateFn]` entry using absolute paths.
// Naively overwriting `files` with our package-scoped globs would drop that scoping and let those
// rules leak into unintended files, so compose (package scope AND original predicate) instead of
// replacing when a config already carries its own file matcher.
const scoped = (pkgs, eslintrcConfig, defaultFiles = toSrcFiles(pkgs)) =>
  compat.config(eslintrcConfig).map((config) => {
    if (!config.files) {
      return { ...config, files: defaultFiles };
    }

    const originalMatchers = config.files;
    const matchesOriginal = (absoluteFilePath) =>
      originalMatchers.some((matcher) =>
        typeof matcher === 'function' ? matcher(absoluteFilePath) : minimatch(absoluteFilePath, matcher),
      );
    const pkgDirs = pkgs.map((pkg) => path.join(__dirname, pkg) + path.sep);

    return {
      ...config,
      files: [
        (absoluteFilePath) =>
          pkgDirs.some((dir) => absoluteFilePath.startsWith(dir)) && matchesOriginal(absoluteFilePath),
      ],
    };
  });

export default [
  {
    ignores: ['dist/**', 'build/**', 'lib/**', 'coverage/**', 'node_modules/**', '**/*.config.{js,cjs,mjs}'],
  },
  ...[js.configs.recommended, ...tseslint.configs.recommendedTypeChecked].map((config) => ({
    ...config,
    files: config.files ?? toSrcFiles(allPackages),
  })),
  {
    files: toSrcFiles(allPackages),
    plugins: {
      'import-x': importPlugin,
      jsdoc: jsdocPlugin,
      unicorn: unicornPlugin,
      header: headerPlugin,
    },
    languageOptions: {
      // typescript-eslint's type-aware rules need to know which tsconfig(s) cover these files.
      // tsconfig.json is a single repo-wide config, so point the parser at the projects that
      // actually exist, resolved from this config file's directory regardless of cwd.
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['tsconfig.json', 'packages/*/test/tsconfig.json'],
      },
    },
    rules: {
      'valid-typeof': 'off',
      'arrow-body-style': 'error',
      'prefer-arrow-callback': 'error',
      camelcase: 'error',
      complexity: 'error',
      curly: ['error', 'multi-line'],
      'class-methods-use-this': 'error',
      eqeqeq: ['error', 'smart'],
      'guard-for-in': 'error',
      'id-denylist': 'error',
      'id-match': 'error',
      'no-await-in-loop': 'error',
      'no-caller': 'error',
      'no-console': 'error',
      'no-eval': 'error',
      'no-lonely-if': 'error',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['src/**'],
              message: "imports from this repo's src folder should be a relative path",
            },
            {
              group: ['**/../lib/**', 'lib/**'],
              message: 'import from /src not from /lib. /lib is a build artifact',
            },
          ],
        },
      ],
      'no-shadow': 'off',
      'no-throw-literal': 'error',
      'no-undef-init': 'error',
      'no-underscore-dangle': 'error',
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-const': 'error',
      'prefer-spread': 'error',
      radix: 'error',
      'spaced-comment': ['error', 'always', { markers: ['/'] }],
      'use-isnan': 'error',

      'import-x/order': 'error',

      'jsdoc/check-alignment': 'error',
      'jsdoc/check-indentation': 'error',
      'jsdoc/tag-lines': [2, 'any', { startLines: 1, endLines: 1 }],

      'unicorn/prefer-node-protocol': 'error',

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNullish: true, allowBoolean: true, allowNumber: true },
      ],
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/return-await': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-reduce-type-parameter': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/unified-signatures': 'error',

      'header/header': headerRule,

      ...eslintConfigPrettier.rules,
    },
  },
  {
    // Production code gets the stricter variant: unlike test doubles, src should never rely on
    // implicit nullish coercion inside template expressions.
    files: toProductionFiles(allPackages),
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNullish: false, allowBoolean: true, allowNumber: true },
      ],
    },
  },
  // eslint-plugin-sf-plugin ships native flat configs (an array of config objects) rather than an
  // eslintrc-style shareable config, so it's applied directly instead of through the `scoped` /
  // FlatCompat helper used for the plugins that still only publish eslintrc configs.
  //
  // Both sfPluginPackages and mochaTestPackages are empty now that every package here is a library
  // (0026 moved every oclif command package to simply-plugins) - an empty `files: []` array is
  // invalid ESLint flat-config (throws, doesn't just match nothing), so these blocks are skipped
  // entirely rather than emitted with an empty files list. Re-add the spread once either package
  // list is non-empty again.
  ...(sfPluginPackages.length > 0
    ? sfPluginPlugin.configs.recommended.map((config) => ({ ...config, files: toSrcFiles(sfPluginPackages) }))
    : []),
  ...(mochaTestPackages.length > 0
    ? scoped(mochaTestPackages, { env: { mocha: true }, rules: testOverrideRules }, toTestFiles(mochaTestPackages))
    : []),
  ...scoped(libraryPackages, { rules: testOverrideRules }, toTestFiles(libraryPackages)),
];
