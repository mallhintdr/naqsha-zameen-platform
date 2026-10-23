// The dashboard address a link should point to: the app the request came from
// (http://localhost:3000 in development, dashboard.naqsha-zameen.com or the .pk
// dashboard while both run in parallel), so links in emails open the same app
// the user was using. Only app hosts are trusted: the marketing website (bare
// domain / www) is never used as a link target. Otherwise falls back to APP_URL.
const { APP_URL } = require('./siteConfig');
const { isOwnHost } = require('./allowedOrigins');

const trusted = (origin) => {
    if (!/^https?:\/\/[^/]+$/i.test(origin)) return false;
    const host = origin.replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
    if (['localhost', '127.0.0.1'].includes(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    const isWebsite = host.split('.').length <= 2 || host.startsWith('www.');
    if (origin.toLowerCase().startsWith('https://') && isOwnHost(host) && !isWebsite) return true;
    const configured = String(process.env.FRONTEND_URL || process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '').toLowerCase());
    return configured.includes(origin.toLowerCase());
};

function frontendOrigin(req) {
    let origin = (req && (req.get('origin') || '')) || '';
    if (!origin && req) {
        try { origin = new URL(req.get('referer') || '').origin; } catch { origin = ''; }
    }
    origin = origin.replace(/\/$/, '');
    if (origin && trusted(origin)) return origin;
    return APP_URL;
}

module.exports = { frontendOrigin };
