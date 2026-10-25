/**
 * Public, token-protected activation endpoints (§11.2, §12.4, §12.6) and the
 * customer's "your provider" endpoints (§18).
 *
 * Opening an emailed link only shows a page; activation happens on an
 * explicit POST, so email scanners that open links can't activate accounts.
 */
const crypto = require('crypto');
const User = require('../models/User');
const SubAdmin = require('../models/SubAdmin');
const AccountEvent = require('../models/AccountEvent');
const Session = require('../models/Session');
const logger = require('../utils/logger');
const { recordEvent } = require('../services/accountEventService');
const pricing = require('../services/pricing');
const billing = require('../services/subAdminBilling');
const scope = require('../services/subAdminScope');
const provider = require('../services/providerService');
const { getPolicy } = require('../services/subAdminPolicy');

const hashToken = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex');
const tellAdmins = (payload) => require('../utils/notificationUtils').notifyAdmins(payload).catch(() => {});
const tellUser = (userId, payload) => require('../utils/notificationUtils').sendNotification(userId, payload).catch(() => {});
const actorReq = (req, user) => ({ ip: req.ip, user: { userId: user.userId, userType: user.userType } });

async function findByActivationToken(token) {
    if (!token || String(token).length < 20) return null;
    return User.findOne({ 'activation.tokenHash': hashToken(token) });
}

// ── customer activation ──────────────────────────────────────────────────
exports.customerActivationInfo = async (req, res) => {
    try {
        const u = await findByActivationToken(req.query.token);
        if (!u || u.userType !== 'user' || !u.managedBy) return res.status(404).json({ message: 'This activation link is not valid.' });
        if (u.status !== 'AwaitingActivation') return res.json({ alreadyActive: true, userId: u.userId });
        const expired = !u.activation.expiresAt || new Date(u.activation.expiresAt) <= new Date();
        const prov = await provider.getProviderForUser(u);
        res.json({
            userId: u.userId,
            userName: u.userName,
            plan: u.activation.plan,
            mouzas: (u.tehsilAccess || []).flatMap(a => (a.mouzas || []).map(m => `${a.tehsil} - ${m}`)),
            customerFee: u.activation.customerFee || null,
            providerName: prov.name,
            expired
        });
    } catch (err) {
        logger.error('customerActivationInfo error', { error: err.message });
        res.status(500).json({ message: 'Something went wrong.' });
    }
};

