const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../utils/logger');

// Get notification history
exports.getNotifications = async (req, res) => {
    try {
        // ?since=<ISO time>: only notifications created after it (the dashboard's cheap poll).
        const filter = { userId: req.user.userId };
        const since = req.query.since ? new Date(String(req.query.since)) : null;
        if (since && !Number.isNaN(since.getTime())) filter.createdAt = { $gt: since };
        const notifs = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(60)
            .lean();
        // Public sign-ups: notifications created by older code (or the old .pk server) have no
        // details. Fill in name, tehsil, mouzas, plan and dates from the user, and fold the
        // "registered" notification into the "activated" one so each sign-up shows once.
        const REG = 'New Public Registration', ACT = 'Public User Activated';
        const uidOf = (n) => String(n.message || '').split(' ')[0];
        const signUps = notifs.filter((n) => (n.title === REG || n.title === ACT) && !(n.details && n.details.tehsil));
        if (signUps.length) {
            const User = require('../models/User');
            const { accountDetails } = require('../utils/notificationUtils');
            const ids = [...new Set(signUps.map(uidOf).filter(Boolean))];
            const users = await User.find({ userId: { $in: ids } }).select('userId userName mobileNumber tehsilAccess activeTehsil subscriptionType startDate createdAt').lean();
            const byId = new Map(users.map((u) => [u.userId, u]));
            for (const n of signUps) {
                const u = byId.get(uidOf(n));
                if (u) n.details = { ...accountDetails(u), ...(n.title === ACT ? { activatedAt: n.createdAt } : {}) };
            }
        }
        const activated = new Set(notifs.filter((n) => n.title === ACT).map((n) => (n.details && n.details.userId) || uidOf(n)));
        for (const n of notifs) {
            if (n.title === ACT && n.details && !n.details.createdAt) {
                const reg = notifs.find((r) => r.title === REG && ((r.details && r.details.userId) || uidOf(r)) === ((n.details && n.details.userId) || uidOf(n)));
                if (reg) n.details.createdAt = reg.createdAt;
            }
            if (n.title === ACT && n.details) n.message = n.message.replace(' activated their account.', ' registered and activated their account.');
        }
        const visible = notifs.filter((n) => !(n.title === REG && activated.has((n.details && n.details.userId) || uidOf(n))));
        const notifications = visible.map(n => ({
            id: n._id.toString(),
            type: n.type,
            title: n.title,
            message: n.message,
            timestamp: n.createdAt,
            read: n.read,
            action: n.action && n.action.url ? n.action : undefined,
            replyTo: n.replyTo || undefined,
            details: n.details || undefined,
            actionDone: !!n.actionDone,
            outcome: n.outcome || undefined
        }));
        res.json({ notifications });
    } catch (error) {
        logger.error('getNotifications error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to fetch notifications' });
    }
};

// Mark a notification as read
exports.readNotification = async (req, res) => {
    try {
        const notifId = req.params.id;
        if (!notifId || typeof notifId !== 'string' || notifId.length > 50) {
            return res.status(400).json({ message: 'Invalid notification ID' });
        }
        await Notification.updateOne(
            { _id: notifId, userId: req.user.userId },
            { $set: { read: true } }
        );
        res.json({ success: true });
    } catch (error) {
        logger.error('readNotification error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to mark notification as read' });
    }
};

// Mark all as read
exports.readAllNotifications = async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user.userId, read: false },
            { $set: { read: true } }
        );
        res.json({ success: true });
    } catch (error) {
        logger.error('readAllNotifications error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to mark all as read' });
    }
};

// Clear all notifications
exports.clearNotifications = async (req, res) => {
    try {
        await Notification.deleteMany({ userId: req.user.userId });
        res.json({ success: true });
    } catch (error) {
        logger.error('clearNotifications error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to clear notifications' });
    }
};

// Subscribe to Web Push
exports.subscribePush = async (req, res) => {
    try {
        const { subscription } = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
            return res.status(400).json({ message: 'Invalid subscription data' });
        }
        // A device belongs to whoever is logged in on it now: drop it from other accounts.
        await User.updateMany({ userId: { $ne: req.user.userId }, 'pushSubscriptions.endpoint': subscription.endpoint }, { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } });
        await User.updateOne(
            { userId: req.user.userId, 'pushSubscriptions.endpoint': { $ne: subscription.endpoint } },
            { $push: { pushSubscriptions: { $each: [subscription], $slice: -10 } } }
        );
        res.status(201).json({ success: true });
    } catch (error) {
        logger.error('subscribePush error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to subscribe to notifications' });
    }
};


