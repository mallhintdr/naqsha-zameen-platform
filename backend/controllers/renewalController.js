const User = require('../models/User');
const RenewalToken = require('../models/RenewalToken');
const DemoLink = require('../models/DemoLink');
const crypto = require('crypto');
const logger = require('../utils/logger');

const FRONTEND_URL = process.env.FRONTEND_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN;

exports.createRenewalToken = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const requestType = user.status === 'Pending' ? 'Activation' : 'Renewal';
        // Trial customers (running or ended) can't get another free period: pay first.
        const payFirst = ['Trial', 'Trial24'].includes(user.subscriptionType) || user.status === 'Trial';
        const payFirstMessage = payFirst
            ? 'You have already used your free trial. Please pay the subscription fee (Monthly / Yearly) and send the payment screenshot; your subscription will be renewed after payment.'
            : undefined;
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Remove any existing unused tokens for this user
        await RenewalToken.deleteMany({ userId, used: false, requestType: { $ne: 'AssignmentChange' } });

        await RenewalToken.create({ token, userId, requestType, expiresAt });

        // Link to the site the request came from (localhost in development, live site in production).
        const FRONTEND_BASE = require('../utils/frontendOrigin').frontendOrigin(req);
        const deepLink = `${FRONTEND_BASE}/admin/activate/${token}`;

        // Tell the provider (the customer's sub-admin, or the admin) with an action
        // button that opens the request; the WhatsApp message is still sent by the app.
        // If the customer taps again, the open notification is pointed at the new link
        // instead of sending another one (it is hidden once the customer is renewed).
        try {
            const Notification = require('../models/Notification');
            const { sendNotification, notifyAdmins } = require('../utils/notificationUtils');
            const action = { label: requestType === 'Activation' ? 'Open Activation' : 'Open Renewal', url: `/admin/activate/${token}`, kind: 'renewal', ref: user.userId };
            const updated = await Notification.updateMany(
                { 'action.kind': 'renewal', 'action.ref': user.userId, actionDone: { $ne: true }, createdAt: { $gt: new Date(Date.now() - 24 * 3600e3) } },
                { $set: { 'action.url': action.url, read: false, replyTo: user.userId } }
            );
            if (!updated.modifiedCount) {
                // Short text; plan / mouzas / last fee / days left in the expandable details.
                const snap = await require('../services/customerSnapshot').customerSnapshot(user.userId);
                const title = `${requestType} · ${user.userId}`;
                const message = `${user.subscriptionType || 'Plan'}${snap?.daysLeft ? ` · ${snap.daysLeft}d left` : ' · expired'}`;
                const details = { kind: 'renewal', plan: snap?.plan, currentMouzas: snap?.mouzaCount || 0, lastFeePaid: snap?.lastFeePaid || 0, daysLeft: snap?.daysLeft || 0, endDate: snap?.endDate };
                if (user.managedBy) sendNotification(user.managedBy, { type: 'subscription', title, message, action, replyTo: user.userId, details }).catch(() => {});
                else notifyAdmins({ type: 'subscription', title, message, action, replyTo: user.userId, details }).catch(() => {});
            }
        } catch (e) {
            logger.warn('Renewal request notification failed', { error: e.message, userId: user.userId });
        }

        res.json({ token, deepLink, requestType, expiresAt, payFirst, message: payFirstMessage });
    } catch (err) {
        logger.error('createRenewalToken error:', { error: err.message, stack: err.stack, userId: req.params.userId });
        res.status(500).json({ message: 'Failed to create renewal token' });
    }
};

exports.resolveRenewalToken = async (req, res) => {
    try {
        const { token } = req.params;
        const record = await RenewalToken.findOne({ token });

        if (!record) return res.status(404).json({ message: 'Token not found or expired' });
        if (record.expiresAt < new Date()) return res.status(410).json({ message: 'Token has expired' });

        const user = await User.findOne({ userId: record.userId });
        if (!user) return res.status(404).json({ message: 'Associated user not found' });

        // Who may open it: the admin opens any link; a sub-admin only links sent by
        // their own customers. Checked BEFORE the link is marked as opened, so a wrong
        // person opening it does not start the clock.
        const opener = req.user;
        const isAdmin = opener.userType === 'admin';
        const isOwner = opener.userType === 'subadmin' && user.managedBy === opener.userId;
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'This request belongs to a customer you do not manage.' });
        }

        // Reusable for 1 hour from the first opening, then closed.
        const WINDOW_MS = 60 * 60 * 1000;
        if (record.used) {
            if (Date.now() - new Date(record.usedAt).getTime() > WINDOW_MS) {
                return res.status(410).json({ message: 'This link expired: it can only be used within 1 hour of first opening.' });
            }
        } else {
            record.used = true;
            record.usedAt = new Date(); // first opening: the 1-hour window starts now
            await record.save();
        }

        res.json({
            userId: record.userId,
            userName: user.userName,
            requestType: record.requestType,
            requestId: record.requestId || null,
            requestedAt: record.requestedAt,
            // Shown on the link page before opening the edit form.
            customer: await require('../services/customerSnapshot').customerSnapshot(user.userId)
        });
    } catch (err) {
        logger.error('resolveRenewalToken error:', { error: err.message, stack: err.stack, token: req.params.token });
        res.status(500).json({ message: 'Failed to resolve token' });
    }
};

exports.createDemoLink = async (req, res) => {
    try {
        const { expiresInMinutes = 60 } = req.body || {};
        const minutes = Number(expiresInMinutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            return res.status(400).json({ message: 'Invalid expiry duration' });
        }

        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        await DemoLink.deleteMany({ user: user._id, expiresAt: { $lt: new Date() } });

        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

        await DemoLink.create({ user: user._id, token, expiresAt });

        // BUG FIX: /demo-access/:token is a backend-only route (authRoutes.js) — it does
        // NOT exist on the frontend dashboard app. FRONTEND_URL/CORS_ORIGIN point at the
        // React SPA's origin, so using them here built a link to a host that 404s with
        // "Route not found". Always base the link on this API server's own origin;
        // DEMO_LINK_BASE_URL remains available as an explicit override for deployments
        // behind a reverse proxy where the public hostname differs from req.get('host').
        const forwarded = req.get('x-forwarded-proto');
        const proto = forwarded ? forwarded.split(',')[0] : req.protocol;
        const selfBaseUrl = process.env.DEMO_LINK_BASE_URL || `${proto}://${req.get('host')}`;

        let shareUrl;
        try {
            shareUrl = new URL(`/demo-access/${token}`, selfBaseUrl).toString();
        } catch (e) {
            shareUrl = `${proto}://${req.get('host')}/demo-access/${token}`;
        }

        res.status(201).json({ token, expiresAt, url: shareUrl });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create demo link' });
    }
};