exports.activateCustomer = async (req, res) => {
    try {
        const u = await findByActivationToken(req.body?.token);
        if (!u || u.userType !== 'user' || !u.managedBy) return res.status(404).json({ message: 'This activation link is not valid.' });
        if (u.status !== 'AwaitingActivation') return res.json({ message: 'Your account is already active. You can log in.', alreadyActive: true, userId: u.userId });
        if (!u.activation.expiresAt || new Date(u.activation.expiresAt) <= new Date()) {
            return res.status(410).json({ message: 'This activation link has expired. Ask your provider to resend it.' });
        }

        const deviceId = String(req.body?.deviceId || '').slice(0, 200) || null;
        const plan = u.activation.plan || u.subscriptionType;
        const subAdmin = await SubAdmin.findOne({ userId: u.managedBy });

        // One trial per device, ever.
        if (plan === 'Trial24' && deviceId) {
            const usedDevice = await User.exists({ _id: { $ne: u._id }, deviceId })
                || await AccountEvent.exists({ type: 'ACTIVATED', plan: { $in: ['Trial', 'Trial24'] }, 'after.deviceId': deviceId });
            if (usedDevice) {
                tellAdmins({ type: 'alert', title: `[${u.managedBy}] trial blocked on a reused device`, message: `${u.userId} tried to activate a free trial on a device that already had an account.` });
                return res.status(409).json({ message: 'This device has already been used for a free trial. Ask your provider for a Monthly or Yearly plan.' });
            }
        }

        let quote = null;
        if (plan === 'Monthly' || plan === 'Yearly') {
            // Manual pricing for now: the platform bills the price the sub-admin entered.
            quote = { price: Math.max(0, Number(u.activation.customerFee) || 0), tierKey: u.planTier || undefined, pricingVersion: undefined };
        }

        const now = new Date();
        u.subscriptionType = plan;
        u.startDate = now;
        u.status = 'Active';
        if (deviceId && !u.deviceId) u.deviceId = deviceId;
        u.activation.tokenHash = undefined;
        u.activation.activatedAt = now;
        u.activation.activatedIp = req.ip;
        u.activation.activatedDevice = deviceId;
        u.markModified('activation');
        if (quote) u.planTier = quote.tierKey;
        await u.save();                                   // save hook sets endDate
        if (quote) {
            u.paidPeriod = { start: u.startDate, end: u.endDate, plan, tierPricePaid: quote.price, pricingVersion: quote.pricingVersion, changeUsed: false };
            await u.save();
        }

        await recordEvent({
            userId: u.userId, ownerAtEvent: u.managedBy, type: 'ACTIVATED',
            plan, tier: quote?.tierKey, periodStart: u.startDate, periodEnd: u.endDate,
            customerFee: u.activation.customerFee,
            ...(quote ? {
                platformPrice: quote.price, paymentAmount: quote.price, billable: true,
                billDay: billing.pkDay(now), pricingVersion: quote.pricingVersion,
                requestKey: `activate:${u.userId}:${u.activation.activatedAt.toISOString()}`
            } : {}),
            after: { deviceId, ip: req.ip }
        }, actorReq(req, u));

        if (quote) {
            await billing.announceLine(u.managedBy, { amount: quote.price, userId: u.userId, label: `activated ${plan}` });
            if (subAdmin) billing.checkCredit(subAdmin).catch(() => {});
        }

        // Activation from the sub-admin's own connection suggests they activated it themselves.
        const subIps = await Session.distinct('ipAddress', { userId: u.managedBy, start: { $gte: new Date(now.getTime() - 30 * 86400e3) } });
        if (req.ip && subIps.includes(req.ip)) {
            tellAdmins({ type: 'alert', title: `[${u.managedBy}] activation from the sub-admin's own connection`, message: `${u.userId} was activated from IP ${req.ip}, which ${u.managedBy} also used recently.` });
        }

        const accDetails = require('../utils/notificationUtils').accountDetails(u);
        tellUser(u.managedBy, { type: 'activation', title: 'Customer activated', message: `${u.userId} activated their ${plan === 'Trial24' ? '24-hour trial' : plan + ' plan'}.`, details: accDetails });
        tellAdmins({ type: 'activation', title: `[${u.managedBy}] customer activated`, message: `${u.userId} — ${plan}${quote ? `, billed Rs ${quote.price}` : ''}.`, details: accDetails });

        res.json({
            message: plan === 'Trial24'
                ? `Your 24-hour trial is active until ${new Date(u.endDate).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}. You can log in now.`
                : `Your account is active until ${new Date(u.endDate).toLocaleDateString('en-PK')}. You can log in now.`,
            userId: u.userId
        });
    } catch (err) {
        logger.error('activateCustomer error', { error: err.message, stack: err.stack });
        res.status(500).json({ message: 'Activation failed. Please try again.' });
    }
};

// ── sub-admin activation ─────────────────────────────────────────────────
exports.subAdminActivationInfo = async (req, res) => {
    try {
        const u = await findByActivationToken(req.query.token);
        if (!u || u.userType !== 'subadmin') return res.status(404).json({ message: 'This activation link is not valid.' });
        const sa = await SubAdmin.findOne({ userId: u.userId }).lean();
        if (!sa) return res.status(404).json({ message: 'This activation link is not valid.' });
        if (sa.status !== 'awaiting_activation') return res.json({ alreadyActive: true, userId: u.userId });
        const policy = await getPolicy();
        res.json({
            userId: u.userId,
            userName: u.userName,
            territory: sa.territory,
            policy,
            expired: !u.activation.expiresAt || new Date(u.activation.expiresAt) <= new Date(),
            paymentDetails: sa.paymentDetails || null
        });
    } catch (err) {
        logger.error('subAdminActivationInfo error', { error: err.message });
        res.status(500).json({ message: 'Something went wrong.' });
    }
};

