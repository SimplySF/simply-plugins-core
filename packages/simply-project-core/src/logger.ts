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

/* eslint-disable no-console -- this module is the sole intended console output surface for simply-project-core */

import chalk from 'chalk';
import logSymbols from 'log-symbols';

chalk.level = 1;

const logPrefix = chalk.yellow('[SIMPLY-PROJECT]');

const format = (message: string): string => `${logPrefix} ${message}`;

/** A logger utility for consistent logging across the simply-project-core package's modules. */
export const logger = {
  info: (message: string, ...args: unknown[]): void => console.log(logSymbols.info, format(message), ...args),
  warn: (message: string, ...args: unknown[]): void => console.warn(logSymbols.warning, format(message), ...args),
};
