// Ported verbatim from legacy utils/deviceUtils.js (localStorage key 'geo_device_id' preserved)


/**
 * Gets the persistent device ID from localStorage, or generates a new one if it doesn't exist.
 * This ID remains constant even if the user changes IPs (e.g. WiFi to Cellular).
 */
export const getDeviceId = () => {
    try {
        let deviceId = localStorage.getItem('geo_device_id');
        if (!deviceId) {
            deviceId = crypto.randomUUID();
            localStorage.setItem('geo_device_id', deviceId);
        }
        return deviceId;
    } catch (e) {
        // Fallback if localStorage is disabled/full
        return 'unknown-browser';
    }
};

/**
 * Returns a simple string representing the device type
 */
export const getDeviceType = () => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
        return 'Tablet';
    }
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
        return 'Mobile';
    }
    return 'Desktop';
};

/**
 * Device "signature": a short hash of this device's characteristics (platform,
 * browser, screen, time zone, language, CPU cores, memory, graphics chip). The
 * server uses it to recognise a known device even when its stored ID was wiped,
 * so multi-use is counted by real devices, not IP addresses.
 */
export const getDeviceSignature = () => {
    try {
        let gpu = '';
        try {
            const gl = document.createElement('canvas').getContext('webgl');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        } catch (_) { /* no WebGL */ }
        const n = navigator;
        const parts = [
            n.platform, (n.userAgentData && n.userAgentData.platform) || '', getDeviceType(),
            `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`, window.devicePixelRatio,
            Intl.DateTimeFormat().resolvedOptions().timeZone, n.language, n.hardwareConcurrency || '', n.deviceMemory || '',
            n.maxTouchPoints || 0, gpu
        ].join('|');
        // FNV-1a 64-bit-ish hash (two 32-bit halves) → 16 hex chars
        let h1 = 0x811c9dc5, h2 = 0x01000193;
        for (let i = 0; i < parts.length; i++) {
            const c = parts.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
            h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
        }
        return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    } catch (e) {
        return '';
    }
};

/** Readable name for this device, e.g. "Android · Chrome · 412×915". */
export const getDeviceLabel = () => {
    try {
        const ua = navigator.userAgent;
        const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
        const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
        return `${os} · ${br} · ${window.screen.width}×${window.screen.height}`;
    } catch (e) { return ''; }
};

/** Device fields sent with login and heartbeat. */
export const getDevicePayload = () => ({ deviceId: getDeviceId(), deviceSignature: getDeviceSignature(), deviceLabel: getDeviceLabel() });
