/**
 * Admin console for the sub-admin program (§22, §24): appointing and
 * managing sub-admins, payments, requests, user assignment, rankings,
 * pricing and the admin's own payment details. All routes are isAdmin.
 */
const crypto = require('crypto');
const User = require('../models/User');
const SubAdmin = require('../models/SubAdmin');
const AccountEvent = require('../models/AccountEvent');
const SubAdminBill = require('../models/SubAdminBill');
const SubAdminPayment = require('../models/SubAdminPayment');
const SubAdminRequest = require('../models/SubAdminRequest');
const PricingVersion = require('../models/PricingVersion');
const logger = require('../utils/logger');
const { recordEvent, snapshotUser } = require('../services/accountEventService');
const pricing = require('../services/pricing');
const billing = require('../services/subAdminBilling');
const scope = require('../services/subAdminScope');
const emails = require('../services/subAdminEmails');
const provider = require('../services/providerService');
const policyService = require('../services/subAdminPolicy');
const { validatePaymentDetails } = require('./subAdminController');

const ACTIVATION_HOURS = 72;
const USER_ID_RE = /^[a-zA-Z0-9_.-]{3,50}$/;
const EMAIL_RE = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/;

const fail = (res, err) => {
    if (err instanceof scope.ScopeError) return res.status(err.status).json({ message: err.message });
    if (err && err.code === 11000) return res.status(400).json({ message: 'That User ID or email is already in use.' });
    if (err && err.name === 'ValidationError') return res.status(400).json({ message: Object.values(err.errors).map(e => e.message).join(', ') });
    logger.error('adminSubAdminController error', { error: err?.message, stack: err?.stack });
    return res.status(500).json({ message: err?.message || 'Something went wrong.' });
};
const bad = (m, s = 400) => new scope.ScopeError(m, s);
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const tellUser = (userId, payload) => require('../utils/notificationUtils').sendNotification(userId, payload).catch(() => {});
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;

const cleanTerritory = (t) => {
    if (!Array.isArray(t) || !t.length) throw bad('Choose at least one tehsil for the territory.');
    return [...new Set(t.map(x => String(x).trim()).filter(Boolean))];
};
/** A sub-admin's own map access = their territory (whole tehsils). */
const territoryAccess = (territory) => territory.map(t => ({ tehsil: t, mouzas: [], tempGrants: [] }));

/**
 * Sub-admin access = the user's own earlier assignments + every mouza of each
 * territory tehsil (empty list = all mouzas). Promotion and territory edits used
 * to REPLACE tehsilAccess, wiping the mouzas the user already had.
 *  - territory tehsils -> mouzas: [] (all)
 *  - other tehsils with specific mouzas (own assignments) -> kept
 *  - other "all mouzas" entries (an old territory tehsil since removed) -> dropped
 */
function mergeTerritoryAccess(existing, territory, currentActive) {
    const inTerritory = new Set(territory.map(t => t.toLowerCase()));
    const kept = (Array.isArray(existing) ? existing : [])
        .filter(e => e && e.tehsil && !inTerritory.has(String(e.tehsil).toLowerCase()) && (e.mouzas || []).length > 0)
        .map(e => ({ tehsil: e.tehsil, mouzas: [...e.mouzas], tempGrants: e.tempGrants || [] }));
    const tehsilAccess = [...territoryAccess(territory), ...kept];
    const activeTehsil = tehsilAccess.some(e => e.tehsil === currentActive) ? currentActive : territory[0];
    return { tehsilAccess, activeTehsil };
}

const PROFILE_SETTINGS = ['territory', 'trialQuotaPerMonth', 'allowedPlans', 'unpaidThreshold', 'paymentWindowDays', 'finalWarningHours', 'billEmail', 'notes', 'priceOverride', 'trialMaxMouzas'];

function applySettings(sa, body) {
    if (body.territory !== undefined) sa.territory = cleanTerritory(body.territory);
    const nums = { trialQuotaPerMonth: [0, 1000], unpaidThreshold: [0, 10000000], paymentWindowDays: [0, 60], finalWarningHours: [1, 720], trialMaxMouzas: [1, 50] };
    for (const [k, [min, max]] of Object.entries(nums)) {
        if (body[k] !== undefined) {
            const v = Number(body[k]);
            if (!Number.isFinite(v) || v < min || v > max) throw bad(`${k} must be between ${min} and ${max}.`);
            sa[k] = v;
        }
    }
    if (body.allowedPlans !== undefined) {
        const plans = (body.allowedPlans || []).filter(p => ['Trial24', 'Monthly', 'Yearly'].includes(p));
        if (!plans.length) throw bad('Allow at least one plan.');
        sa.allowedPlans = plans;
    }
    if (body.billEmail !== undefined) {
        const e = String(body.billEmail || '').trim().toLowerCase();
        if (e && !EMAIL_RE.test(e)) throw bad('Bill email is not valid.');
        sa.billEmail = e || undefined;
    }
    if (body.notes !== undefined) sa.notes = String(body.notes || '').slice(0, 2000);
    if (body.priceOverride !== undefined) {
        if (!Array.isArray(body.priceOverride)) throw bad('Price overrides must be a list.');
        sa.priceOverride = body.priceOverride
            .filter(o => o && o.tierKey)
            .map(o => {
                const monthly = o.monthly ? Number(o.monthly) : undefined;
                const yearly = o.yearly ? Number(o.yearly) : undefined;
                if ((monthly !== undefined && !(monthly > 0)) || (yearly !== undefined && !(yearly > 0))) throw bad('Override prices must be positive.');
                return { tierKey: String(o.tierKey), monthly, yearly };
            });
    }
}

async function sendAppointment(user, sa) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ACTIVATION_HOURS * 3600e3);
    user.set('activation.tokenHash', hashToken(token));
    user.set('activation.expiresAt', expiresAt);
    await user.save();
    return emails.sendSubAdminActivation({ to: user.email, userName: user.userName, userId: user.userId, token, expiresAt });
}

