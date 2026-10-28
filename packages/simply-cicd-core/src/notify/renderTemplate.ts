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

import Handlebars from 'handlebars';
import { NOTIFY_TEMPLATES, type NotifyTemplateName } from './templates.js';

const handlebars = Handlebars.create();

/** Renders one of the built-in Teams notification card templates with the given data. */
export function renderNotifyTemplate(templateName: NotifyTemplateName, data: Record<string, unknown>): string {
  const template = handlebars.compile(NOTIFY_TEMPLATES[templateName]);
  return template(data);
}
