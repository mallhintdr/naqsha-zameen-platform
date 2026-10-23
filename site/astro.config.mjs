import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static marketing site. Output: site/dist. Domain from PUBLIC_SITE_URL (see src/site.ts).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://naqsha-zameen.com',
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