// ── list / detail ────────────────────────────────────────────────────────
exports.list = async (req, res) => {
    try {
        const subs = await SubAdmin.find().sort({ createdAt: -1 }).lean();
        const ids = subs.map(s => s.userId);
        const now = new Date();
        const monthStart = new Date(Date.UTC(new Date(now.getTime() + 5 * 3600e3).getUTCFullYear(), new Date(now.getTime() + 5 * 3600e3).getUTCMonth(), 1) - 5 * 3600e3);
        const in7 = new Date(now.getTime() + 7 * 86400e3);
        const sales = require('../services/subAdminSales');
        const salesMatch = await sales.saleMatch(ids);
        const [users, customerStats, billedMonth, lastPays, salesMonth] = await Promise.all([
            User.find({ userId: { $in: ids } }).select('userId userName email mobileNumber lastActive').lean(),
            User.aggregate([
                { $match: { managedBy: { $in: ids }, userType: 'user' } },
                { $group: {
                    _id: '$managedBy',
                    customers: { $sum: 1 },
                    awaiting: { $sum: { $cond: [{ $eq: ['$status', 'AwaitingActivation'] }, 1, 0] } },
                    active: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['AwaitingActivation', 'Suspended']] }] }, { $gt: ['$endDate', now] }] }, 1, 0] } },
                    expiring: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['AwaitingActivation', 'Suspended']] }] }, { $gt: ['$endDate', now] }, { $lte: ['$endDate', in7] }] }, 1, 0] } }
                } }
            ]),
            AccountEvent.aggregate([
                { $match: { ownerAtEvent: { $in: ids }, billable: true, createdAt: { $gte: monthStart } } },
                { $group: { _id: '$ownerAtEvent', billed: { $sum: '$platformPrice' } } }
            ]),
            // Latest payment per sub-admin (reversals excluded)
            SubAdminPayment.aggregate([
                { $match: { subAdminId: { $in: ids }, amount: { $gt: 0 } } },
                { $sort: { receivedAt: -1 } },
                { $group: { _id: '$subAdminId', at: { $first: '$receivedAt' }, amount: { $first: '$amount' } } }
            ]),
            // Sales in the last 30 days: same records and window as the sub-admin's
            // dashboard and the 30-day Performance view, so all three agree.
            AccountEvent.aggregate([
                { $match: { ...salesMatch, createdAt: { $gte: new Date(now.getTime() - 30 * 86400e3) } } },
                { $group: { _id: '$ownerAtEvent', sales: { $sum: 1 } } }
            ])
        ]);
        const byId = (arr, key = '_id') => Object.fromEntries(arr.map(x => [x[key], x]));
        const u = byId(users, 'userId'), c = byId(customerStats), b = byId(billedMonth), lp = byId(lastPays), sm = byId(salesMonth);
        const positionsBySub = await billing.computePositionsBulk(subs, now);
        const rows = [];
        for (const s of subs) {
            const pos = positionsBySub[s.userId] || await billing.computePosition(s, now);
            rows.push({
                userId: s.userId,
                userName: u[s.userId]?.userName,
                email: u[s.userId]?.email,
                mobileNumber: u[s.userId]?.mobileNumber,
                lastActive: u[s.userId]?.lastActive,
                status: s.status,
                territory: s.territory,
                customers: c[s.userId]?.customers || 0,
                active: c[s.userId]?.active || 0,
                awaiting: c[s.userId]?.awaiting || 0,
                expiring: c[s.userId]?.expiring || 0,
                billedThisMonth: b[s.userId]?.billed || 0,
                salesThisMonth: sm[s.userId]?.sales || 0,
                lastPaymentAt: lp[s.userId]?.at || null,
                lastPaymentAmount: lp[s.userId]?.amount || 0,
                paidTotal: pos.paidTotal,
                billedTotal: pos.billedTotal + (pos.today?.total || 0),
                balance: pos.balance,
                overdue: pos.overdue,
                today: pos.today.total,
                oldestUnpaid: pos.oldestUnpaid,
                finalWarning: s.finalWarning,
                paymentDetails: s.paymentDetails
            });
        }
        res.json({ subAdmins: rows });
    } catch (err) { fail(res, err); }
};

exports.detail = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId }).lean();
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const [user, pos, requests, prices] = await Promise.all([
            User.findOne({ userId: sa.userId }).select('userId userName email mobileNumber lastActive createdAt').lean(),
            billing.computePosition(sa),
            SubAdminRequest.find({ subAdminId: sa.userId }).sort({ createdAt: -1 }).limit(50).lean(),
            pricing.priceList(sa)
        ]);
        res.json({
            subAdmin: sa,
            user,
            position: { balance: pos.balance, overdue: pos.overdue, dueNotOverdue: pos.dueNotOverdue, advanceCredit: pos.advanceCredit, today: pos.today, paidTotal: pos.paidTotal, billedTotal: pos.billedTotal, oldestUnpaid: pos.oldestUnpaid },
            requests,
            prices
        });
    } catch (err) { fail(res, err); }
};

exports.events = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const filter = { $or: [{ ownerAtEvent: req.params.userId }, { actorId: req.params.userId }] };
        // Optional filters: event type, customer ID (partial), who acted, billed only, PKT date range.
        const q = req.query;
        if (q.type) filter.type = String(q.type);
        if (q.customer) filter.userId = { $regex: String(q.customer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        if (q.actorRole) filter.actorRole = String(q.actorRole);
        if (q.billable === 'true') filter.billable = true;
        const range = {};
        if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) range.$gte = new Date(`${q.from}T00:00:00+05:00`);
        if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) range.$lte = new Date(`${q.to}T23:59:59.999+05:00`);
        if (range.$gte || range.$lte) filter.createdAt = range;

        const [events, total, types] = await Promise.all([
            AccountEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AccountEvent.countDocuments(filter),
            AccountEvent.distinct('type', { $or: filter.$or })
        ]);
        res.json({ events, types: types.sort(), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { fail(res, err); }
};

exports.bills = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId }).lean();
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const pos = await billing.computePosition(sa);
        const bills = pos.allocations.map(a => ({ ...a.bill, paidAmount: a.paid, unpaid: a.unpaid, overdue: a.unpaid > 0 && a.bill.dueAt && new Date(a.bill.dueAt) <= new Date() })).reverse();
        const payments = await SubAdminPayment.find({ subAdminId: sa.userId }).sort({ createdAt: -1 }).lean();
        res.json({ bills, payments, position: { balance: pos.balance, overdue: pos.overdue, advanceCredit: pos.advanceCredit, today: pos.today } });
    } catch (err) { fail(res, err); }
};

exports.billLines = async (req, res) => {
    try {
        const bill = await SubAdminBill.findById(req.params.billId).lean();
        if (!bill) return res.status(404).json({ message: 'Bill not found' });
        res.json({ bill, lines: await billing.billLines(bill.subAdminId, bill.day) });
    } catch (err) { fail(res, err); }
};