// Public key browsers subscribe with (stays the same across restarts).
exports.vapidPublicKey = async (req, res) => {
    try {
        const key = await require('../services/pushNotificationService').getPublicKey();
        if (!key) return res.status(503).json({ message: 'Push notifications are not available.' });
        res.json({ publicKey: key });
    } catch (error) {
        res.status(500).json({ message: 'Push notifications are not available.' });
    }
};

// This device stops receiving pushes for this account (e.g. on logout).
exports.unsubscribePush = async (req, res) => {
    try {
        const endpoint = String(req.body?.endpoint || '');
        if (endpoint) await User.updateOne({ userId: req.user.userId }, { $pull: { pushSubscriptions: { endpoint } } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Failed to unsubscribe' });
    }
};

/**
 * Reply to the customer a notification is about (renewal / mouza-change request,
 * expiry…), e.g. to tell them a payment is needed and how much before going ahead.
 * Only the admin, or the sub-admin who manages that customer. The customer gets
 * it in the app and as a phone / desktop notification.
 */
exports.replyToNotification = async (req, res) => {
    try {
        if (!['admin', 'subadmin'].includes(req.user.userType)) return res.status(403).json({ message: 'Forbidden' });
        const n = await Notification.findOne({ _id: req.params.id, userId: req.user.userId }).lean();
        if (!n || !n.replyTo) return res.status(404).json({ message: 'This notification cannot be replied to.' });
        const message = String(req.body?.message || '').trim();
        if (message.length < 2) return res.status(400).json({ message: 'Write a message.' });
        const customer = await User.findOne({ userId: n.replyTo }).select('userId userName managedBy').lean();
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });
        if (req.user.userType === 'subadmin' && customer.managedBy !== req.user.userId) return res.status(403).json({ message: 'This customer is not yours.' });
        const me = await User.findOne({ userId: req.user.userId }).select('userName').lean();
        const from = req.user.userType === 'admin' ? 'Naqsha Zameen' : (me?.userName || req.user.userId);
        const { sendNotification, notifyAdmins } = require('../utils/notificationUtils');
        await sendNotification(customer.userId, { type: 'info', title: `Message from ${from}`, message: message.slice(0, 1500) });
        await Notification.updateOne({ _id: n._id }, { $set: { read: true, lastReply: { at: new Date(), message: message.slice(0, 200) } } }).catch(() => {});
        if (req.user.userType === 'subadmin') {
            notifyAdmins({ type: 'info', title: `[${req.user.userId}] messaged a customer`, message: `To ${customer.userId}: ${message.slice(0, 200)}` }).catch(() => {});
        }
        res.json({ message: `Message sent to ${customer.userName || customer.userId}.` });
    } catch (error) {
        logger.error('replyToNotification error:', { error: error.message });
        res.status(500).json({ message: 'Failed to send the message' });
    }
};

/**
 * Data for the reply templates: the customer (plan, days left, mouzas, last fee,
 * mobile for WhatsApp), who pays whom (payment details), and the sign-off.
 */
exports.replyInfo = async (req, res) => {
    try {
        if (!['admin', 'subadmin'].includes(req.user.userType)) return res.status(403).json({ message: 'Forbidden' });
        const n = await Notification.findOne({ _id: req.params.id, userId: req.user.userId }).lean();
        if (!n || !n.replyTo) return res.status(404).json({ message: 'This notification cannot be replied to.' });
        const snap = await require('../services/customerSnapshot').customerSnapshot(n.replyTo);
        if (!snap) return res.status(404).json({ message: 'Customer not found.' });
        if (req.user.userType === 'subadmin' && snap.managedBy !== req.user.userId) return res.status(403).json({ message: 'This customer is not yours.' });
        const provider = await require('../services/providerService').getProviderForUser({ userId: snap.userId, managedBy: snap.managedBy });
        const me = await User.findOne({ userId: req.user.userId }).select('userName mobileNumber').lean();
        const signOff = req.user.userType === 'admin' ? 'GeoMatrix Technologies' : `${me?.userName || req.user.userId}${me?.mobileNumber ? `\n${me.mobileNumber}` : ''}`;
        res.json({ customer: snap, provider, signOff, details: n.details || null });
    } catch (error) {
        logger.error('replyInfo error:', { error: error.message });
        res.status(500).json({ message: 'Could not load the customer.' });
    }
};
