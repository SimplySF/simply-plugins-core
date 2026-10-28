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

import { z } from 'zod';

/** A single packaged dependency upgraded by `deploy happy-soup install-packaged`. */
const upgradedPackageSchema = z.object({
  packageName: z.string(),
  prevVersionId: z.string(),
  prevVersionNumber: z.string().optional(),
  /** The origin git commit SHA for the previous version, from that version's `report.Tag`. */
  prevTag: z.string().optional(),
  targetVersionId: z.string(),
  targetVersionNumber: z.string().optional(),
  /** The origin git commit SHA for the target version, from that version's `report.Tag`. */
  targetTag: z.string().optional(),
  /**
   * The target version's `report.Description` (the origin CI pipeline URL). Used at notify time
   * to resolve which VCS project the package's source lives in; the origin repo is assumed stable
   * between a package's previous and target version, so only the target's URL is kept.
   */
  targetDescription: z.string().optional(),
});

/** Zod equivalent of the original `deploy_progress.schema.json`. */
export const deployProgressSchema = z
  .object({
    preDestructive: z.string().optional(),
    unpackagedDeploy: z.string().optional(),
    postDeploy: z.string().optional(),
    postDestructive: z.string().optional(),
    durations: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    upgradedPackages: z.array(upgradedPackageSchema).optional(),
  })
  .strict();

export type DeployProgress = z.infer<typeof deployProgressSchema>;
export type UpgradedPackage = z.infer<typeof upgradedPackageSchema>;