// ── appoint / promote / settings ─────────────────────────────────────────
exports.create = async (req, res) => {
    try {
        const b = req.body || {};
        const userId = String(b.userId || '').trim();
        const email = String(b.email || '').trim().toLowerCase();
        if (!USER_ID_RE.test(userId)) throw bad('User ID must be 3–50 letters, numbers, dots, underscores or hyphens.');
        if (!String(b.userName || '').trim()) throw bad('Name is required.');
        if (!EMAIL_RE.test(email)) throw bad('A valid email is required; the sub-admin activates from it.');
        if (await require('../services/subAdminPolicy').emailTaken(User, email)) throw bad('That email is already used by another account.');
        const territory = cleanTerritory(b.territory);
        const password = b.password ? String(b.password) : `${String(b.userName).trim().split(/\s+/)[0].replace(/^./, c => c.toUpperCase())}@${crypto.randomInt(10000, 99999)}`;

        const user = new User({
            userId, userName: String(b.userName).trim(), email, mobileNumber: String(b.mobileNumber || '').trim(), password,
            userType: 'subadmin', subscriptionType: 'Permanent', startDate: new Date(), status: 'Active',
            tehsilAccess: territoryAccess(territory), activeTehsil: territory[0], createdBy: req.user.userId, fee: 0
        });
        await user.save();
        const sa = new SubAdmin({ userId, territory, appointedBy: req.user.userId });
        applySettings(sa, { ...b, territory });
        await sa.save();
        const sent = await sendAppointment(user, sa);
        await recordEvent({ userId, ownerAtEvent: userId, type: 'USER_CREATED', plan: 'Permanent', note: 'sub-admin appointed', after: { territory } }, req);
        res.status(201).json({ message: sent ? `Sub-admin created. Activation link sent to ${email}.` : 'Sub-admin created, but the activation email failed. Use "Resend activation".', password: b.password ? undefined : password });
    } catch (err) { fail(res, err); }
};

exports.promote = async (req, res) => {
    try {
        const wanted = String(req.params.userId || '').trim();
        if (!wanted) throw bad('Select a user from the list first.');
        const esc = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const user = await User.findOne({ userIdLower: wanted.toLowerCase() })
            || await User.findOne({ userId: wanted })
            || await User.findOne({ userId: { $regex: `^${esc}$`, $options: 'i' } }); // older records without userIdLower
        if (!user) return res.status(404).json({ message: `User "${wanted}" not found.` });
        if (user.userType !== 'user') throw bad('Only a normal user can be promoted.');
        if (user.managedBy) throw bad('This user is a customer of another sub-admin. Take them back first.');
        if (!user.email || !EMAIL_RE.test(user.email)) throw bad('The user needs a valid email address before promotion (they activate from it).');
        const territory = cleanTerritory(req.body?.territory);
        const before = snapshotUser(user);
        user.userType = 'subadmin';
        user.subscriptionType = 'Permanent';
        user.startDate = new Date();
        user.status = 'Active';
        // Keep the mouzas the user already had; add the territory (all mouzas).
        const merged = mergeTerritoryAccess(user.tehsilAccess, territory, user.activeTehsil);
        user.tehsilAccess = merged.tehsilAccess;
        user.activeTehsil = merged.activeTehsil;
        user.markModified('tehsilAccess');
        await user.save();
        const sa = new SubAdmin({ userId: user.userId, territory, appointedBy: req.user.userId });
        applySettings(sa, { ...(req.body || {}), territory });
        await sa.save();
        const sent = await sendAppointment(user, sa);
        await recordEvent({ userId: user.userId, ownerAtEvent: user.userId, type: 'PLAN_CHANGED', note: 'promoted to sub-admin', before, after: { userType: 'subadmin', territory } }, req);
        res.json({ message: sent ? `${user.userId} promoted. Activation link sent to ${user.email}.` : 'Promoted, but the activation email failed. Use "Resend activation".' });
    } catch (err) { fail(res, err); }
};

exports.update = async (req, res) => {
    try {
        const extra = Object.keys(req.body || {}).filter(k => !PROFILE_SETTINGS.includes(k));
        if (extra.length) throw bad(`These fields can't be set here: ${extra.join(', ')}`);
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const before = sa.toObject();
        applySettings(sa, req.body);
        await sa.save();
        if (req.body.territory !== undefined) {
            const current = await User.findOne({ userId: sa.userId }).select('tehsilAccess activeTehsil').lean();
            const merged = mergeTerritoryAccess(current?.tehsilAccess, sa.territory, current?.activeTehsil);
            await User.updateOne({ userId: sa.userId }, { $set: { tehsilAccess: merged.tehsilAccess, activeTehsil: merged.activeTehsil } });
            tellUser(sa.userId, { type: 'profile', title: 'Territory updated', message: `Your territory is now: ${sa.territory.join(', ')}.` });
        }
        await recordEvent({ userId: sa.userId, ownerAtEvent: sa.userId, type: 'PLAN_CHANGED', note: 'sub-admin settings changed', before: pickSettings(before), after: pickSettings(sa.toObject()) }, req);
        billing.checkCredit(sa).catch(() => {});
        res.json({ message: 'Saved.', subAdmin: sa });
    } catch (err) { fail(res, err); }
};
const pickSettings = (o) => Object.fromEntries(PROFILE_SETTINGS.map(k => [k, o[k]]));

exports.setPaymentDetails = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const { locked, ...details } = req.body || {};
        const before = sa.paymentDetails ? JSON.parse(JSON.stringify(sa.paymentDetails)) : null;
        if (Object.keys(details).length) {
            const valid = await validatePaymentDetails(details);
            sa.paymentDetails = { ...valid, lockedByAdmin: !!(locked ?? sa.paymentDetails?.lockedByAdmin), updatedAt: new Date() };
        } else if (locked !== undefined) {
            sa.paymentDetails = { ...(sa.paymentDetails?.toObject?.() || sa.paymentDetails || {}), lockedByAdmin: !!locked };
        }
        sa.markModified('paymentDetails');
        await sa.save();
        await recordEvent({ userId: sa.userId, ownerAtEvent: sa.userId, type: 'PAYMENT_DETAILS_CHANGED', before, after: sa.paymentDetails }, req);
        tellUser(sa.userId, { type: 'profile', title: 'Payment details updated by admin', message: sa.paymentDetails.lockedByAdmin ? 'Your payment details were updated and are locked. Contact the admin to change them.' : 'Your payment details were updated by the admin.' });
        res.json({ message: 'Saved.', paymentDetails: sa.paymentDetails });
    } catch (err) { fail(res, err); }
};

