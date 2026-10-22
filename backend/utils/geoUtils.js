// SEC-09: Use req.ip which respects the 'trust proxy' setting in server.js
// instead of manually parsing X-Forwarded-For (which clients can spoof)
const getRealClientIP = (req) => {
    return req.ip || '127.0.0.1';
};

const UAParser = require('ua-parser-js');
const logger = require('./logger');

const parseUserAgent = (userAgentString) => {
    if (!userAgentString) return { deviceType: 'Unknown', mobile: false };

    const parser = new UAParser(userAgentString);
    const browser = parser.getBrowser();
    const os = parser.getOS();
    const device = parser.getDevice();

    const isMobile = device.type === 'mobile' || /Mobile|Android|iPhone/.test(userAgentString);
    const isTablet = device.type === 'tablet' || /iPad|Tablet/.test(userAgentString);
    
    let deviceType = 'Desktop';
    if (isMobile) deviceType = 'Mobile';
    else if (isTablet) deviceType = 'Tablet';

    return {
        browser: browser.name ? `${browser.name} ${browser.version || ''}`.trim() : 'unknown',
        os: os.name ? `${os.name} ${os.version || ''}`.trim() : 'unknown',
        device: device.vendor || device.model ? `${device.vendor || ''} ${device.model || ''}`.trim() : 'unknown',
        deviceType,
        mobile: isMobile || isTablet
    };
};

const getLocationFromIP = async (ipAddress, geoipLib) => {
    try {
        // Skip local/private IPs
        if (!ipAddress ||
            ipAddress === '127.0.0.1' ||
            ipAddress === '::1' ||
            ipAddress.startsWith('192.168.') ||
            ipAddress.startsWith('10.') ||
            ipAddress.startsWith('172.16.') ||
            ipAddress.startsWith('172.17.') ||
            ipAddress.startsWith('172.18.') ||
            ipAddress.startsWith('172.19.') ||
            ipAddress.startsWith('172.2') ||
            ipAddress.startsWith('172.3')) {

            // Return default location for local IPs
            return {
                latitude: 31.5497,  // Lahore, Pakistan
                longitude: 74.3436,
                city: 'Local Network',
                region: 'Punjab',
                country: 'Pakistan',
                countryCode: 'PK',
                timezone: 'Asia/Karachi',
                isp: 'Local Network',
                accuracy: 10000, // Low accuracy for local IPs
                source: 'ip-geolocation'
            };
        }

        // First try geoip-lite (free, local database)
        const geoData = geoipLib.lookup(ipAddress);
        if (geoData) {
            return {
                latitude: geoData.ll[0],
                longitude: geoData.ll[1],
                city: geoData.city || 'Unknown',
                region: geoData.region || 'Unknown',
                country: geoData.country || 'Unknown',
                countryCode: geoData.country || 'XX',
                timezone: geoData.timezone || 'UTC',
                isp: 'Unknown',
                accuracy: geoData.accuracy || 50000, // Approximate accuracy in meters
                source: 'ip-geolocation'
            };
        }

        // Ultimate fallback - return null for unknown locations
        return null;

    } catch (error) {
        logger.error('Geolocation lookup failed:', { error: error.message });
        return null;
    }
};

const createSessionWithLocation = async (req, geoipLib) => {
    try {
        const ipAddress = getRealClientIP(req);
        const userAgentString = req.headers['user-agent'];
        const deviceInfo = parseUserAgent(userAgentString);
        const deviceId = req.body?.deviceId || 'unknown';

        let location = null;
        try {
            location = await getLocationFromIP(ipAddress, geoipLib);
        } catch (locError) {
            logger.error('Location lookup error (non-fatal):', { error: locError.message });
        }

        const session = {
            start: new Date(),
            end: null,
            duration: null,
            ipAddress,
            deviceId,
            userAgent: userAgentString,
            deviceInfo
        };

        if (location) {
            session.location = location;
        }

        return session;
    } catch (error) {
        logger.error('Session creation error:', { error: error.message });
        return {
            start: new Date(),
            end: null,
            duration: null,
            ipAddress: 'unknown',
            deviceId: 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            deviceInfo: {
                deviceType: 'Unknown',
                os: 'unknown',
                browser: 'unknown',
                mobile: false
            }
        };
    }
};

function shiftCoordinates(coords, dx, dy) {
    if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lon = coords[0];
        const lat = coords[1];
        const R = 6378137;
        const x0 = (lon * Math.PI * R) / 180;
        const y0 = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R;
        const x1 = x0 + dx;
        const y1 = y0 + dy;
        const lon1 = (x1 / R) * (180 / Math.PI);
        const lat1 = (360 / Math.PI) * Math.atan(Math.exp(y1 / R)) - 90;
        return [lon1, lat1];
    }
    return coords.map(c => shiftCoordinates(c, dx, dy));
}

function getGeoJsonBounds(features) {
    const coords = [];
    features.forEach((f) => {
        let arr = [];
        if (f.geometry?.type === 'Polygon') arr = f.geometry.coordinates.flat();
        if (f.geometry?.type === 'MultiPolygon') arr = f.geometry.coordinates.flat(2);
        coords.push(...arr);
    });
    if (!coords.length) return null;
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

function computeShift(current, target) {
    const [curLat, curLng] = current[0];
    const [tgtLat, tgtLng] = target[0];
    const dLat = tgtLat - curLat;
    const dLng = tgtLng - curLng;
    const metersY = dLat * 111320;
    const metersX = dLng * 111320 * Math.cos(curLat * Math.PI / 180);
    return { dx: metersX, dy: metersY };
}

module.exports = {
    getRealClientIP,
    parseUserAgent,
    getLocationFromIP,
    createSessionWithLocation,
    shiftCoordinates,
    getGeoJsonBounds,
    computeShift
};
