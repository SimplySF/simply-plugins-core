import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';
import { remarkBaseLinks } from './plugins/remark-base-links.mjs';

const base = '/simply-plugins-core';

// One instance per package: each needs its own sidebar-group placeholder (from
// createStarlightTypeDocPlugin) so their generated entries don't collide, and its own
// non-overlapping `output` directory under src/content/docs/api/.
const [simplyCore, simplyCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyAepCore, simplyAepCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyApexCore, simplyApexCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyDocumentCore, simplyDocumentCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyReport, simplyReportSidebar] = createStarlightTypeDocPlugin();
const [simplyPermissionsCore, simplyPermissionsCoreSidebar] = createStarlightTypeDocPlugin();
const [simplySobjectCore, simplySobjectCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyCommunityCore, simplyCommunityCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyDataCore, simplyDataCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyPackageCore, simplyPackageCoreSidebar] = createStarlightTypeDocPlugin();
const [simplySchemaCore, simplySchemaCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyProjectSetupCore, simplyProjectSetupCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyCicdCore, simplyCicdCoreSidebar] = createStarlightTypeDocPlugin();
const [simplySettingsCore, simplySettingsCoreSidebar] = createStarlightTypeDocPlugin();
const [simplyFlowCore, simplyFlowCoreSidebar] = createStarlightTypeDocPlugin();

function typeDocOptions(pkg) {
  return {
    entryPoints: [`../packages/${pkg}/src/index.ts`],
    tsconfig: `../packages/${pkg}/tsconfig.json`,
    output: `api/${pkg}`,
    sidebar: { label: pkg },
    typeDoc: {
      // Every export in `src/index.ts` is the package's public API (see each package's own
      // comment above its exports) - group them by source file so the sidebar/page structure
      // mirrors the source layout instead of one flat alphabetical list.
      groupOrder: ['Functions', 'Classes', 'Type Aliases', '*'],
      excludePrivate: true,
      excludeInternal: true,
      readme: 'none',
    },
  };
}

export default defineConfig({
  site: 'https://simplysf.github.io',
  base,
  markdown: {
    remarkPlugins: [remarkBaseLinks(base)],
  },
  integrations: [
    starlight({
      customCss: ['./src/styles/custom.css'],
      title: 'Simply Plugins Core',
      description:
        "The core Node/TypeScript libraries behind SimplySF's Salesforce CLI plugins, published standalone and framework-independent: querying and bulk data, AT4DX binding scan/resolution, Apex tooling, permission set/schema/package/community/sobject logic, State and Country/Territory picklist automation, document/report rendering, and more.",
      logo: {
        light: './src/assets/logo-icon.png',
        dark: './src/assets/logo-icon-dark.png',
        alt: 'Simply SF logo',
      },
      favicon: '/favicon.png',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/SimplySF/simply-plugins-core' }],
      editLink: {
        baseUrl: 'https://github.com/SimplySF/simply-plugins-core/edit/main/site/',
      },
      plugins: [
        simplyCore(typeDocOptions('simply-core')),
        simplyAepCore(typeDocOptions('simply-aep-core')),
        simplyApexCore(typeDocOptions('simply-apex-core')),
        simplyDocumentCore(typeDocOptions('simply-document-core')),
        simplyReport(typeDocOptions('simply-report')),
        simplyPermissionsCore(typeDocOptions('simply-permissions-core')),
        simplySobjectCore(typeDocOptions('simply-sobject-core')),
        simplyCommunityCore(typeDocOptions('simply-community-core')),
        simplyDataCore(typeDocOptions('simply-data-core')),
        simplyPackageCore(typeDocOptions('simply-package-core')),
        simplySchemaCore(typeDocOptions('simply-schema-core')),
        simplyProjectSetupCore(typeDocOptions('simply-project-setup-core')),
        simplyCicdCore(typeDocOptions('simply-cicd-core')),
        simplySettingsCore(typeDocOptions('simply-settings-core')),
        simplyFlowCore(typeDocOptions('simply-flow-core')),
      ],
      sidebar: [
        { label: 'Get Started', slug: 'getting-started' },
        {
          label: 'Guides',
          items: [
            { label: 'simply-core', slug: 'guides/simply-core' },
            { label: 'simply-aep-core', slug: 'guides/simply-aep-core' },
            { label: 'simply-apex-core', slug: 'guides/simply-apex-core' },
            { label: 'simply-document-core', slug: 'guides/simply-document-core' },
            { label: 'simply-report', slug: 'guides/simply-report' },
            { label: 'simply-permissions-core', slug: 'guides/simply-permissions-core' },
            { label: 'simply-sobject-core', slug: 'guides/simply-sobject-core' },
            { label: 'simply-community-core', slug: 'guides/simply-community-core' },
            { label: 'simply-data-core', slug: 'guides/simply-data-core' },
            { label: 'simply-package-core', slug: 'guides/simply-package-core' },
            { label: 'simply-schema-core', slug: 'guides/simply-schema-core' },
            { label: 'simply-project-setup-core', slug: 'guides/simply-project-setup-core' },
            { label: 'simply-cicd-core', slug: 'guides/simply-cicd-core' },
            { label: 'simply-settings-core', slug: 'guides/simply-settings-core' },
            { label: 'simply-flow-core', slug: 'guides/simply-flow-core' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            simplyCoreSidebar,
            simplyAepCoreSidebar,
            simplyApexCoreSidebar,
            simplyDocumentCoreSidebar,
            simplyReportSidebar,
            simplyPermissionsCoreSidebar,
            simplySobjectCoreSidebar,
            simplyCommunityCoreSidebar,
            simplyDataCoreSidebar,
            simplyPackageCoreSidebar,
            simplySchemaCoreSidebar,
            simplyProjectSetupCoreSidebar,
            simplyCicdCoreSidebar,
            simplySettingsCoreSidebar,
            simplyFlowCoreSidebar,
          ],
        },
      ],
    }),
  ],
});