exports.disable = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        sa.status = 'disabled';
        sa.disabledBy = req.user.userId;
        sa.disabledAt = new Date();
        sa.disabledReason = String(req.body?.reason || '').slice(0, 500);
        await sa.save();
        await User.updateOne({ userId: sa.userId }, { $inc: { tokenVersion: 1 } });       // logged out everywhere
        await recordEvent({ userId: sa.userId, ownerAtEvent: sa.userId, type: 'SUSPENDED', note: `sub-admin disabled${sa.disabledReason ? ': ' + sa.disabledReason : ''}` }, req);
        res.json({ message: `${sa.userId} disabled and logged out. Their customers are not affected.` });
    } catch (err) { fail(res, err); }
};

exports.enable = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const wasActivated = !!sa.activatedAt;
        sa.status = wasActivated ? 'active' : 'awaiting_activation';
        sa.finalWarning = undefined;
        sa.suspendedAt = undefined;
        sa.disabledAt = undefined;
        sa.disabledReason = undefined;
        await sa.save();
        await recordEvent({ userId: sa.userId, ownerAtEvent: sa.userId, type: 'REACTIVATED', note: 'sub-admin enabled' + (req.body?.reason ? ': ' + req.body.reason : '') }, req);
        if (wasActivated) await billing.checkCredit(sa);
        tellUser(sa.userId, { type: 'activation', title: 'Sub-admin account enabled', message: 'Your sub-admin account is active again.' });
        res.json({ message: `${sa.userId} enabled.` });
    } catch (err) { fail(res, err); }
};

/** Manual restore from an unpaid-bills suspension (e.g. agreed payment plan). */
exports.restore = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        if (!['suspended_unpaid', 'final_warning'].includes(sa.status)) throw bad('This sub-admin is not suspended or on final warning.');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) throw bad('Give a reason (it is recorded).');
        sa.status = 'active';
        sa.finalWarning = undefined;
        sa.suspendedAt = undefined;
        await sa.save();
        await recordEvent({ userId: sa.userId, ownerAtEvent: sa.userId, type: 'REACTIVATED', note: `restored by admin: ${reason}` }, req);
        tellUser(sa.userId, { type: 'activation', title: 'Sub-admin account restored', message: 'The admin has restored your account.' });
        res.json({ message: `${sa.userId} restored. The unpaid-bills check runs again with the next payment or billable action.` });
    } catch (err) { fail(res, err); }
};

exports.resendActivation = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        if (sa.status !== 'awaiting_activation') throw bad('This sub-admin is already activated.');
        const user = await User.findOne({ userId: sa.userId });
        const sent = await sendAppointment(user, sa);
        res.json({ message: sent ? `Activation link resent to ${user.email}.` : 'The email could not be sent.' });
    } catch (err) { fail(res, err); }
};

// ── payments (§17) ───────────────────────────────────────────────────────
exports.recordPayment = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const amount = Number(req.body?.amount);
        const method = String(req.body?.method || '');
        const reference = String(req.body?.reference || '').trim();
        if (!Number.isInteger(amount) || amount <= 0) throw bad('Amount must be a whole number of rupees above 0.');
        if (!['jazzcash', 'easypaisa', 'bank', 'cash'].includes(method)) throw bad('Choose JazzCash, EasyPaisa, bank or cash.');
        const receivedAt = req.body?.receivedAt ? new Date(req.body.receivedAt) : new Date();
        if (isNaN(receivedAt.getTime()) || receivedAt > new Date(Date.now() + 86400e3)) throw bad('Received date is not valid.');
        if (reference && !req.body?.confirmDuplicate) {
            const dup = await SubAdminPayment.findOne({ reference, amount: { $gt: 0 } }).lean();
            if (dup) return res.status(409).json({ duplicate: true, message: `Reference ${reference} was already used for ${rs(dup.amount)} from ${dup.subAdminId} on ${new Date(dup.receivedAt).toLocaleDateString('en-PK')}. Record anyway?` });
        }
        const payment = await SubAdminPayment.create({
            subAdminId: sa.userId, amount, method, reference: reference || undefined, receivedAt,
            note: String(req.body?.note || '').slice(0, 500), recordedBy: req.user.userId
        });
        const pos = await billing.checkCredit(sa);
        tellUser(sa.userId, { type: 'subscription', title: 'Payment received', message: `${rs(amount)} recorded (${method}${reference ? ', ref ' + reference : ''}). Balance: ${rs(pos?.balance)}.` });
        const u = await User.findOne({ userId: sa.userId }).select('email userName').lean();
        const to = sa.billEmail || u?.email;
        if (to) emails.safeSend({ to, subject: `Payment received: ${rs(amount)}`, html: emails.shell('Payment received', `<p>Hello <strong>${emails.esc(u?.userName || sa.userId)}</strong>,</p><p>We recorded your payment of <strong>${rs(amount)}</strong> (${emails.esc(method)}${reference ? ', reference ' + emails.esc(reference) : ''}).</p><p>Your balance is now <strong>${rs(pos?.balance)}</strong>.</p>`) }, 'payment receipt');
        res.status(201).json({ message: `${rs(amount)} recorded.`, payment, position: { balance: pos?.balance, overdue: pos?.overdue, advanceCredit: pos?.advanceCredit }, status: sa.status });
    } catch (err) { fail(res, err); }
};

// Correction of a sub-admin's money owed (any number of times). The admin enters
// the correct amount; the difference goes on today's bill as a BALANCE_ADJUSTED
// line (a credit when it lowers the amount), so "Money owed" equals the entered
// amount straight away and the history keeps every correction.
exports.correctBalance = async (req, res) => {
    try {
        const sa = await SubAdmin.findOne({ userId: req.params.userId });
        if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
        const target = Number(req.body?.amount);
        if (!Number.isInteger(target) || target < 0) throw bad('Enter the correct money owed as a whole number of rupees (0 or more).');
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 3) throw bad('Give a reason for the correction (it is recorded).');

        const now = new Date();
        const before = await billing.computePosition(sa, now);
        const diff = target - before.balance;
        if (diff === 0) throw bad(`Money owed is already ${rs(target)}.`);

        // The latest correction is kept on the sub-admin for display.
        const claimed = await SubAdmin.findOneAndUpdate(
            { _id: sa._id },
            { $set: { balanceCorrection: { at: now, by: req.user.userId, from: before.balance, to: target, reason: reason.slice(0, 500) } } },
            { new: true }
        );

        // requestKey per correction (same minute + same target = a double click).
        await recordEvent({
            userId: sa.userId, ownerAtEvent: sa.userId, type: 'BALANCE_ADJUSTED',
            platformPrice: diff, paymentAmount: 0, billable: true, billDay: billing.pkDay(now),
            before: { balance: before.balance }, after: { balance: target },
            note: `Money owed corrected ${rs(before.balance)} → ${rs(target)}: ${reason.slice(0, 300)}`,
            requestKey: `balance-correction:${sa.userId}:${Math.floor(now.getTime() / 60000)}:${target}`
        }, req, { throwOnDuplicate: true });
        const pos = await billing.checkCredit(claimed);
        tellUser(sa.userId, { type: 'subscription', title: 'Money owed corrected', message: `The admin corrected your money owed from ${rs(before.balance)} to ${rs(target)}. Reason: ${reason}` });
        res.json({ message: `Money owed corrected: ${rs(before.balance)} → ${rs(target)}.`, position: { balance: pos?.balance ?? target, overdue: pos?.overdue, advanceCredit: pos?.advanceCredit }, balanceCorrection: claimed.balanceCorrection });
    } catch (err) { fail(res, err); }
};

