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

import fs from 'node:fs';

export type EnvLogger = {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

/**
 * Appends key-value pairs to a .env style file. If the file exists and its content doesn't end
 * with a newline, a leading newline is added before appending. Creates the file if it doesn't exist.
 */
export function appendToEnvFile(
  filePath: string,
  variables: Record<string, string | undefined>,
  log?: EnvLogger,
): void {
  const targetLogger = log ?? console;
  const lines = Object.entries(variables)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`);

  if (lines.length === 0) {
    return;
  }

  const variablesToAppend = lines.join('\n') + '\n';

  try {
    let contentToAppend = variablesToAppend;
    if (fs.existsSync(filePath)) {
      const currentContent = fs.readFileSync(filePath, 'utf8');
      if (currentContent && !currentContent.endsWith('\n')) {
        contentToAppend = `\n${variablesToAppend}`;
      }
    }

    fs.appendFileSync(filePath, contentToAppend, 'utf8');
    targetLogger.info(`Variables successfully appended to ${filePath}!`);
  } catch (error) {
    const err = error as Error;
    targetLogger.error(`Error appending to ${filePath}: ${err.message}`);
    throw err;
  }
}
