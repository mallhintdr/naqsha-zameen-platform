const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');

const FILE = 'GeoMatrix Logo.png';
const LOCAL_CANDIDATES = [
    path.join(__dirname, '..', 'assets', FILE),
    path.join(__dirname, '..', '..', 'public', FILE),
    path.join(__dirname, '..', '..', 'build', FILE)
];

let cached = null;

function frontendBaseUrl() {
    const raw = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || '';
    // CORS_ORIGIN may hold several comma-separated origins; use the first
    return raw.split(',')[0].trim().replace(/\/+$/, '');
}

/**
 * The logo lives on the frontend host (the backend is deployed separately and
 * has no public/ folder), so fetch it over HTTP first, then fall back to any
 * local copy. Returns a Buffer, or null if unavailable (callers must tolerate
 * a missing logo).
 */
async function loadLogoBuffer() {
    if (cached) return cached;

    const base = frontendBaseUrl();
    if (base) {
        try {
            const res = await axios.get(`${base}/${encodeURIComponent(FILE)}`, {
                responseType: 'arraybuffer',
                timeout: 10000
            });
            cached = Buffer.from(res.data);
            return cached;
        } catch (err) {
            logger.warn('Could not fetch GeoMatrix logo from the frontend host', { url: base, error: err.message });
        }
    }

    const local = LOCAL_CANDIDATES.find((p) => fs.existsSync(p));
    if (local) {
        cached = fs.readFileSync(local);
        return cached;
    }
    return null;
}

module.exports = { loadLogoBuffer };