exports.reversePayment = async (req, res) => {
    try {
        const orig = await SubAdminPayment.findById(req.params.paymentId).lean();
        if (!orig || orig.amount <= 0) return res.status(404).json({ message: 'Payment not found' });
        if (await SubAdminPayment.exists({ reversesPaymentId: orig._id })) throw bad('This payment was already reversed.');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) throw bad('Give a reason for the reversal (it is recorded).');
        const reversal = await SubAdminPayment.create({
            subAdminId: orig.subAdminId, amount: -orig.amount, method: 'reversal', reference: orig.reference,
            note: reason.slice(0, 500), recordedBy: req.user.userId, reversesPaymentId: orig._id
        });
        const sa = await SubAdmin.findOne({ userId: orig.subAdminId });
        const pos = sa ? await billing.checkCredit(sa) : null;
        tellUser(orig.subAdminId, { type: 'alert', title: 'Payment reversed', message: `A payment of ${rs(orig.amount)} was reversed: ${reason}. Balance: ${rs(pos?.balance)}.` });
        res.json({ message: 'Payment reversed.', reversal });
    } catch (err) { fail(res, err); }
};

// Edit a recorded payment (amount, method, date, reference, note). The previous
// values are kept on the payment (`edits`) and in the account history.
exports.editPayment = async (req, res) => {
    try {
        const p = await SubAdminPayment.findById(req.params.paymentId);
        if (!p) return res.status(404).json({ message: 'Payment not found' });
        if (p.method === 'reversal') throw bad('A reversal can\'t be edited. Edit the original payment instead.');
        const b = req.body || {};
        const reason = String(b.reason || '').trim();
        if (reason.length < 3) throw bad('Give a reason for the edit (it is recorded).');
        const next = {};
        if (b.amount !== undefined) {
            const amount = Number(b.amount);
            if (!Number.isInteger(amount) || amount <= 0) throw bad('Amount must be a whole number of rupees above 0.');
            next.amount = amount;
        }
        if (b.method !== undefined) {
            if (!['jazzcash', 'easypaisa', 'bank', 'cash'].includes(b.method)) throw bad('Choose JazzCash, EasyPaisa, bank or cash.');
            next.method = b.method;
        }
        if (b.receivedAt !== undefined) {
            const d = new Date(b.receivedAt);
            if (isNaN(d.getTime()) || d > new Date(Date.now() + 86400e3)) throw bad('Received date is not valid.');
            next.receivedAt = d;
        }
        if (b.reference !== undefined) next.reference = String(b.reference).trim() || undefined;
        if (b.note !== undefined) next.note = String(b.note).slice(0, 500);
        const before = {}, after = {};
        for (const [k, v] of Object.entries(next)) {
            const old = p[k] instanceof Date ? p[k].toISOString() : p[k];
            const nv = v instanceof Date ? v.toISOString() : v;
            if (String(old ?? '') !== String(nv ?? '')) { before[k] = p[k]; after[k] = v; }
        }
        if (!Object.keys(after).length) return res.json({ message: 'Nothing changed.' });
        Object.assign(p, after);
        p.edits.push({ at: new Date(), by: req.user.userId, reason: reason.slice(0, 500), before, after });
        await p.save();
        // A reversal of this payment must still cancel it exactly.
        if (after.amount !== undefined) {
            await SubAdminPayment.updateMany({ reversesPaymentId: p._id }, { $set: { amount: -p.amount } });
        }
        await recordEvent({
            userId: p.subAdminId, ownerAtEvent: p.subAdminId, type: 'PAYMENT_EDITED', before, after,
            note: `Payment of ${new Date(p.receivedAt).toLocaleDateString('en-PK')} edited${after.amount !== undefined ? `: ${rs(before.amount)} → ${rs(after.amount)}` : ''}. ${reason.slice(0, 300)}`
        }, req);
        const sa = await SubAdmin.findOne({ userId: p.subAdminId });
        const pos = sa ? await billing.checkCredit(sa) : null;
        tellUser(p.subAdminId, { type: 'subscription', title: 'Payment record corrected', message: `The admin corrected a payment record${after.amount !== undefined ? ` (${rs(before.amount)} → ${rs(after.amount)})` : ''}. Reason: ${reason}. Balance: ${rs(pos?.balance)}.` });
        res.json({ message: 'Payment updated.', payment: p });
    } catch (err) { fail(res, err); }
};

// Edit the billed amount (payable to admin) of one bill line, e.g. a renewal.
// The line is corrected in place so every screen (bills, renewals, sales,
// revenue) shows the right amount; the old amount is kept on the line and in a
// BILL_LINE_EDITED history record, and that day's bill is recalculated.
exports.editBillLine = async (req, res) => {
    try {
        const ev = await AccountEvent.findOne({ _id: req.params.eventId, ownerAtEvent: req.params.userId, billable: true }).lean();
        if (!ev) return res.status(404).json({ message: 'Billed line not found' });
        const amount = Number(req.body?.amount);
        if (!Number.isInteger(amount)) throw bad('Enter the correct amount as a whole number of rupees.');
        if (ev.platformPrice > 0 && amount < 0) throw bad('A charge can be lowered to 0, not below. Use "Correct money owed" for a credit.');
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 3) throw bad('Give a reason for the edit (it is recorded).');
        const old = ev.platformPrice || 0;
        if (amount === old) return res.json({ message: 'Nothing changed.' });

        // AccountEvent is append-only at the model level; this audited admin
        // correction goes through the raw collection on purpose.
        await AccountEvent.collection.updateOne({ _id: ev._id }, {
            $set: {
                platformPrice: amount, paymentAmount: amount, editedAt: new Date(), editedBy: req.user.userId,
                ...(ev.originalPlatformPrice === undefined ? { originalPlatformPrice: old } : {})
            }
        });
        await billing.recomputeBill(ev.ownerAtEvent, ev.billDay);
        await recordEvent({
            userId: ev.userId, ownerAtEvent: ev.ownerAtEvent, type: 'BILL_LINE_EDITED',
            before: { eventId: ev._id, type: ev.type, platformPrice: old }, after: { platformPrice: amount },
            note: `${ev.type.replace(/_/g, ' ').toLowerCase()} of ${ev.billDay}: ${rs(old)} → ${rs(amount)}. ${reason.slice(0, 300)}`
        }, req);
        const sa = await SubAdmin.findOne({ userId: ev.ownerAtEvent });
        const pos = sa ? await billing.checkCredit(sa) : null;
        tellUser(ev.ownerAtEvent, { type: 'subscription', title: 'Bill corrected', message: `${ev.userId} (${ev.billDay}): ${rs(old)} → ${rs(amount)}. Reason: ${reason}. Balance: ${rs(pos?.balance)}.` });
        res.json({ message: `Billed amount corrected: ${rs(old)} → ${rs(amount)}.` });
    } catch (err) { fail(res, err); }
};

