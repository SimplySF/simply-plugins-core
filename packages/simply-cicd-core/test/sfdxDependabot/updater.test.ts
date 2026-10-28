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

import { describe, expect, it, vi } from 'vitest';
import { detectIndentation, updateSfdxProject } from '../../src/sfdxDependabot/updater.js';
import { logger } from '../../src/logger.js';

vi.mock('../../src/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

describe('sfdxDependabot updater', () => {
  describe('detectIndentation', () => {
    it('should default to 2 spaces if no indentation is found', () => {
      const json = `{"a": 1}`;
      expect(detectIndentation(json)).toBe(2);
    });

    it('should detect 4 spaces indentation', () => {
      const json = `{\n    "a": 1\n}`;
      expect(detectIndentation(json)).toBe('    ');
    });

    it('should detect tab indentation', () => {
      const json = `{\n\t"a": 1\n}`;
      expect(detectIndentation(json)).toBe('\t');
    });
  });

  describe('updateSfdxProject', () => {
    it('should throw error if JSON is malformed', () => {
      expect(() => {
        updateSfdxProject('{invalid}', 'lwc-utilities', '2.41.0-1', '04tSJ000000AKwjYAG');
      }).toThrow('Malformed JSON in sfdx-project.json');
    });

    it('should skip if package is not a dependency', () => {
      const sfdxProject = {
        packageDirectories: [
          { path: 'force-app', default: true, dependencies: [{ package: 'other-package@1.0.0-1' }] },
        ],
        packageAliases: { 'other-package@1.0.0-1': '04t000000000001' },
      };

      const result = updateSfdxProject(
        JSON.stringify(sfdxProject, null, 2),
        'lwc-utilities',
        '2.41.0-1',
        '04tSJ000000AKwjYAG',
      );

      expect(result.changed).toBe(false);
      expect(result.hasDependency).toBe(false);
      expect(result.oldVersions).toEqual([]);
      expect(JSON.parse(result.newJsonContent)).toEqual(sfdxProject);
    });

    it('should update dependency when version differs and add/update package alias', () => {
      const sfdxProject = {
        packageDirectories: [
          { path: 'force-app', default: true, dependencies: [{ package: 'lwc-utilities@2.40.0-10' }] },
        ],
        packageAliases: { 'lwc-utilities@2.40.0-10': '04t000000000002' },
      };

      const result = updateSfdxProject(
        JSON.stringify(sfdxProject, null, 2),
        'lwc-utilities',
        '2.41.0-1',
        '04tSJ000000AKwjYAG',
      );

      expect(result.changed).toBe(true);
      expect(result.hasDependency).toBe(true);
      expect(result.oldVersions).toEqual(['2.40.0-10']);

      const parsed = JSON.parse(result.newJsonContent) as {
        packageAliases: Record<string, string>;
        packageDirectories: Array<{ dependencies: Array<{ package: string }> }>;
      };
      expect(parsed.packageDirectories[0].dependencies[0].package).toBe('lwc-utilities@2.41.0-1');
      expect(parsed.packageAliases['lwc-utilities@2.41.0-1']).toBe('04tSJ000000AKwjYAG');
      expect(parsed.packageAliases['lwc-utilities@2.40.0-10']).toBeUndefined();
    });

    it('should skip and report already current when version is already at target', () => {
      const sfdxProject = {
        packageDirectories: [
          { path: 'force-app', default: true, dependencies: [{ package: 'lwc-utilities@2.41.0-1' }] },
        ],
        packageAliases: { 'lwc-utilities@2.41.0-1': '04tSJ000000AKwjYAG' },
      };

      const result = updateSfdxProject(
        JSON.stringify(sfdxProject, null, 2),
        'lwc-utilities',
        '2.41.0-1',
        '04tSJ000000AKwjYAG',
      );

      expect(result.changed).toBe(false);
      expect(result.hasDependency).toBe(true);
      expect(result.oldVersions).toEqual([]);
      expect(JSON.parse(result.newJsonContent)).toEqual(sfdxProject);
    });

    it("should handle scoped packages correctly using lastIndexOf('@')", () => {
      const sfdxProject = {
        packageDirectories: [
          { path: 'force-app', default: true, dependencies: [{ package: '@my-scope/lwc-utilities@2.40.0-10' }] },
        ],
        packageAliases: { '@my-scope/lwc-utilities@2.40.0-10': '04t000000000002' },
      };

      const result = updateSfdxProject(
        JSON.stringify(sfdxProject, null, 2),
        '@my-scope/lwc-utilities',
        '2.41.0-1',
        '04tSJ000000AKwjYAG',
      );

      expect(result.changed).toBe(true);
      expect(result.hasDependency).toBe(true);
      expect(result.oldVersions).toEqual(['2.40.0-10']);

      const parsed = JSON.parse(result.newJsonContent) as {
        packageAliases: Record<string, string>;
        packageDirectories: Array<{ dependencies: Array<{ package: string }> }>;
      };
      expect(parsed.packageDirectories[0].dependencies[0].package).toBe('@my-scope/lwc-utilities@2.41.0-1');
      expect(parsed.packageAliases['@my-scope/lwc-utilities@2.41.0-1']).toBe('04tSJ000000AKwjYAG');
    });

    it('should log a warning if an exact matching package is in packageAliases but dependency is alias-only', () => {
      const sfdxProject = {
        packageDirectories: [{ path: 'force-app', default: true, dependencies: [{ package: 'lwc-utilities' }] }],
        packageAliases: { 'lwc-utilities': '04t000000000002' },
      };

      vi.mocked(logger.warn).mockClear();

      const result = updateSfdxProject(
        JSON.stringify(sfdxProject, null, 2),
        'lwc-utilities',
        '2.41.0-1',
        '04tSJ000000AKwjYAG',
      );

      expect(result.changed).toBe(false);
      expect(result.hasDependency).toBe(false);
      expect(result.oldVersions).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dependency reference "lwc-utilities" is in alias-only format'),
      );
    });
  });
});
