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

import { execa, type ExecaChildProcess, type Options } from 'execa';

/** The `sf` executable, as resolved from `PATH` in the CI job. */
const SF_BINARY = 'sf';

/**
 * Run the Salesforce CLI.
 *
 * Everything this package does to an org ultimately shells out to `sf`, and each site was
 * naming the binary itself. Options are forwarded only when a caller supplies them, so the
 * underlying `execa()` call keeps the exact arity each site had.
 *
 * @param args - Arguments to pass to `sf`.
 * @param options - Optional `execa` options, e.g. `{ stdio: 'inherit' }` to stream output
 * straight into the job log.
 * @returns The completed `execa` result.
 */
export function runSf(args: string[], options?: Options): ExecaChildProcess {
  return options ? execa(SF_BINARY, args, options) : execa(SF_BINARY, args);
}

/**
 * Run the Salesforce CLI and parse its `--json` output.
 *
 * The caller still passes `--json` in `args` — this doesn't inject it, because which commands
 * accept it and where it belongs in the argument list varies. What it does replace is the
 * `JSON.parse(stdout) as SomeShape` written out at each call site.
 *
 * @param args - Arguments to pass to `sf`, including `--json`.
 * @param options - Optional `execa` options.
 * @returns The parsed payload, typed as the caller asserts.
 * @throws {SyntaxError} If the command's output isn't valid JSON.
 */
export async function runSfJson<T>(args: string[], options?: Options): Promise<T> {
  const { stdout } = await runSf(args, options);

  return JSON.parse(stdout) as T;
}
