/**
 * Daily warning to customers who used their account on 4 or more devices in the last 30 days
 * (counted from activation, forgotten devices excluded; see services/deviceTracker.js).
 * At most one warning per user per day, so it is safe to run more than once.
 *
 * Runs from the BullMQ daily job (JOBS_ENABLED) or, on a copy without background jobs, from a
 * light timer in the first pm2 instance when MULTI_DEVICE_WARNINGS=on.
 */
const logger = require('../utils/logger');

const LIMIT = Number(process.env.MULTI_DEVICE_LIMIT) || 4;
const TITLE = 'Account used on multiple devices';

function message(count) {
    return `Your account was used on ${count} devices in the last 30 days. Sharing an account on multiple devices violates the Terms of Service and can get the account blocked. If you need more devices, each additional device requires an additional payment: please contact your provider.\n\n`
        + `آپ کا اکاؤنٹ پچھلے 30 دنوں میں ${count} ڈیوائسز پر استعمال ہوا۔ ایک اکاؤنٹ کو متعدد ڈیوائسز پر شیئر کرنا شرائط کی خلاف ورزی ہے اور اس سے اکاؤنٹ بلاک ہو سکتا ہے۔ اضافی ڈیوائس کے لیے فی ڈیوائس اضافی ادائیگی درکار ہے۔`;
}

async function runMultiDeviceWarnings(now = new Date()) {
    const Device = require('../models/Device');
    const User = require('../models/User');
    const Notification = require('../models/Notification');
    const { usageFor } = require('./deviceTracker');
    const { sendNotification } = require('../utils/notificationUtils');

    const d30 = new Date(now.getTime() - 30 * 86400e3);
    // Candidates: accounts with LIMIT+ devices seen in 30 days (exact count is checked below).
    const rows = await Device.aggregate([
        { $match: { forgotten: { $ne: true }, lastSeen: { $gte: d30 } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
        { $match: { n: { $gte: LIMIT } } },
    ]);
    if (!rows.length) return { warned: 0 };
    const users = await User.find({ userId: { $in: rows.map((r) => r._id) }, userType: { $in: ['user', null] }, status: { $ne: 'Suspended' } })
        .select('userId userType startDate status').lean();
    const usage = await usageFor(users, now);
    const since = new Date(now.getTime() - 20 * 3600e3);
    let warned = 0;
    for (const u of users) {
        const count = usage[u.userId]?.count30 || 0;
        if (count < LIMIT) continue;
        const already = await Notification.exists({ userId: u.userId, title: TITLE, createdAt: { $gte: since } });
        if (already) continue;
        await sendNotification(u.userId, { type: 'alert', title: TITLE, message: message(count) }).catch(() => {});
        warned++;
    }
    logger.info(`[multi-device] warned ${warned} account(s)`);
    return { warned };
}

/** Timer for copies without background jobs: once a day after 11:00 PKT, first pm2 instance only. */
function startMultiDeviceTimer() {
    const on = ['1', 'true', 'on', 'yes'].includes(String(process.env.MULTI_DEVICE_WARNINGS || '').toLowerCase());
    if (!on || (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0')) return;
    let lastDay = '';
    const tick = () => {
        const pk = new Date(Date.now() + 5 * 3600e3);
        const day = pk.toISOString().slice(0, 10);
        if (pk.getUTCHours() >= 11 && day !== lastDay) {
            lastDay = day;
            runMultiDeviceWarnings().catch((e) => logger.error('[multi-device] failed', { error: e.message }));
        }
    };
    setInterval(tick, 15 * 60e3).unref?.();
    setTimeout(tick, 60e3).unref?.();
}

module.exports = { runMultiDeviceWarnings, startMultiDeviceTimer, MULTI_DEVICE_LIMIT: LIMIT, multiDeviceMessage: message };
