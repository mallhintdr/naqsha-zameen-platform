# Naqsha Zameen marketing site: critical review (2026-10-23)

Scope: `D:\temp-repo\site` (Astro 5 + Tailwind 4) and the live site at https://naqsha-zameen.pk. Screenshots are in `scratchpad\site-shots\` (390 and 1280 px; /, /dashboard/, /contact/).

## P0: broken or misleading

1. **The visit counter never records anything.**
   - The client POSTs JSON to `https://dashboard.naqsha-zameen.pk/api/site-visits` (`src/site.ts` `visitsEndpoint`, `src/components/VisitCounter.astro`).
   - The backend has no such route. It only exposes `GET /api/visit.gif?p=` (`backend/routes/statsRoutes.js:13`).
   - Live test: `POST /api/site-visits` returns 200 with the dashboard's SPA `index.html` (an SPA fallback), so the counter fails silently. The README section "Visitor counter" describes this route, which doesn't exist.
   - Fix: send `new Image().src = 'https://dashboard.naqsha-zameen.pk/api/visit.gif?p=' + path`, or `navigator.sendBeacon` to a real route. Also make the API return 404 JSON for unknown `/api/*` paths instead of falling back to the SPA.

2. **The canonical host contradicts the stated target.**
   - The brief says the site lives at www. In practice `.htaccess` (`public/.htaccess:8-9`) 301-redirects www to the apex, and `astro.config.mjs` `site` plus every canonical, OG URL, sitemap and robots entry use the apex. It is consistent, but it's the opposite of the stated target. Decide on one host.
   - `http://www` takes two hops: `http://www` → `https://www` → apex (checked live). Collapse it into one rule: `RewriteCond %{HTTP_HOST} ^www\. [OR] RewriteCond %{HTTPS} off` → `https://naqsha-zameen.pk%{REQUEST_URI}`.

3. **Legacy `/register` on the marketing domain 404s**: https://naqsha-zameen.pk/register returns 404. Old links, Facebook posts and printed material may still point there.
   - Every site CTA now targets `dashboard.naqsha-zameen.pk/register` (`site.ts:7`), which is correct.
   - Add `Redirect 301 /register https://dashboard.naqsha-zameen.pk/register`, and the same for `/login` and `/signup`.
   - Verify that the **live** dashboard (still the old CRA build on o3host) actually has `/register` and `/login` client routes. Both return the 698-byte SPA shell with 200, so a missing route would surface as a blank page, not a 404.

4. **Sections stay invisible until JavaScript runs.**
   - `.reveal` plus an IntersectionObserver (`src/layouts/Base.astro:219-245`, used in `CTA.astro:16` and `FAQ.astro:15,18`) hides content until it scrolls into view.
   - The full-page 390 px screenshot (`390_.png`) shows a roughly 4000 px blank band between the hero and the footer: every section below the hero is invisible.
   - Readers without JS, slow phones, crawlers that render a single viewport, and print all see an empty page.
   - Fix: only hide when `html.js` is set and `prefers-reduced-motion` is not set, and fall back to visible.

5. **No pricing anywhere.**
   - A grep for price, Rs or PKR across `src/` finds nothing. The FAQ says "choose a monthly or yearly plan" (`index.astro:30`) but never says what the plans cost.
   - For a paid product sold to price-sensitive patwaris and dealers this is the biggest conversion gap. Payment today is JazzCash/EasyPaisa, and the site doesn't explain how to pay either.

## P1: conversion and trust

6. **No coverage map or list.** "We cover tehsils across Punjab" (`index.astro:28`) is vague.
   - Publish the actual list of available tehsils and mouzas (generated from the backend at build time), with a searchable map.
   - Add one SEO landing page per tehsil, e.g. `/coverage/<tehsil>/`. This is the strongest search play available ("<tehsil> ka naqsha", "<chak> shajra").

7. **No real product imagery.** The hero is an illustrated mock (`MapMock.astro`) showing a fake "Chak 47/GD", and /dashboard/ has no real screenshots or video. Add real phone screenshots or a 30-second screen recording of tehsil → chak → murabba → killa, plus GPS walking.

8. **Thin trust signals.**
   - No testimonials, no NTN or SECP registration, no physical address (only "Punjab, Pakistan"), no team or photos of the RTK and drone equipment, no case studies.
   - The contact email is a personal Gmail address (`site.ts:13`). Use something like `info@naqsha-zameen.pk`.

9. **Mostly English, with token Urdu lines.**
   - The audience (patwaris, landowners) is largely Urdu or Punjabi first, but Urdu appears only in decorative lines (3 `lang="ur"` elements on the home page).
   - Add a full `/ur/` locale (or at least Urdu FAQs, CTAs and service blurbs), with `hreflang` pairs.

