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

const LOCAL_NAMES = new Set(['local', 'Local', 'LOCAL']);

const deploymentSchema = z
  .object({
    name: z.string(),
    slug: z.string().optional(),
    ref: z.string().optional(),
    unpackagedDeploy: z.boolean().optional(),
    postDeploy: z.boolean().optional(),
    preDestructive: z.boolean().optional(),
    postDestructive: z.boolean().optional(),
  })
  .strict()
  .superRefine((deployment, ctx) => {
    if (!LOCAL_NAMES.has(deployment.name) && deployment.slug === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Deployment "${deployment.name}" must have a "slug" unless its name is one of: ${[...LOCAL_NAMES].join(', ')}.`,
        path: ['slug'],
      });
    }

    const hasStage =
      deployment.unpackagedDeploy !== undefined ||
      deployment.postDeploy !== undefined ||
      deployment.preDestructive !== undefined ||
      deployment.postDestructive !== undefined;

    if (!hasStage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Deployment "${deployment.name}" must specify at least one of: unpackagedDeploy, postDeploy, preDestructive, postDestructive.`,
        path: [],
      });
    }
  });

/** Zod equivalent of the original `deploy.schema.json`. */
export const deployConfigSchema = z
  .object({
    deployments: z.array(deploymentSchema),
  })
  .strict();

export type DeploymentConfig = z.infer<typeof deploymentSchema>;
export type DeployConfig = z.infer<typeof deployConfigSchema>;
