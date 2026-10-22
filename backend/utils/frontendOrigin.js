// The dashboard address a link should point to: the site the request came from
// (http://localhost:3000 in development, the live dashboard in production), so
// links work in both. Only trusted origins are used; anything else falls back to
// FRONTEND_URL / CORS_ORIGIN, then the production dashboard.
const PROD = 'https://dashboard.naqsha-zameen.pk';

const trusted = (origin) => {
    if (!/^https?:\/\/[^/]+$/i.test(origin)) return false;
    const host = origin.replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
    if (['localhost', '127.0.0.1'].includes(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (host === 'naqsha-zameen.pk' || host.endsWith('.naqsha-zameen.pk')) return true;
    const configured = String(process.env.FRONTEND_URL || process.env.CORS_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '').toLowerCase());
    return configured.includes(origin.toLowerCase());
};

function frontendOrigin(req) {
    let origin = (req && (req.get('origin') || '')) || '';
    if (!origin && req) {
        try { origin = new URL(req.get('referer') || '').origin; } catch { origin = ''; }
    }
    origin = origin.replace(/\/$/, '');
    if (origin && trusted(origin)) return origin;
    const configured = String(process.env.FRONTEND_URL || process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).find(s => /^https?:\/\//.test(s));
    return (configured || PROD).replace(/\/$/, '');
}

module.exports = { frontendOrigin };