// ── assign customers (§22) ───────────────────────────────────────────────
exports.assignUsers = async (req, res) => {
    try {
        const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
        const target = req.body?.subAdminId ? String(req.body.subAdminId) : null;
        if (!userIds.length) throw bad('Choose at least one user.');
        if (userIds.length > 500) throw bad('Assign at most 500 users at a time.');
        let sa = null;
        if (target) {
            sa = await SubAdmin.findOne({ userId: target });
            if (!sa) throw bad('Sub-admin not found.');
            if (sa.status === 'disabled') throw bad('That sub-admin is disabled.');
        }
        const users = await User.find({ userId: { $in: userIds }, userType: 'user' });
        const skipped = [];
        const movedIds = [];
        const lostBy = {}; // previous sub-admin -> customer IDs taken from them
        for (const u of users) {
            if (['PendingVerification', 'Pending', 'AwaitingActivation'].includes(u.status) && u.isPublicRegistration) { skipped.push(`${u.userId} (not activated yet)`); continue; }
            if ((u.managedBy || null) === target) continue;
            const from = u.managedBy || null;
            u.managedBy = target;
            await u.save();
            await recordEvent({ userId: u.userId, ownerAtEvent: target, type: 'TRANSFERRED', before: { managedBy: from }, after: { managedBy: target } }, req);
            if (from) (lostBy[from] = lostBy[from] || []).push(u.userId);
            movedIds.push(u.userId);
        }
        const moved = movedIds.length;
        const missing = userIds.filter(id => !users.some(u => u.userId === id));

        // One notification per affected sub-admin, and a summary for every admin.
        const list = (ids) => ids.length > 20 ? `${ids.slice(0, 20).join(', ')} and ${ids.length - 20} more` : ids.join(', ');
        const nameOf = async (id) => (await User.findOne({ userId: id }).select('userName').lean())?.userName || id;
        for (const [from, ids] of Object.entries(lostBy)) {
            tellUser(from, {
                type: 'info',
                title: target ? 'Customers moved to another sub-admin' : 'Customers taken back by the admin',
                message: `${ids.length} customer(s) are no longer managed by you: ${list(ids)}.`
            });
        }
        if (target && moved) {
            tellUser(target, { type: 'info', title: 'Customers assigned to you', message: `The admin assigned ${moved} customer(s) to you: ${list(movedIds)}.` });
        }
        if (moved) {
            const fromNames = await Promise.all(Object.keys(lostBy).map(async id => `${await nameOf(id)} (${id}, ${lostBy[id].length})`));
            const directCount = moved - Object.values(lostBy).reduce((n, ids) => n + ids.length, 0);
            const sources = [...fromNames, ...(directCount ? [`direct (${directCount})`] : [])].join(', ');
            require('../utils/notificationUtils').notifyAdmins({
                type: 'info',
                title: target ? `Customers assigned to ${sa ? await nameOf(target) : target}` : 'Customers taken back from sub-admins',
                message: `${req.user.userId} moved ${moved} customer(s) ${target ? `to sub-admin ${target}` : 'back to direct management'} from ${sources}: ${list(movedIds)}.`
            }).catch(() => {});
        }
        res.json({ message: `${moved} user(s) ${target ? 'assigned to ' + target : 'taken back'}.`, moved, skipped, notFound: missing });
    } catch (err) { fail(res, err); }
};

// ── requests (§14, §20) ──────────────────────────────────────────────────
exports.listRequests = async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.subAdminId) filter.subAdminId = req.query.subAdminId;
        const rows = await SubAdminRequest.find(filter).sort({ createdAt: -1 }).limit(500).lean();
        const eventIds = rows.filter(r => r.eventId).map(r => r.eventId);
        const events = eventIds.length ? await AccountEvent.find({ _id: { $in: eventIds } }).lean() : [];
        const byId = Object.fromEntries(events.map(e => [String(e._id), e]));
        res.json({ requests: rows.map(r => ({ ...r, event: r.eventId ? byId[String(r.eventId)] : undefined })) });
    } catch (err) { fail(res, err); }
};

