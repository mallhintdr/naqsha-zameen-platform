/**
 * Device-based multi-use tracking (replaces IP counting).
 *
 *   recordLogin(req, userId)   on every login: find / create the device, set the
 *                              long-lived "did" cookie so the ID survives cache clears.
 *   touch(req, userId)         on heartbeat: mark the device active and detect two
 *                              devices of one account active at the same time.
 *   usageFor(users)            device counts per account in the old `ipMisuse` shape,
 *                              so every screen keeps working.
 */
const Device = require('../models/Device');
const logger = require('../utils/logger');

const COOKIE = 'did';
const COOKIE_MAX_AGE = 2 * 365 * 24 * 3600e3;
const CONCURRENT_WINDOW_MS = 5 * 60 * 1000;   // two devices active within 5 min = same time
const WARN_DEVICES_30D = 3;

const clean = (v, max = 100) => String(v || '').trim().slice(0, max);
const validId = (v) => /^[A-Za-z0-9-]{8,64}$/.test(String(v || '')) && v !== 'unknown-browser';

/** Device ID: the one the page sent, else the server cookie. */
function idFrom(req) {
    const fromBody = clean(req.body?.deviceId, 64);
    if (validId(fromBody)) return fromBody;
    const fromCookie = clean(req.cookies?.[COOKIE], 64);
    return validId(fromCookie) ? fromCookie : null;
}

function labelFrom(req) {
    const given = clean(req.body?.deviceLabel, 80);
    if (given) return given;
    const ua = String(req.headers['user-agent'] || '');
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${os} · ${br}`;
}

const ipOf = (req) => {
    try { return require('../utils/geoUtils').getRealClientIP(req); } catch { return req.ip; }
};

/** Find this account's device by ID, then by signature; create it when new. */
async function resolve(req, userId, { isLogin }) {
    const deviceId = idFrom(req);
    const signature = clean(req.body?.deviceSignature, 64) || null;
    if (!deviceId && !signature) return null;

    let dev = deviceId ? await Device.findOne({ userId, deviceIds: deviceId }) : null;
    // Browser storage wiped (new ID sent) but the server's device cookie survived.
    const cookieId = clean(req.cookies?.[COOKIE], 64);
    if (!dev && validId(cookieId) && cookieId !== deviceId) {
        dev = await Device.findOne({ userId, deviceIds: cookieId });
        if (dev && deviceId && !dev.deviceIds.includes(deviceId)) dev.deviceIds.push(deviceId);
    }
    if (!dev && signature) {
        // Same characteristics as a known device: the stored ID was wiped → same device.
        dev = await Device.findOne({ userId, signature, forgotten: { $ne: true } }).sort({ lastSeen: -1 });
        if (dev && deviceId && !dev.deviceIds.includes(deviceId)) dev.deviceIds.push(deviceId);
    }
    if (!dev) {
        if (!isLogin) return null;            // devices are created at login only
        dev = new Device({ userId, deviceIds: deviceId ? [deviceId] : [], signature, label: labelFrom(req) });
    }
    if (dev.forgotten && isLogin) dev.forgotten = false;
    if (signature && !dev.signature) dev.signature = signature;
    const ip = ipOf(req);
    if (ip && !dev.ips.includes(ip)) dev.ips = [...dev.ips, ip].slice(-20);
    dev.lastSeen = new Date();
    if (isLogin) { dev.logins = (dev.logins || 0) + 1; dev.label = labelFrom(req) || dev.label; }
    await dev.save();
    return dev;
}

/** On login: record the device and hand the browser a long-lived device cookie. */
async function recordLogin(req, res, userId, cookieOptions = {}) {
    try {
        if (req.body?.impersonated) return null;
        const dev = await resolve(req, userId, { isLogin: true });
        const id = dev?.deviceIds?.[0] || idFrom(req);
        if (id && res) res.cookie(COOKIE, id, { httpOnly: true, maxAge: COOKIE_MAX_AGE, path: '/', ...cookieOptions });
        return dev;
    } catch (e) {
        logger.warn('Device record failed', { userId, error: e.message });
        return null;
    }
}

/** On heartbeat: device active now; flag other devices of the account active at the same time. */
async function touch(req, userId) {
    try {
        const dev = await resolve(req, userId, { isLogin: false });
        if (!dev) return;
        const since = new Date(Date.now() - CONCURRENT_WINDOW_MS);
        const others = await Device.find({ userId, _id: { $ne: dev._id }, forgotten: { $ne: true }, lastSeen: { $gte: since } }).select('_id').lean();
        if (others.length) {
            const now = new Date();
            const ids = [dev._id, ...others.map(o => o._id)];
            // Count one "same time" episode per device per window.
            await Device.updateMany({ _id: { $in: ids }, $or: [{ lastConcurrentAt: { $lt: since } }, { lastConcurrentAt: null }] }, { $inc: { concurrentCount: 1 } });
            await Device.updateMany({ _id: { $in: ids } }, { $set: { lastConcurrentAt: now } });
        }
    } catch (e) {
        logger.warn('Device heartbeat failed', { userId, error: e.message });
    }
}

/**
 * Device usage for many accounts, in the shape the screens use (`ipMisuse`):
 * count30 / count7 = devices used, ips30 / ips7 = device labels, warn,
 * plus concurrent30 (devices seen at the same time as another one in 30 days).
 * Counted from the later of activation and 30 / 7 days ago.
 */
async function usageFor(users, now = new Date()) {
    const list = (users || []).filter(u => u && u.userType !== 'admin');
    if (!list.length) return {};
    const d30 = new Date(now.getTime() - 30 * 86400e3);
    const devices = await Device.find({ userId: { $in: list.map(u => u.userId) }, forgotten: { $ne: true }, lastSeen: { $gte: d30 } })
        .select('userId label lastSeen firstSeen lastConcurrentAt ips logins').lean();
    const byUser = {};
    for (const d of devices) (byUser[d.userId] = byUser[d.userId] || []).push(d);
    const out = {};
    for (const u of list) {
        const start = u.startDate ? new Date(u.startDate) : new Date(0);
        const from30 = start > d30 ? start : d30;
        const d7 = new Date(now.getTime() - 7 * 86400e3);
        const from7 = start > d7 ? start : d7;
        const mine = (byUser[u.userId] || []).sort((a, b) => b.lastSeen - a.lastSeen);
        const in30 = mine.filter(d => d.lastSeen >= from30);
        const in7 = mine.filter(d => d.lastSeen >= from7);
        const concurrent30 = in30.filter(d => d.lastConcurrentAt && d.lastConcurrentAt >= from30).length;
        const name = (d, i) => `${d.label || 'Device'} #${i + 1}`;
        out[u.userId] = {
            count30: in30.length,
            count7: in7.length,
            ips30: in30.map(name),
            ips7: in7.map(name),
            deviceCount30: in30.length,
            devices30: in30.map(d => ({ id: String(d._id), label: d.label, firstSeen: d.firstSeen, lastSeen: d.lastSeen, logins: d.logins, networks: (d.ips || []).length, sameTime: !!(d.lastConcurrentAt && d.lastConcurrentAt >= from30) })),
            concurrent30,
            warn: in30.length > WARN_DEVICES_30D || concurrent30 > 0,
            activationStart: start,
            basis: 'devices'
        };
    }
    return out;
}

