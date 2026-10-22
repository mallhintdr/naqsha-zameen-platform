/**
 * Multi-device (account sharing) list and the daily warning.
 *
 *  listMultiDeviceUsers()  every customer with more than one device in the last
 *                          30 days (from the later of activation and 30 days ago).
 *  startDailyWarning()     once a day (09:00 PKT) sends each of them a push
 *                          notification: stop sharing the account or it will be
 *                          disabled. One warning per user per day, across all
 *                          instances (SharedCache lock).
 */
const User = require('../models/User');
const Device = require('../models/Device');
const logger = require('../utils/logger');
const { deriveTehsilState } = require('../utils/userUtils');

const WARN_HOUR_PKT = 9;

async function listMultiDeviceUsers(now = new Date()) {
    const d30 = new Date(now.getTime() - 30 * 86400e3);
    const groups = await Device.aggregate([
        { $match: { forgotten: { $ne: true }, lastSeen: { $gte: d30 } } },
        { $group: { _id: '$userId', n: { $sum: 1 }, ips: { $push: '$ips' } } },
        { $match: { n: { $gt: 1 } } }
    ]);
    if (!groups.length) return [];
    const ipsByUser = Object.fromEntries(groups.map(g => [g._id, [...new Set(g.ips.flat())]]));
    const users = await User.find({ userId: { $in: groups.map(g => g._id) }, userType: { $nin: ['admin', 'subadmin'] } })
        .select('userId userName userType startDate lastActive subscriptionType status tehsilAccess activeTehsil managedBy')
        .lean();
    const usage = await require('./deviceTracker').usageFor(users.map(u => ({ ...u, userType: u.userType || 'user' })), now);
    return users
        .map(u => {
            const dev = usage[u.userId];
            if (!dev || dev.count30 < 2) return null;     // second device was before this activation
            let tehsil = u.activeTehsil;
            try { tehsil = deriveTehsilState(u).activeTehsil; } catch (e) { /* keep stored */ }
            return {
                userName: u.userName,
                userId: u.userId,
                tehsil,
                subscriptionType: u.subscriptionType,
                status: u.status,
                managedBy: u.managedBy || null,
                ipCount: dev.count30,                     // devices (name kept for the screens)
                deviceCount: dev.count30,
                sameTimeDevices: dev.concurrent30,
                devices: dev.ips30,
                ipAddresses: (ipsByUser[u.userId] || []).slice(-10),
                instances: dev.count30,
                lastActive: u.lastActive
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.deviceCount - a.deviceCount);
}

async function sendDailyWarnings() {
    const { sendNotification } = require('../utils/notificationUtils');
    const shared = require('../utils/sharedCache').createSharedCache('multiuse', 26 * 3600);
    const day = require('./subAdminBilling').pkDay();
    const list = await listMultiDeviceUsers();
    let sent = 0;
    for (const u of list) {
        if (['Suspended', 'Expired'].includes(u.status)) continue;
        // One warning per user per day, even with several app instances.
        const key = `multiuse-warn:${day}:${u.userId}`;
        try {
            if (await shared.get(key)) continue;
            await shared.set(key, 1);
        } catch (e) { /* no shared cache: still send */ }
        sendNotification(u.userId, {
            type: 'alert',
            title: '⚠️ Account sharing detected',
            message: `Your account was used on ${u.deviceCount} devices in the last 30 days${u.sameTimeDevices ? ', some at the same time' : ''}. Please stop sharing your account, otherwise it will be disabled.`
        }).catch(() => {});
        sent++;
    }
    if (sent) logger.info(`multiUseWarning: warned ${sent} user(s)`);
    return sent;
}

let timer = null;
function startDailyWarning() {
    if (timer) return;
    let lastDay = null;
    const tick = () => {
        const pk = new Date(Date.now() + 5 * 3600e3);
        const day = pk.toISOString().slice(0, 10);
        if (pk.getUTCHours() >= WARN_HOUR_PKT && lastDay !== day) {
            lastDay = day;
            sendDailyWarnings().catch(e => logger.warn('multiUseWarning failed', { error: e.message }));
        }
    };
    timer = setInterval(tick, 10 * 60 * 1000);
    if (timer.unref) timer.unref();
    setTimeout(tick, 60 * 1000);
}

module.exports = { listMultiDeviceUsers, sendDailyWarnings, startDailyWarning };
