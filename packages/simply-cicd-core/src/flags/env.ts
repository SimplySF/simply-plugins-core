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

/**
 * Coerce a string or boolean to a boolean. `'true'`/`'false'` are recognised
 * case- and whitespace-insensitively; anything else is `false`.
 *
 * Environment variables are always strings, unlike the boolean flags oclif parses natively, so
 * any flag with an env-var fallback needs this on the env side.
 *
 * @param value - The raw flag or environment value.
 * @returns The coerced boolean.
 */
export function parseBooleanString(value: string | boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return false;
}

/**
 * Resolve a string setting with CLI flag > environment variable > fallback precedence.
 *
 * Several settings accept more than one environment variable — a `SIMPLY_CICD_`-prefixed name of
 * our own plus whatever the CI provider already exports — so the env side takes a list, tried in
 * order.
 *
 * @param flagValue - The parsed CLI flag, if the caller passed one.
 * @param envVars - Candidate environment values, most specific first.
 * @param fallback - Used when neither the flag nor any environment variable is set.
 * @returns The resolved value.
 */
export function resolveString(
  flagValue: string | undefined,
  envVars: Array<string | undefined>,
  fallback = '',
): string {
  return flagValue ?? envVars.find((value) => value !== undefined) ?? fallback;
}

/**
 * {@link resolveString} for settings with no default, where "unset" is meaningful.
 *
 * @param flagValue - The parsed CLI flag, if the caller passed one.
 * @param envVars - Candidate environment values, most specific first.
 * @returns The resolved value, or `undefined` if nothing supplied one.
 */
export function resolveOptionalString(
  flagValue: string | undefined,
  envVars: Array<string | undefined>,
): string | undefined {
  return flagValue ?? envVars.find((value) => value !== undefined);
}

/**
 * Resolve a boolean setting with CLI flag > environment variable > fallback precedence.
 *
 * The flag is checked for `undefined` rather than falsiness, so an explicit `--no-…` stays
 * distinguishable from an unset flag and still beats the environment.
 *
 * @param flagValue - The parsed CLI flag, if the caller passed one.
 * @param envVar - The environment value, coerced via {@link parseBooleanString}.
 * @param fallback - Used when neither the flag nor the environment variable is set.
 * @returns The resolved boolean.
 */
export function resolveBoolean(flagValue: boolean | undefined, envVar: string | undefined, fallback: boolean): boolean {
  if (flagValue !== undefined) {
    return flagValue;
  }

  return envVar !== undefined ? parseBooleanString(envVar) : fallback;
}