exports.approveRequest = async (req, res) => {
    try {
        const r = await SubAdminRequest.findById(req.params.id);
        if (!r) return res.status(404).json({ message: 'Request not found' });
        if (r.status !== 'pending') throw bad('This request was already decided.');
        const u = await User.findOne({ userId: r.userId });
        if (!u) throw bad('The customer no longer exists.');
        const now = new Date();
        let message = '';

        if (r.kind === 'correction') {
            const ev = await AccountEvent.findById(r.eventId).lean();
            if (!ev || !(ev.platformPrice > 0)) throw bad('The billed action could not be found.');
            if (await AccountEvent.exists({ type: 'CORRECTION_APPROVED', reversesEventId: ev._id })) throw bad('This action was already corrected.');
            if (ev.type === 'RENEWED') {
                u.subscriptionType = ev.previousPlan || u.subscriptionType;
                u.startDate = ev.previousPeriodStart || null;
            } else if (ev.type === 'ACTIVATED') {
                u.startDate = null;                        // no paid time remains
            }
            if (u.paidPeriod) { u.paidPeriod.changeUsed = true; u.markModified('paidPeriod'); }
            await u.save();
            await recordEvent({
                userId: u.userId, ownerAtEvent: r.subAdminId, type: 'CORRECTION_APPROVED',
                reversesEventId: ev._id, platformPrice: -ev.platformPrice, paymentAmount: -ev.platformPrice,
                billable: true, billDay: billing.pkDay(now), plan: u.subscriptionType,
                note: `Credit for ${ev.type} of ${new Date(ev.createdAt).toLocaleDateString('en-PK')}: ${r.reason}`
            }, req);
            await billing.announceLine(r.subAdminId, { amount: -ev.platformPrice, userId: u.userId, label: 'correction approved' });
            message = `Correction approved: ${rs(ev.platformPrice)} credited to ${r.subAdminId}'s bill.`;
        } else if (r.kind === 'more_mouzas') {
            const requestedCount = scope.countMouzas(r.requestedAssignment);
            const limit = Number(req.body?.mouzaLimit) || Math.max(requestedCount + scope.countMouzas(u.tehsilAccess), (await pricing.getCurrentTable()).maxMouzas + 1);
            const monthly = req.body?.monthlyPrice ? Number(req.body.monthlyPrice) : undefined;
            const yearly = req.body?.yearlyPrice ? Number(req.body.yearlyPrice) : undefined;
            if ((monthly !== undefined && !(monthly > 0)) || (yearly !== undefined && !(yearly > 0))) throw bad('Prices must be positive.');
            u.customMouzaLimit = limit;
            if (monthly || yearly) u.customPlatformPrice = { monthly, yearly };
            if (u.paidPeriod) { u.paidPeriod.changeUsed = false; u.markModified('paidPeriod'); }
            await u.save();
            r.approvedMouzaLimit = limit; r.approvedMonthlyPrice = monthly; r.approvedYearlyPrice = yearly;
            await recordEvent({ userId: u.userId, ownerAtEvent: r.subAdminId, type: 'MOUZA_REQUEST_APPROVED', after: { mouzaLimit: limit, monthly, yearly, requested: r.requestedAssignment } }, req);
            message = `Approved: ${u.userId} may have up to ${limit} mouzas${monthly ? ` at ${rs(monthly)}/month` : ''}. ${r.subAdminId} can now make the change.`;
        } else if (r.kind === 'extra_change') {
            if (u.paidPeriod) { u.paidPeriod.changeUsed = false; u.markModified('paidPeriod'); }
            await u.save();
            await recordEvent({ userId: u.userId, ownerAtEvent: r.subAdminId, type: 'MOUZA_REQUEST_APPROVED', note: 'extra assignment change allowed', after: { requested: r.requestedAssignment } }, req);
            message = `Approved: ${r.subAdminId} can make one more change for ${u.userId}.`;
        }

        r.status = 'approved';
        r.decidedBy = req.user.userId;
        r.decidedAt = now;
        r.decisionNote = String(req.body?.note || '').slice(0, 500);
        await r.save();
        tellUser(r.subAdminId, { type: 'info', title: 'Request approved', message });
        const sa = await SubAdmin.findOne({ userId: r.subAdminId });
        if (sa) billing.checkCredit(sa).catch(() => {});
        res.json({ message });
    } catch (err) { fail(res, err); }
};

exports.rejectRequest = async (req, res) => {
    try {
        const r = await SubAdminRequest.findById(req.params.id);
        if (!r) return res.status(404).json({ message: 'Request not found' });
        if (r.status !== 'pending') throw bad('This request was already decided.');
        r.status = 'rejected';
        r.decidedBy = req.user.userId;
        r.decidedAt = new Date();
        r.decisionNote = String(req.body?.note || '').slice(0, 500);
        await r.save();
        tellUser(r.subAdminId, { type: 'alert', title: 'Request rejected', message: `Your ${r.kind.replace('_', ' ')} request for ${r.userId} was rejected${r.decisionNote ? ': ' + r.decisionNote : '.'}` });
        res.json({ message: 'Request rejected.' });
    } catch (err) { fail(res, err); }
};

