import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static marketing site. Output: site/dist. Domain from PUBLIC_SITE_URL (see src/site.ts).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://naqsha-zameen.com',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      entryLimit: 10000, // several sitemap files under sitemap-index.xml
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const depth = path.split('/').filter(Boolean).length;
        let priority = 0.7, changefreq = 'monthly';
        if (path === '/') { priority = 1.0; changefreq = 'weekly'; }
        else if (path.startsWith('/services/')) priority = 0.9;
        else if (path === '/maps/') { priority = 0.9; changefreq = 'weekly'; }
        else if (path.startsWith('/maps/')) priority = depth === 2 ? 0.8 : 0.6;
        return { ...item, lastmod: new Date().toISOString(), priority, changefreq };
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  // concurrency: render several pages at once (thousands of /maps/ pages).
  build: { inlineStylesheets: 'auto', concurrency: 8 },
  compressHTML: true,
});
