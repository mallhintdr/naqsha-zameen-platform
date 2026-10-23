# Naqsha Zameen website

Static marketing site for **naqsha-zameen.pk** (Astro + Tailwind). The dashboard itself
lives at **dashboard.naqsha-zameen.pk** and is built from `../web`.

## Edit content
Business details (phone, WhatsApp, email, links) are in `src/site.ts`. Pages are in `src/pages/`.

## Run locally
```
npm install
npm run dev        # http://localhost:4321
```

## Deploy
`../deploy.sh` builds this into `site/dist`. Point the main domain at that folder, e.g. nginx:

```nginx
server {
  server_name naqsha-zameen.pk www.naqsha-zameen.pk;
  root /path/to/repo/site/dist;
  location / { try_files $uri $uri/ $uri.html =404; }
  location /_astro/ { expires 1y; add_header Cache-Control "public, immutable"; }
  error_page 404 /404.html;
}
```

It also works unchanged on Cloudflare Pages, Netlify or Vercel (build command `npm run build`,
output folder `dist`, root directory `site`).

## Turning on ads (Google AdSense)
Everything is ready but switched off, so no ad scripts or cookies load today.

1. Apply at https://adsense.google.com with the domain `naqsha-zameen.pk` (the site must be live).
2. In `src/site.ts`, set `ADS.adsenseClient` to your publisher ID (`ca-pub-…`) and fill `ADS.slots` with ad unit IDs.
3. Redeploy. This automatically:
   - loads the AdSense script and adds the `google-adsense-account` meta tag,
   - publishes `/ads.txt` with your publisher ID,
   - shows labelled ad slots on the home page and each service page,
   - shows a cookie-consent banner with Google Consent Mode v2 (ads are non-personalised until accepted),
   - adds a "Cookie settings" link in the footer.

For visitors in the EEA/UK, Google requires a Google-certified consent platform. Before targeting
those regions, turn on Google's own consent message in AdSense (Privacy & messaging), or replace the
built-in banner with a certified one.

## Visitor counter
Every page sends one anonymous hit to `SITE.visitsEndpoint` (`src/site.ts`), which is the dashboard
backend route `POST /api/site-visits`. Admins see daily / weekly / monthly / total visits under
**Statistics → Website** in the dashboard. Set `visitsEndpoint` to `''` to switch counting off.

## SEO checklist after going live
1. Add the site to https://search.google.com/search-console, choose "HTML tag" verification and paste
   the `content` value into `SITE.googleSiteVerification` in `src/site.ts`, then redeploy.
2. In Search Console, submit the sitemap: `https://naqsha-zameen.pk/sitemap-index.xml`.
3. Make sure `www.naqsha-zameen.pk` redirects to `naqsha-zameen.pk` (301) in nginx / Cloudflare.
4. Create a Google Business Profile for GeoMatrix Technologies and link to the website.