// ── rankings (§24) ───────────────────────────────────────────────────────
exports.rankings = async (req, res) => {
    try {
        const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999+05:00`) : new Date();
        const from = req.query.from ? new Date(`${req.query.from}T00:00:00+05:00`) : new Date(to.getTime() - 30 * 86400e3);
        if (isNaN(from) || isNaN(to) || from > to) throw bad('Invalid date range.');
        const subs = await SubAdmin.find().select('userId status').lean();
        const ids = subs.map(s => s.userId);
        const now = new Date();
        const [money, created, activeNow, names] = await Promise.all([
            AccountEvent.aggregate([
                { $match: { ownerAtEvent: { $in: ids }, billable: true, createdAt: { $gte: from, $lte: to } } },
                { $group: { _id: '$ownerAtEvent', revenue: { $sum: '$platformPrice' }, customerFees: { $sum: { $ifNull: ['$customerFee', 0] } }, renewals: { $sum: { $cond: [{ $eq: ['$type', 'RENEWED'] }, 1, 0] } }, activations: { $sum: { $cond: [{ $eq: ['$type', 'ACTIVATED'] }, 1, 0] } } } }
            ]),
            AccountEvent.aggregate([
                { $match: { ownerAtEvent: { $in: ids }, type: 'USER_CREATED', actorRole: 'subadmin', createdAt: { $gte: from, $lte: to } } },
                { $group: { _id: '$ownerAtEvent', created: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $match: { managedBy: { $in: ids }, userType: 'user', status: { $nin: ['AwaitingActivation', 'Suspended'] }, endDate: { $gt: now } } },
                { $group: { _id: '$managedBy', active: { $sum: 1 } } }
            ]),
            User.find({ userId: { $in: ids } }).select('userId userName').lean()
        ]);
        const m = Object.fromEntries(money.map(x => [x._id, x]));
        const c = Object.fromEntries(created.map(x => [x._id, x.created]));
        const a = Object.fromEntries(activeNow.map(x => [x._id, x.active]));
        const n = Object.fromEntries(names.map(x => [x.userId, x.userName]));
        let rows = subs.map(s => ({
            userId: s.userId, userName: n[s.userId], status: s.status,
            revenue: m[s.userId]?.revenue || 0, customerFees: m[s.userId]?.customerFees || 0,
            renewals: m[s.userId]?.renewals || 0, activations: m[s.userId]?.activations || 0,
            newCustomers: c[s.userId] || 0, activeCustomers: a[s.userId] || 0
        }));
        const by = ['revenue', 'activeCustomers', 'newCustomers', 'renewals'].includes(req.query.by) ? req.query.by : 'revenue';
        rows.sort((x, y) => y[by] - x[by]);
        rows = rows.map((r, i) => ({ rank: i + 1, ...r }));
        res.json({ from, to, by, rankings: rows });
    } catch (err) { fail(res, err); }
};

// ── pricing (§7.3) ───────────────────────────────────────────────────────
exports.getPricing = async (req, res) => {
    try {
        const table = await pricing.getCurrentTable({ fresh: true });
        const preview = [];
        for (const t of table.tiers) {
            const q = await pricing.quote({ mouzaCount: t.minMouzas, plan: 'Monthly', table });
            preview.push({ key: t.key, mouzas: t.minMouzas === t.maxMouzas ? `${t.minMouzas}` : `${t.minMouzas}–${t.maxMouzas}`, monthly: q.monthly, yearly: q.yearly });
        }
        res.json({ table, preview });
    } catch (err) { fail(res, err); }
};

exports.savePricing = async (req, res) => {
    try {
        const current = await pricing.getCurrentTable({ fresh: true });
        const b = req.body || {};
        const proposed = {
            tiers: (b.tiers || []).map(t => ({
                key: String(t.key || '').trim(),
                minMouzas: Number(t.minMouzas), maxMouzas: Number(t.maxMouzas), monthly: Number(t.monthly),
                yearlyPinned: t.yearlyPinned === '' || t.yearlyPinned == null ? null : Number(t.yearlyPinned)
            })),
            yearlyDiscountPct: Number(b.yearlyDiscountPct ?? current.yearlyDiscountPct),
            roundTo: Number(b.roundTo ?? current.roundTo),
            roundMode: b.roundMode ?? current.roundMode,
            maxMouzas: Number(b.maxMouzas ?? current.maxMouzas),
            trialMaxMouzas: Number(b.trialMaxMouzas ?? current.trialMaxMouzas),
            minUpgradeCharge: Number(b.minUpgradeCharge ?? current.minUpgradeCharge)
        };
        const problems = pricing.validateTable(proposed);
        if (problems.length) return res.status(400).json({ message: 'The price table has problems.', problems });
        const saved = await PricingVersion.create({ version: current.version + 1, ...proposed, createdBy: req.user.userId, note: String(b.note || '').slice(0, 300) });
        pricing.clearCache();
        await recordEvent({ userId: req.user.userId, type: 'PRICING_CHANGED', before: { version: current.version, tiers: current.tiers }, after: { version: saved.version, tiers: saved.tiers } }, req);
        const active = await SubAdmin.find({ status: { $nin: ['disabled', 'awaiting_activation'] } }).select('userId').lean();
        for (const s of active) tellUser(s.userId, { type: 'info', title: 'Prices updated', message: 'The platform price table has changed. New prices apply to activations, renewals and upgrades from now on.' });
        res.json({ message: `Saved as version ${saved.version}.`, table: saved });
    } catch (err) { fail(res, err); }
};

exports.pricingVersions = async (req, res) => {
    try {
        const rows = await PricingVersion.find().sort({ version: -1 }).limit(100).lean();
        res.json({ versions: rows });
    } catch (err) { fail(res, err); }
};

exports.restorePricing = async (req, res) => {
    try {
        const old = await PricingVersion.findOne({ version: Number(req.params.version) }).lean();
        if (!old) return res.status(404).json({ message: 'Version not found' });
        const current = await pricing.getCurrentTable({ fresh: true });
        const { _id, version, createdAt, createdBy, note, ...rest } = old;
        const saved = await PricingVersion.create({ ...rest, version: current.version + 1, createdBy: req.user.userId, note: `Restored from version ${version}` });
        pricing.clearCache();
        await recordEvent({ userId: req.user.userId, type: 'PRICING_CHANGED', note: `restored version ${version}`, after: { version: saved.version } }, req);
        res.json({ message: `Version ${version} restored as version ${saved.version}.`, table: saved });
    } catch (err) { fail(res, err); }
};

// ── admin's own payment details, policy ──────────────────────────────────
exports.getAdminPaymentDetails = async (req, res) => {
    try { res.json(await provider.getAdminPaymentDetails()); } catch (err) { fail(res, err); }
};

exports.setAdminPaymentDetails = async (req, res) => {
    try {
        const b = req.body || {};
        const jc = provider.normalisePkMobile(b.jazzcash?.number);
        const ep = provider.normalisePkMobile(b.easypaisa?.number);
        const phone = provider.normalisePkMobile(b.phone);
        const wa = provider.toWhatsappIntl(b.whatsapp || b.phone);
        if (!jc || !ep || !phone || !wa) throw bad('Enter valid JazzCash, EasyPaisa, phone and WhatsApp numbers (03xxxxxxxxx).');
        const details = {
            name: String(b.name || 'GeoMatrix Technologies').slice(0, 80),
            jazzcash: { title: String(b.jazzcash?.title || '').slice(0, 80), number: jc },
            easypaisa: { title: String(b.easypaisa?.title || '').slice(0, 80), number: ep },
            phone, whatsapp: wa
        };
        await provider.setAdminPaymentDetails(details);
        res.json({ message: 'Saved. Your own customers now see these details.', details });
    } catch (err) { fail(res, err); }
};

exports.getPolicy = async (req, res) => {
    try { res.json(await policyService.getPolicy()); } catch (err) { fail(res, err); }
};

exports.setPolicy = async (req, res) => {
    try {
        const text = Array.isArray(req.body?.text) ? req.body.text.map(s => String(s).trim()).filter(Boolean) : null;
        if (!text || !text.length) throw bad('The policy needs at least one point.');
        const version = new Date().toISOString().slice(0, 16).replace('T', ' ');
        await policyService.setPolicy({ version, text });
        res.json({ message: `Policy saved as version ${version}. Sub-admins accept it on their next activation.`, version });
    } catch (err) { fail(res, err); }
};

/** Today's totals across all sub-admins, and the request queue size. */
exports.overview = async (req, res) => {
    try {
        const day = billing.pkDay();
        const [today, pending, warnings] = await Promise.all([
            AccountEvent.aggregate([{ $match: { billable: true, billDay: day } }, { $group: { _id: null, total: { $sum: '$platformPrice' }, lines: { $sum: 1 } } }]),
            SubAdminRequest.countDocuments({ status: 'pending' }),
            SubAdmin.countDocuments({ status: { $in: ['final_warning', 'suspended_unpaid'] } })
        ]);
        res.json({ day, todayTotal: today[0]?.total || 0, todayLines: today[0]?.lines || 0, pendingRequests: pending, subAdminsInArrears: warnings });
    } catch (err) { fail(res, err); }
};
