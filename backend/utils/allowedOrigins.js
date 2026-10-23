// Origins allowed to call the API with credentials (HTTP CORS and Socket.io):
// the bare domain and any https subdomain of each ALLOWED_DOMAINS entry
// (default naqsha-zameen.com and naqsha-zameen.pk), local development, and
// any extra origins listed in CORS_ORIGIN (comma-separated).
const { ALLOWED_DOMAINS } = require('./siteConfig');

const extraOrigins = () =>
    String(process.env.CORS_ORIGIN || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, '').toLowerCase())
        .filter(Boolean);

function isOwnHost(host) {
    const h = String(host || '').toLowerCase();
    return ALLOWED_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}

function isAllowedOrigin(origin) {
    if (!origin) return true; // same-origin requests, curl, mobile apps
    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return true;
    if (url.protocol === 'https:' && isOwnHost(host)) return true;
    return extraOrigins().includes(origin.replace(/\/$/, '').toLowerCase());
}

module.exports = { isAllowedOrigin, isOwnHost };
