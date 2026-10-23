// Origins allowed to call the API with credentials (HTTP CORS and Socket.io).
// Covers the main site (www / apex), the dashboard and API hosts and any other
// https subdomain of naqsha-zameen.pk, plus local development and any extra
// origins listed in CORS_ORIGIN (comma-separated).
const SITE_DOMAIN = 'naqsha-zameen.pk';

const extraOrigins = () =>
    String(process.env.CORS_ORIGIN || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, '').toLowerCase())
        .filter(Boolean);

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
    if (url.protocol === 'https:' && (host === SITE_DOMAIN || host.endsWith('.' + SITE_DOMAIN))) return true;
    return extraOrigins().includes(origin.replace(/\/$/, '').toLowerCase());
}

module.exports = { isAllowedOrigin };
