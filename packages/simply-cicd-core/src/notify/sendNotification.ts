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

import { logger } from '../logger.js';

type NotificationResult = { url: string; status: 'success' | 'failure'; error?: unknown };

/** Sends a notification payload to one or more Microsoft Teams incoming webhooks. */
export async function sendNotification(
  teamsWebhookUrl: string | string[] | undefined,
  payload: unknown,
): Promise<void> {
  const urls = Array.isArray(teamsWebhookUrl) ? teamsWebhookUrl : [teamsWebhookUrl];
  const nonEmptyUrls = urls.filter((u): u is string => Boolean(u));

  if (nonEmptyUrls.length === 0) {
    logger.warn('No webhook URLs provided. Skipping notification.');
    return;
  }

  const notificationPromises = nonEmptyUrls.map(async (url): Promise<NotificationResult> => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
      });

      if (!response.ok) {
        throw new Error(`Response not OK. Status: ${response.status} ${response.statusText}`);
      }

      logger.success(`Successfully sent notification to ${url}`);
      return { url, status: 'success' };
    } catch (error) {
      logger.error(`Failed to send notification to ${url}: ${(error as Error).message}`);
      return { url, status: 'failure', error };
    }
  });

  const results = await Promise.all(notificationPromises);
  const failures = results.filter((r) => r.status === 'failure');

  if (failures.length > 0) {
    const failedUrls = failures.map((f) => f.url).join(', ');
    throw new Error(`Failed to send ${failures.length} notification(s) to: ${failedUrls}`);
  }
}