exports.activateSubAdmin = async (req, res) => {
    try {
        const u = await findByActivationToken(req.body?.token);
        if (!u || u.userType !== 'subadmin') return res.status(404).json({ message: 'This activation link is not valid.' });
        const sa = await SubAdmin.findOne({ userId: u.userId });
        if (!sa) return res.status(404).json({ message: 'This activation link is not valid.' });
        if (sa.status !== 'awaiting_activation') return res.json({ message: 'Your sub-admin account is already active.', alreadyActive: true });
        if (!u.activation.expiresAt || new Date(u.activation.expiresAt) <= new Date()) {
            return res.status(410).json({ message: 'This activation link has expired. Ask the admin to resend it.' });
        }
        const policy = await getPolicy();
        if (req.body?.acceptPolicyVersion !== policy.version) {
            return res.status(400).json({ message: 'Please read and accept the Fair Charge Policy.' });
        }
        let details;
        try {
            details = await require('./subAdminController').validatePaymentDetails(req.body?.paymentDetails || {});
        } catch (e) {
            return res.status(e.status || 400).json({ message: e.message });
        }

        const now = new Date();
        sa.status = 'active';
        sa.activatedAt = now;
        sa.policy = { version: policy.version, acceptedAt: now, acceptedIp: req.ip };
        sa.paymentDetails = { ...details, lockedByAdmin: sa.paymentDetails?.lockedByAdmin || false, updatedAt: now };
        await sa.save();

        u.activation.tokenHash = undefined;
        u.activation.activatedAt = now;
        u.activation.activatedIp = req.ip;
        u.markModified('activation');
        await u.save();

        await recordEvent({ userId: u.userId, ownerAtEvent: u.userId, type: 'ACTIVATED', note: 'sub-admin account', after: { policyVersion: policy.version } }, actorReq(req, u));
        await recordEvent({ userId: u.userId, ownerAtEvent: u.userId, type: 'PAYMENT_DETAILS_CHANGED', after: details }, actorReq(req, u));
        tellAdmins({ type: 'activation', title: `Sub-admin ${u.userId} activated`, message: `Accepted policy ${policy.version}. JazzCash ${details.jazzcash.number}, EasyPaisa ${details.easypaisa.number}.` });
        res.json({ message: 'Your sub-admin account is active. Log in to start managing customers.', userId: u.userId });
    } catch (err) {
        logger.error('activateSubAdmin error', { error: err.message, stack: err.stack });
        res.status(500).json({ message: 'Activation failed. Please try again.' });
    }
};

// ── email change confirmation ────────────────────────────────────────────
exports.confirmEmailChange = async (req, res) => {
    try {
        const token = req.body?.token;
        if (!token) return res.status(400).json({ message: 'Missing token.' });
        const u = await User.findOne({ 'pendingEmail.tokenHash': hashToken(token) });
        if (!u || !u.pendingEmail?.email) return res.status(404).json({ message: 'This confirmation link is not valid.' });
        if (new Date(u.pendingEmail.expiresAt) <= new Date()) return res.status(410).json({ message: 'This confirmation link has expired.' });
        const newEmail = u.pendingEmail.email;
        if (await User.exists({ email: newEmail, _id: { $ne: u._id } })) return res.status(409).json({ message: 'That email address is now used by another account.' });
        const oldEmail = u.email;
        u.email = newEmail;
        u.pendingEmail = undefined;
        await u.save();
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'EMAIL_CHANGED', before: { email: oldEmail }, after: { email: newEmail } }, actorReq(req, u));
        if (u.managedBy) tellUser(u.managedBy, { type: 'profile', title: 'Customer email confirmed', message: `${u.userId} confirmed their new email address.` });
        res.json({ message: 'Your email address has been updated.' });
    } catch (err) {
        logger.error('confirmEmailChange error', { error: err.message });
        res.status(500).json({ message: 'Something went wrong.' });
    }
};

// ── customer: provider details and complaints (§18) ──────────────────────
exports.myProvider = async (req, res) => {
    try {
        const u = await User.findOne({ userId: req.user.userId }).select('userId managedBy').lean();
        res.json(await provider.getProviderForUser(u));
    } catch (err) {
        logger.error('myProvider error', { error: err.message });
        res.status(500).json({ message: 'Something went wrong.' });
    }
};

exports.reportProvider = async (req, res) => {
    try {
        const message = String(req.body?.message || '').trim();
        if (message.length < 10) return res.status(400).json({ message: 'Please describe the problem (at least 10 characters).' });
        const u = await User.findOne({ userId: req.user.userId }).select('userId userName mobileNumber email managedBy').lean();
        if (!u?.managedBy) return res.status(400).json({ message: 'Your account is managed directly by Naqsha Zameen. Please contact support.' });
        await tellAdmins({
            type: 'alert',
            title: `Customer complaint about ${u.managedBy}`,
            message: `${u.userId} (${u.userName || ''}, ${u.mobileNumber || 'no mobile'}): ${message.slice(0, 900)}`
        });
        const { safeSend, shell, esc } = require('../services/subAdminEmails');
        const adminEmail = (process.env.ADMIN_REPORT_EMAIL || '').split(',')[0].trim();
        if (adminEmail) {
            safeSend({ to: adminEmail, subject: `Customer complaint about sub-admin ${u.managedBy}`, html: shell('Customer complaint', `<p><strong>${esc(u.userId)}</strong> (${esc(u.userName)}, ${esc(u.mobileNumber)}, ${esc(u.email)}) reported:</p><p>${esc(message)}</p>`) }, 'complaint');
        }
        res.json({ message: 'Thank you. Naqsha Zameen has received your report.' });
    } catch (err) {
        logger.error('reportProvider error', { error: err.message });
        res.status(500).json({ message: 'Something went wrong.' });
    }
};
