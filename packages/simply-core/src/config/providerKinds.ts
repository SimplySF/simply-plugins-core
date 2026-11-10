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
 * The source-control-hosting platforms the SimplySF tooling knows how to talk to. The provider
 * implementations and their registry live in `@simplysf/simply-cicd-core`; only the names live here,
 * so a config file can be validated without depending on those implementations.
 */
export const VCS_PROVIDER_KINDS = ['gitlab', 'github'] as const;

/** A source-control-hosting platform name. See {@link VCS_PROVIDER_KINDS}. */
export type VcsProviderKind = (typeof VCS_PROVIDER_KINDS)[number];

/**
 * The application-lifecycle-management tools (issue trackers) the SimplySF tooling knows how to
 * reference. Implementations live in `@simplysf/simply-cicd-core`, as with {@link VCS_PROVIDER_KINDS}.
 */
export const ALM_PROVIDER_KINDS = ['jira', 'gitlab-issues'] as const;

/** An issue-tracker name. See {@link ALM_PROVIDER_KINDS}. */
export type AlmProviderKind = (typeof ALM_PROVIDER_KINDS)[number];