10. **The contact form only opens WhatsApp** (`contact.astro:34-52`).
    - That's acceptable for this market, but there is no fallback (email or backend lead capture) and no record of leads.
    - Consider POSTing to a backend `/api/leads` endpoint and then opening WhatsApp.

11. **"Free trial" in the header is the primary CTA, but the trial's terms are unexplained.** The site never says the trial lasts 24 hours, which tehsil it covers, or that it needs no card. Keep the CTA copy consistent across the site and link it to a pricing page.

## P1: SEO and performance

12. **Image weights.**
   - `public/logo.png` is **378 KB** and is used as the favicon, apple-touch-icon and JSON-LD logo (`Base.astro:91-93`). It's served with no cache header.
   - `src/assets/logo.png` is a **4.0 MB** unused source file.
   - `og.png` is 125 KB, which is acceptable.
   - Fix: a 180 px apple-touch icon (<10 KB), a 512 px logo in WebP/PNG (<30 KB), and delete the 4 MB file.

13. **Fonts block rendering.** The page pulls 3 Google font families, including Noto Nastaliq Urdu, which is very heavy (`Base.astro:115-118`).
    - Self-host with `@fontsource`.
    - Subset Nastaliq to the glyphs used, or load it only on Urdu blocks with `font-display: swap`.
    - Either way this removes the third-party privacy dependency.

14. **Caching and security headers.**
   - `.htaccess` caches only js, css and woff, and does not mark `/_astro/` as immutable for images.
   - There's no HTML cache policy, no HSTS, no `X-Content-Type-Options`, no `Referrer-Policy`, no `frame-ancestors`/`X-Frame-Options`, and no CSP. None of these headers appear in the live response.
   - Add them in `.htaccess`, with HSTS only after the host decision in item 2 is settled.

15. **Structured data needs work.**
   - The Organization block is good, but `address` has no locality or street, and there is no `LocalBusiness` with `geo` or `openingHours`.
   - There is no `FAQPage` for the FAQ component, and no `Product`/`Offer` with prices for subscriptions.
   - Breadcrumb names are derived from slugs (`Base.astro:27-30`), so `/services/rtk-survey/` produces "Rtk Survey".
   - The dashboard URL appears in `sameAs`, which is wrong because it isn't a profile page.

16. **Search Console isn't set up.** `googleSiteVerification` is empty (`site.ts:17`). Robots and the sitemap are fine.

## P2: design consistency and accessibility

17. **The palette diverges from the dashboard.**
   - The site uses indigo `#4f46e5` + cyan `#06b6d4` on `#070b24` (`global.css:7-9`), with indigo gradients in CTA and MapMock.
   - The dashboard uses navy radial gradients `rgba(11,14,40)` → `rgba(18,26,54)`, cyan `#00ffff`/`#0096c7` and gold `#FFD700`. There is no gold anywhere on the site.
   - Align the tokens so the hand-off from site to app feels like one product. Gold suits the primary CTA and price highlights.

18. **Small, low-contrast text.** The 10 px uppercase company label (`Base.astro:146`) and slate-400 text on near-black are below comfortable size for an older rural audience. Raise the base size to 17-18 px on mobile and use slate-300 at minimum.

19. **Smaller accessibility issues.**
   - Images all have alt text (verified).
   - The heading order is OK (one h1, then h2/h3).
   - The mobile menu has `aria-expanded`, but check that it closes on Escape and returns focus to the button.
   - The skip link is present.

## P2: ads and privacy

20. **Ads don't belong on this site.**
   - AdSense scaffolding (`AdSlot.astro`, `Consent.astro`, `ads.txt.ts`) is off today (`ads.txt` reads "No advertising partners yet").
   - Running third-party ads on a paid B2B/B2C product site lowers trust and can show competitors' ads. Remove `AdSlot` from the home and service pages entirely.
   - `Consent.astro` calls `gtag(...)` without checking that it exists. That's safe only while ads are off.

21. **Privacy.** The visitor ID is stored in localStorage (`nz_vid`) with no notice beyond the privacy page. Prefer cookieless counting (the GIF beacon) or Plausible/Umami self-hosted, and update `/privacy/` to match.

## P2: engineering

22. **Repo hygiene: `site/` is entirely untracked** (`?? site/` in git status).
   - Before adding it, ignore `site/dist/`, `site/.astro/`, `site/node_modules/` and `site/*.log`.
   - The root `.gitignore` covers `node_modules/` and `*.log`, but not `site/dist` or `site/.astro`.
   - `dev.err.log` shows paths from `D:\new-geo-map\site`, so the site was copied from another folder, and that log records a past `adsEnabled is not a function` error.

