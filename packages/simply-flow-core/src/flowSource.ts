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

import path from 'node:path';
import { glob } from 'glob';

/** @returns The Flow DeveloperName encoded in a `<DeveloperName>.flow-meta.xml` file's basename. */
export function developerNameFromFlowFile(filePath: string): string {
  return path.parse(filePath).name.replace('.flow-meta', '');
}

/**
 * Finds every `*.flow-meta.xml` under each source directory and returns the Flow DeveloperNames.
 *
 * @param sourceDirs - Directories to search recursively. Windows-style separators are accepted.
 * @returns DeveloperNames, deduplicated across directories, in first-occurrence order.
 */
export async function findFlowNamesInSource(sourceDirs: readonly string[]): Promise<string[]> {
  const flowFiles = (
    await Promise.all(sourceDirs.map((sourceDir) => glob(`${sourceDir.replaceAll('\\', '/')}/**/*.flow-meta.xml`)))
  ).flat();
  return [...new Set(flowFiles.map(developerNameFromFlowFile))];
}
