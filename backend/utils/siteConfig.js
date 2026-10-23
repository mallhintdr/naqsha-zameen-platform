// Public addresses of the app and website, in one place.
//
//   APP_URL          where the dashboard app runs        e.g. https://dashboard.naqsha-zameen.com
//   SITE_URL         the marketing website                e.g. https://naqsha-zameen.com
//   ALLOWED_DOMAINS  registrable domains whose https subdomains may call the API
//                    (comma-separated)                    e.g. naqsha-zameen.com,naqsha-zameen.pk
//   JOBS_ENABLED     false = run no scheduled tasks or queue workers (parallel test copy)
//
// Older env names keep working: FRONTEND_URL, then the first https entry of CORS_ORIGIN.
const IS_PROD = process.env.NODE_ENV === 'production' || process.platform === 'linux';

const DEFAULT_APP_URL = 'https://dashboard.naqsha-zameen.com';
const DEFAULT_SITE_URL = 'https://naqsha-zameen.com';
const DEFAULT_DOMAINS = 'naqsha-zameen.com,naqsha-zameen.pk';

const trimUrl = (u) => String(u || '').trim().replace(/\/$/, '');
const firstHttp = (list) => String(list || '').split(',').map((s) => s.trim()).find((s) => /^https?:\/\//i.test(s));

const APP_URL = trimUrl(
    process.env.APP_URL || process.env.FRONTEND_URL || firstHttp(process.env.CORS_ORIGIN) || (IS_PROD ? DEFAULT_APP_URL : 'http://localhost:3000')
);
const SITE_URL = trimUrl(process.env.SITE_URL || DEFAULT_SITE_URL);

const ALLOWED_DOMAINS = String(process.env.ALLOWED_DOMAINS || DEFAULT_DOMAINS)
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

/** ".naqsha-zameen.com" for https://dashboard.naqsha-zameen.com; undefined for localhost/IPs. */
function registrableDomainOf(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host === 'localhost' || /^[\d.]+$/.test(host)) return undefined;
        const match = ALLOWED_DOMAINS.find((d) => host === d || host.endsWith('.' + d));
        if (match) return '.' + match;
        const parts = host.split('.');
        return parts.length >= 2 ? '.' + parts.slice(-2).join('.') : undefined;
    } catch {
        return undefined;
    }
}

/** Cookie domain for login cookies: COOKIE_DOMAIN, else derived from APP_URL in production. */
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || (IS_PROD ? registrableDomainOf(APP_URL) : undefined);

/** Cookie domain for a request host if it belongs to one of our domains (visitor counter). */
function cookieDomainForHost(host) {
    const h = String(host || '').toLowerCase();
    const match = ALLOWED_DOMAINS.find((d) => h === d || h.endsWith('.' + d));
    return match ? '.' + match : undefined;
}

const JOBS_ENABLED = String(process.env.JOBS_ENABLED ?? 'true').toLowerCase() !== 'false';

module.exports = { IS_PROD, APP_URL, SITE_URL, ALLOWED_DOMAINS, COOKIE_DOMAIN, JOBS_ENABLED, registrableDomainOf, cookieDomainForHost };