23. **Deploy flow is undocumented or wrong.**
   - `README.md` says `../deploy.sh` builds the site and that the app is in `../web`. Both are false: `deploy.sh` builds only the frontend and backend, and the app lives in `frontend/`.
   - The README also shows nginx, while hosting is Apache (o3host).
   - Fix: add a `site` step (or a separate `deploy/site.sh`) that runs `npm ci && npm run build` and rsyncs or FTPs `site/dist` to public_html. Keep the site in the monorepo, because it shares business facts (prices, coverage, URLs) that should come from one source, ideally a JSON file exported by the backend.

24. **Unused or legacy code.** `src/assets/logo.png` is unused. The `public/logo.png` icon is duplicated as `src/assets/logo-icon.png`.

---

## World-class website: recommendation

### Information architecture

- `/` Home: value proposition, product demo, coverage search, pricing teaser, services, proof, FAQ
- `/dashboard/` → rename to `/naqsha/` or `/product/`: the full feature tour with real screenshots and video
- `/pricing/`
  - Plans: Trial (24 h), Monthly, Yearly, Patwari/Dealer multi-tehsil, Enterprise
  - Prices in PKR
  - What each plan unlocks (tehsils, devices)
  - How to pay (JazzCash/EasyPaisa today, card gateway later)
  - Refund policy
- `/coverage/` (searchable list and map of live tehsils and mouzas), with `/coverage/<tehsil>/` landing pages generated from backend data
- `/services/rtk-survey/`, `/services/drone-imagery/`, `/services/digital-mapping/`: each with sample deliverables, turnaround, starting price, and a "book" CTA
- `/how-it-works/`, or a section on the home page
- `/about/`: company, NTN/SECP, address, team, equipment
- `/contact/`
- `/help/` (Urdu video guides)
- Privacy and terms pages
- `/ur/` mirror of the key pages

### Home page outline

1. **Hero.**
   - EN: "Every Killa of Punjab — on Your Phone."
   - UR: «پنجاب کا ہر کلہ — آپ کے موبائل پر»
   - Sub-copy: find your chak, see murabba and killa lines on satellite imagery, and walk the field with live GPS.
   - CTAs: [Start 24-hour free trial] in gold, and [Check if your tehsil is available].
   - A real screen-recording loop.
2. **Coverage search box.**
   - "Type your tehsil / chak" returns either "Available — start trial" or "Not yet — notify me on WhatsApp".
   - UR: «اپنا موضع تلاش کریں»
3. **Three jobs to be done:**
   - Find your land: «اپنی زمین تلاش کریں»
   - Measure in kanal/marla: «کنال مرلہ میں پیمائش»
   - Prove the boundary with RTK: «آر ٹی کے سے حد براری»
4. **Product tour**: four real screenshots with captions.
5. **Pricing teaser**: three cards linking to /pricing.
   - UR: «سادہ قیمتیں — جاز کیش / ایزی پیسہ»
6. **Services strip**: RTK and drone, with sample outputs.
7. **Proof**: testimonials from patwaris, dealers and farmers (with district), plus counts of mouzas, users and surveys done.
8. **FAQ**: bilingual, marked up with FAQPage.
9. **Final CTA**: register, or talk on WhatsApp.

### Hand-off between site and dashboard

- **Sign-up.**
  - Every CTA goes to `dashboard.naqsha-zameen.pk/register?plan=<id>&tehsil=<id>&utm_source=site`.
  - The dashboard pre-selects the plan and tehsil, starts the 24 h trial, and shows the price for continuing.
  - Login stays a plain link.
- **Pricing source of truth.** The backend exposes `GET /api/public/plans` and `/api/public/coverage`. The site fetches both at build time (and rebuilds nightly or on change), so the site and the app never disagree.
- **Checkout.**
  - Today: the in-app "Renew" screen shows the JazzCash/EasyPaisa account, the amount and a reference code (the user ID), plus a WhatsApp receipt upload. The admin activates the account.
  - With the gateway: the dashboard hosts `/billing/checkout?plan=` (JazzCash/EasyPaisa hosted checkout or card). It returns to `/billing/success`, the subscription is extended automatically, and an emailed or WhatsApp receipt follows.
  - The marketing site never handles payment. It only deep-links into these flows.
- **Analytics.** Use one cookieless counter shared by the site and the app (the visit.gif beacon or self-hosted Plausible). Pass UTM parameters through to registration so trial-to-paid conversion can be measured per channel and per tehsil.
