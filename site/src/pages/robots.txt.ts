import type { APIRoute } from 'astro';
import { SITE } from '../site';

// Built per domain, so the sitemap address always matches the site being built.
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /404\n\nSitemap: ${SITE.url}/sitemap-index.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
