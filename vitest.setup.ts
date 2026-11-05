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

import { Console } from 'node:console';

// Vitest replaces the global `console` with its own console-like object for capturing test
// output, but that replacement doesn't carry over Node's `Console` class. `patch-console` (used
// by ink, which oclif's table renderer depends on) does `new console.Console(...)` and throws
// "console.Console is not a constructor" without it.
if (typeof console.Console !== 'function') {
  (console as unknown as { Console: typeof Console }).Console = Console;
}

// A git hook, such as husky's pre-push running these tests, exports variables like GIT_DIR and
// GIT_INDEX_FILE. Every git command a test runs would inherit them and act on this repository
// instead of the test's temporary one: committing to its branches, tagging, and even setting
// core.bare. Clearing them here protects every test, not just the ones that remember to.
for (const name of Object.keys(process.env).filter((key) => key.startsWith('GIT_'))) {
  delete process.env[name];
}
