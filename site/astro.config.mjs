import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

const engine = fileURLToPath(new URL('../packages/inheritance-engine/src/index.ts', import.meta.url));

// Static marketing site. Output: site/dist. Domain from PUBLIC_SITE_URL (see src/site.ts).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://naqsha-zameen.com',
  integrations: [
    react({ include: ['**/tools/**'] }),
    sitemap({
      filter: (page) => !page.includes('/404') && !page.endsWith('/dashboard/'),
      entryLimit: 10000, // several sitemap files under sitemap-index.xml
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const depth = path.split('/').filter(Boolean).length;
        let priority = 0.7, changefreq = 'monthly';
        if (path === '/') { priority = 1.0; changefreq = 'weekly'; }
        else if (path.startsWith('/services/')) priority = 0.9;
        else if (path === '/maps/') { priority = 0.9; changefreq = 'weekly'; }
        else if (path.startsWith('/maps/')) priority = depth === 2 ? 0.8 : 0.6;
        // Only emit lastmod on primary marketing pages so 21k+ static /maps/ pages don't churn crawl budget on every build
        const includeLastmod = path === '/' || path === '/maps/' || !path.startsWith('/maps/');
        return includeLastmod
          ? { ...item, lastmod: new Date().toISOString(), priority, changefreq }
          : { ...item, priority, changefreq };
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Shared inheritance engine (packages/inheritance-engine), used by /tools/shajra-nasab/.
    resolve: { alias: { 'inheritance-engine': engine } },
    server: { fs: { allow: ['..'] } },
  },
  // concurrency: render several pages at once (thousands of /maps/ pages).
  // Pages rendered in parallel. deploy.sh sets SITE_BUILD_CONCURRENCY=2 on the VPS to keep it responsive.
  build: { inlineStylesheets: 'auto', concurrency: Number(process.env.SITE_BUILD_CONCURRENCY) || 8 },
  compressHTML: true,
});
