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

import { Duration } from '@salesforce/kit';

/**
 * Bounds a single attempt at any Connect/SOQL call this package makes against the org, so a stalled
 * TCP/TLS handshake (e.g. a CI runner's network path to the org differing from a desktop's) fails
 * fast instead of hanging forever. See docs/design/0040-community-publish-request-timeouts.md.
 */
export const DEFAULT_PUBLISH_REQUEST_TIMEOUT = Duration.seconds(30);
