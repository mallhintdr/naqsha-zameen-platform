/**
 * Env-driven settings for vector data protection (GeoJSON / metadata).
 * Read lazily so tests can change process.env between cases.
 * Every flag is documented in docs/security/GEOJSON.md.
 */
const crypto = require('crypto');

const bool = (v, d) => (v === undefined || v === '' ? d : !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

const derive = (label) => crypto.createHmac('sha256', String(process.env.SECRET_KEY || 'dev-insecure')).update(label).digest('hex');

function vectorConfig() {
    const e = process.env;
    return {
        entitlement: bool(e.VECTOR_MOUZA_ENTITLEMENT, true),
        requireClientHeader: bool(e.VECTOR_REQUIRE_CLIENT_HEADER, true),
        clientHeaderValue: e.VECTOR_CLIENT_HEADER_VALUE || 'dashboard',
        rpm: int(e.VECTOR_RPM, 300),                       // vector requests / user / minute
        rph: int(e.VECTOR_RPH, 3000),                      // vector requests / user / hour
        mouzaDaily: int(e.VECTOR_MOUZA_DAILY_MAX, 40),     // distinct mouzas / user / day
        mouzaDailySubAdmin: int(e.VECTOR_MOUZA_DAILY_MAX_SUBADMIN, 150),
        quotaTzOffsetMin: int(e.VECTOR_QUOTA_TZ_OFFSET_MIN, 300), // day boundary: PKT (UTC+5)
        envelope: bool(e.VECTOR_ENVELOPE, false),
        envelopeSecret: e.VECTOR_ENVELOPE_SECRET || derive('nz-vector-envelope-v1'),
        envelopeKeyTtlMin: Math.max(5, int(e.VECTOR_ENVELOPE_KEY_TTL_MIN, 360)),
        watermark: bool(e.VECTOR_WATERMARK, false),
        watermarkSecret: e.VECTOR_WATERMARK_SECRET || derive('nz-vector-watermark-v1'),
        watermarkUnits: Math.min(4, Math.max(1, int(e.VECTOR_WATERMARK_UNITS, 3))), // 1 unit = 1e-7° ≈ 1.1 cm
        watermarkAdmins: bool(e.VECTOR_WATERMARK_ADMINS, false),
        cacheMb: int(e.VECTOR_CACHE_MB, 256),
        // "All Mouzas" preview (docs/PUBLIC-BROWSE-PLAN.md): registered users may view
        // mouzas they don't own as tiles only, a few new ones per day.
        publicBrowse: bool(e.PUBLIC_BROWSE, true),
        previewMouzasPerDay: int(e.PREVIEW_MOUZAS_PER_DAY, 10),
        tehsilWideFiles: new RegExp(e.VECTOR_TEHSIL_WIDE_FILES || '(-mouza-index\\.json|^list-[^/]*\\.json|^index\\.json)$', 'i'),
    };
}

module.exports = { vectorConfig };
