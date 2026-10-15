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
import { SfProject, type Connection } from '@salesforce/core';
import { AepGenerationError } from './errors.js';
import { toDescribeView, type SObjectDescribeView } from './describe.js';
import { MAX_CUSTOM_METADATA_RECORD_NAME_LENGTH } from './naming.js';

export const DEFAULT_OUTPUT_PATH = 'generated-files';
export const DEFAULT_API_VERSION = '60.0';
export const ORDER_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * @param outputPath - Absolute, or relative to `projectRoot`.
 * @param projectRoot - Defaults to the Salesforce DX project containing the working directory.
 * @returns The absolute output directory.
 */
export const resolveOutputBase = async (outputPath: string, projectRoot?: string): Promise<string> => {
  if (path.isAbsolute(outputPath)) return outputPath;
  return path.resolve(projectRoot ?? (await SfProject.resolveProjectPath()), outputPath);
};

/**
 * @param projectRoot - Defaults to the Salesforce DX project containing the working directory.
 * @returns The project's `sourceApiVersion`, or `undefined` outside a project.
 */
export const resolveProjectApiVersion = async (projectRoot?: string): Promise<string | undefined> => {
  try {
    const project = await SfProject.resolve(projectRoot);
    const projectConfig = await (await project.retrieveSfProjectJson()).read();
    return projectConfig.sourceApiVersion;
  } catch (error) {
    if (error instanceof Error && error.name === 'InvalidProjectWorkspaceError') return undefined;
    throw error;
  }
};

export type ApiVersionOptions = { conn?: Pick<Connection, 'getApiVersion'>; explicit?: string; projectRoot?: string };

/**
 * Precedence: the explicit value, then the connection's version, then {@link DEFAULT_API_VERSION}.
 *
 * @param options - The candidates.
 * @returns The API version generated metadata declares.
 */
export const resolveApiVersion = ({ conn, explicit }: ApiVersionOptions): Promise<string> => {
  // An empty string counts as not given, as it did in apx-core — hence not `??`.
  if (explicit) return Promise.resolve(explicit);
  return Promise.resolve(conn ? conn.getApiVersion() : DEFAULT_API_VERSION);
};

/**
 * @param conn - A connection that can describe.
 * @param sobject - The SObject API name.
 * @returns The describe, narrowed to what the generators use.
 * @throws {AepGenerationError} `sobject-not-found` or `describe-failed`, both carrying the original error as `data.cause`.
 */
export const describeTarget = async (
  conn: Pick<Connection, 'describeSObject'>,
  sobject: string,
): Promise<SObjectDescribeView> => {
  try {
    return toDescribeView(await conn.describeSObject(sobject));
  } catch (cause) {
    const details = cause as { name?: string; errorCode?: string; code?: string } | null;
    const notFound =
      details?.name === 'NOT_FOUND' || details?.errorCode === 'NOT_FOUND' || details?.code === 'NOT_FOUND';
    const message = cause instanceof Error ? cause.message : String(cause);
    if (notFound) throw new AepGenerationError('sobject-not-found', message, { sobject, cause });
    throw new AepGenerationError('describe-failed', message, { sobject, cause });
  }
};

export const isValidOrderValue = (value: string): boolean => ORDER_PATTERN.test(value);
export const isWithinCustomMetadataNameLimit = (value: string): boolean =>
  value.length <= MAX_CUSTOM_METADATA_RECORD_NAME_LENGTH;