async function usageForOne(user, now) {
    if (!user || user.userType === 'admin') return null;
    const usage = (await usageFor([user], now))[user.userId] || null;
    if (!usage) return null;
    // Single account (edit form): add each device's IP addresses and the sessions
    // opened from them since monitoring started.
    try {
        const Session = require('../models/Session');
        const [devs, sess] = await Promise.all([
            Device.find({ _id: { $in: usage.devices30.map(d => d.id) } }).select('ips').lean(),
            Session.aggregate([
                { $match: { userId: user.userId, start: { $gte: new Date(usage.activationStart || 0) } } },
                { $group: { _id: '$ipAddress', count: { $sum: 1 }, last: { $max: '$start' } } }
            ])
        ]);
        const ipsById = Object.fromEntries(devs.map(d => [String(d._id), d.ips || []]));
        const perIp = Object.fromEntries(sess.map(s => [s._id, s.count]));
        usage.devices30 = usage.devices30.map(d => {
            const ips = (ipsById[d.id] || []).slice().reverse();      // newest first
            return { ...d, ips: ips.map(ip => ({ ip, sessions: perIp[ip] || 0 })), sessions: ips.reduce((s, ip) => s + (perIp[ip] || 0), 0) };
        });
    } catch (e) { /* details are optional */ }
    return usage;
}

module.exports = { recordLogin, touch, usageFor, usageForOne, COOKIE };
