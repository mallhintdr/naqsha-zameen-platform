/**
 * Customer mouza-change requests.
 *
 *  Customer:  asks to add / remove mouzas (nothing changes yet) → a link is made
 *             and they send it to their provider on WhatsApp. They're told a small
 *             fee may apply, depending on the mouzas and the days left.
 *  Provider:  the admin, or the sub-admin who manages the customer, opens the
 *             link / edit form, sets the fee and approves (the mouzas change
 *             then) or rejects.
 *  Money:     sub-admin customers → the fee is a billable ASSIGNMENT_TOPUP line on
 *             the sub-admin's bill; admin customers → recorded as revenue.
 */
const crypto = require('crypto');
const User = require('../models/User');
const SubAdmin = require('../models/SubAdmin');
const AssignmentRequest = require('../models/AssignmentRequest');
const RenewalToken = require('../models/RenewalToken');
const logger = require('../utils/logger');
const { recordEvent, snapshotUser } = require('../services/accountEventService');
const { listMouzasForTehsil } = require('../services/tehsilDisplayService');
const { getLinkedTehsils } = require('../services/tehsilAliasService');
const { sendNotification, notifyAdmins, completeActions } = require('../utils/notificationUtils');

const REQUEST_DAYS = 7;
const lc = (s) => String(s || '').trim().toLowerCase();
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const fail = (res, err) => {
    if (err.status) return res.status(err.status).json({ message: err.message });
    logger.error('assignment request error', { error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Something went wrong.' });
};
const tell = (userId, title, message) => sendNotification(userId, { type: 'profile', title, message }).catch(() => {});
const daysLeftOf = (u, now = new Date()) => (u.endDate ? Math.max(0, Math.ceil((new Date(u.endDate) - now) / 86400e3)) : 0);
const flat = (entries) => (entries || []).flatMap(e => (e.mouzas || []).map(m => `${e.tehsil} - ${m}`));

/** Clean [{tehsil, mouzas}] input: trimmed, de-duplicated, empty entries dropped. */
function clean(list) {
    const map = new Map();
    for (const e of Array.isArray(list) ? list : []) {
        const tehsil = String(e?.tehsil || '').trim();
        if (!tehsil) continue;
        const key = lc(tehsil);
        const cur = map.get(key) || { tehsil, mouzas: [] };
        for (const m of Array.isArray(e.mouzas) ? e.mouzas : []) {
            const name = String(m || '').trim();
            if (name && !cur.mouzas.some(x => lc(x) === lc(name))) cur.mouzas.push(name);
        }
        map.set(key, cur);
    }
    return [...map.values()].filter(e => e.mouzas.length);
}

/** The customer's assigned mouzas of a tehsil (any linked name counts). */
async function assignedIn(user, tehsil) {
    const linked = (await getLinkedTehsils(tehsil)).map(lc);
    return (user.tehsilAccess || []).filter(e => linked.includes(lc(e.tehsil)) || lc(e.tehsil) === lc(tehsil)).flatMap(e => e.mouzas || []);
}

/** Admin, or the sub-admin who manages this customer. Returns the SubAdmin doc for sub-admins. */
async function assertCanDecide(req, user) {
    if (req.user.userType === 'admin') return null;
    if (req.user.userType !== 'subadmin' || user.managedBy !== req.user.userId) throw bad('This request belongs to a customer you do not manage.', 403);
    const sa = await SubAdmin.findOne({ userId: req.user.userId });
    if (!sa) throw bad('Forbidden', 403);
    if (['suspended_unpaid', 'disabled', 'awaiting_activation'].includes(sa.status)) throw bad('Your sub-admin account cannot make changes right now.', 403);
    return sa;
}

/** Expire stale pending requests (cheap; called on reads). */
const expireOld = () => Promise.all([
    AssignmentRequest.updateMany({ status: 'pending', expiresAt: { $lt: new Date() } }, { $set: { status: 'expired' } }),
    AssignmentRequest.updateMany({ status: 'invoiced', 'invoice.dueAt': { $lt: new Date() } }, { $set: { status: 'expired', decisionNote: 'invoice not paid in time' } })
]).catch(() => {});

// ── customer ─────────────────────────────────────────────────────────────
exports.createMine = async (req, res) => {
    try {
        if (req.user.userType !== 'user') throw bad('Only customers can request mouza changes here.', 403);
        const u = await User.findOne({ userId: req.user.userId });
        if (!u) throw bad('User not found', 404);
        if (['AwaitingActivation', 'Suspended', 'PendingVerification', 'Pending'].includes(u.status)) throw bad('Your account must be active to request changes.');
        const daysLeft = daysLeftOf(u);
        if (daysLeft <= 0) throw bad('Your subscription has expired. Please renew first, then request the change.');

        // One mouza change per month: an approved change in the last 30 days declines this one.
        const MONTH_MS = 30 * 24 * 3600e3;
        const lastApproved = await AssignmentRequest.findOne({ userId: u.userId, status: 'approved', decidedAt: { $gte: new Date(Date.now() - MONTH_MS) } }).sort({ decidedAt: -1 }).lean();
        if (lastApproved) {
            const next = new Date(new Date(lastApproved.decidedAt).getTime() + MONTH_MS).toLocaleDateString('en-GB');
            throw bad(`Mouza change is not permitted: you have already availed this service once this month (on ${new Date(lastApproved.decidedAt).toLocaleDateString('en-GB')}). You can request again from ${next}.`, 429);
        }

        await expireOld();
        const openInvoice = await AssignmentRequest.findOne({ userId: u.userId, status: 'invoiced' }).lean();
        if (openInvoice) throw bad(`You have an unpaid invoice ${openInvoice.invoice?.number || ''} of ${rs(openInvoice.invoice?.amount)} (due ${new Date(openInvoice.invoice?.dueAt).toLocaleDateString('en-GB')}). Please pay it first.`, 409);

        const add = clean(req.body?.add);
        const remove = clean(req.body?.remove);
        // AKAR chaks can't be requested or removed here: contact the admin.
        const akar = require('../utils/akarGuard');
        if (akar.hasAkar(add) || akar.hasAkar(remove)) throw bad(akar.AKAR_MESSAGE, 403);
        if (!add.length && !remove.length) throw bad('Choose at least one mouza to add or remove.');

        // Additions must exist and not already be assigned; removals must be assigned.
        for (const e of add) {
            const all = (await listMouzasForTehsil(e.tehsil)).map(lc);
            const have = (await assignedIn(u, e.tehsil)).map(lc);
            const unknown = e.mouzas.filter(m => !all.includes(lc(m)));
            if (unknown.length) throw bad(`Not found in ${e.tehsil}: ${unknown.join(', ')}`);
            e.mouzas = e.mouzas.filter(m => !have.includes(lc(m)));
        }
        for (const e of remove) {
            const have = (await assignedIn(u, e.tehsil)).map(lc);
            e.mouzas = e.mouzas.filter(m => have.includes(lc(m)));
        }
        const addF = add.filter(e => e.mouzas.length), removeF = remove.filter(e => e.mouzas.length);
        if (!addF.length && !removeF.length) throw bad('Nothing to change: those mouzas are already as requested.');

        // One open request at a time: the new one replaces the old.
        const old = await AssignmentRequest.find({ userId: u.userId, status: 'pending' }).select('_id').lean();
        if (old.length) {
            await AssignmentRequest.updateMany({ _id: { $in: old.map(o => o._id) } }, { $set: { status: 'cancelled', decidedAt: new Date(), decisionNote: 'replaced by a new request' } });
            await RenewalToken.deleteMany({ requestId: { $in: old.map(o => o._id) } });
            for (const o of old) completeActions('assignment', o._id);
        }

        const expiresAt = new Date(Date.now() + REQUEST_DAYS * 86400e3);
        const request = await AssignmentRequest.create({
            userId: u.userId, ownerId: u.managedBy || null, toAdd: addF, toRemove: removeF,
            note: String(req.body?.note || '').trim().slice(0, 500), daysLeft, plan: u.subscriptionType, expiresAt
        });
        const token = crypto.randomBytes(24).toString('hex');
        await RenewalToken.create({ token, userId: u.userId, requestType: 'AssignmentChange', requestId: request._id, expiresAt });
        const link = `${require('../utils/frontendOrigin').frontendOrigin(req)}/admin/activate/${token}`; // dev or production, whichever site sent it

        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUESTED', after: { add: addF, remove: removeF, daysLeft }, note: request.note || undefined }, req);

        const addList = flat(addF), removeList = flat(removeF);
        const summary = `${addList.length ? `add ${addList.length}` : ''}${addList.length && removeList.length ? ', ' : ''}${removeList.length ? `remove ${removeList.length}` : ''} mouza(s)`;
        // Short text; the full picture is in the expandable details.
        const ownerMsg = `${addList.length ? '+' + addList.length : ''}${addList.length && removeList.length ? ' / ' : ''}${removeList.length ? '−' + removeList.length : ''} mouza · ${daysLeft}d left`;
        const snap = await require('../services/customerSnapshot').customerSnapshot(u.userId);
        const details = {
            kind: 'mouzaChange',
            added: addList.map(m => m.split(' - ').slice(1).join(' - ') || m),
            removed: removeList.map(m => m.split(' - ').slice(1).join(' - ') || m),
            tehsil: [...new Set([...addF, ...removeF].map(e => e.tehsil))].join(', '),
            currentMouzas: snap?.mouzaCount || 0,
            totalAfter: Math.max(0, (snap?.mouzaCount || 0) + addList.length - removeList.length),
            lastFeePaid: snap?.lastFeePaid || 0,
            daysLeft,
            plan: u.subscriptionType,
            note: request.note || ''
        };
        // Notification with a button that opens the request (same as the WhatsApp link).
        const action = { label: 'Review Request', url: `/admin/activate/${token}`, kind: 'assignment', ref: String(request._id) };
        if (u.managedBy) sendNotification(u.managedBy, { type: 'profile', title: `Mouza change · ${u.userId}`, message: ownerMsg, action, replyTo: u.userId, details }).catch(() => {});
        else notifyAdmins({ type: 'profile', title: `Mouza change · ${u.userId}`, message: ownerMsg, action, replyTo: u.userId, details }).catch(() => {});
        // (The customer sees the fee notice in the "Request Sent" pop-up; no extra notification.)

        const whatsappText = [
            '*Mouza change request*',
            '',
            `Name: *${u.userName || u.userId}*`,
            `User ID: *${u.userId}*`,
            `Plan: *${u.subscriptionType}*`,
            `Days left: *${daysLeft}*`,
            ...(addList.length ? ['', `Add (${addList.length}):`, ...addList.map((m, i) => `${i + 1}. ${m}`)] : []),
            ...(removeList.length ? ['', `Remove (${removeList.length}):`, ...removeList.map((m, i) => `${i + 1}. ${m}`)] : []),
            ...(request.note ? ['', `Note: ${request.note}`] : []),
            '', 'Please let me know the fee for this change.',
            '', `Approve here: ${link}`
        ].join('\n');

        const provider = await require('../services/providerService').getProviderForUser(u);
        res.status(201).json({ message: 'Request sent.', request, link, whatsappText, whatsappNumber: provider?.whatsapp || null, providerName: provider?.name || null, daysLeft });
    } catch (err) { fail(res, err); }
};

exports.getMine = async (req, res) => {
    try {
        await expireOld();
        const request = await AssignmentRequest.findOne({ userId: req.user.userId }).sort({ createdAt: -1 }).lean();
        res.json({ request: request || null });
    } catch (err) { fail(res, err); }
};

exports.cancelMine = async (req, res) => {
    try {
        const r = await AssignmentRequest.findOneAndUpdate({ userId: req.user.userId, status: 'pending' }, { $set: { status: 'cancelled', decidedAt: new Date(), decisionNote: 'cancelled by the customer' } }, { new: true });
        if (!r) throw bad('No open request to cancel.', 404);
        await RenewalToken.deleteMany({ requestId: r._id });
        completeActions('assignment', r._id);
        if (r.ownerId) tell(r.ownerId, 'Mouza change request cancelled', `${r.userId} cancelled their mouza change request.`);
        res.json({ message: 'Request cancelled.' });
    } catch (err) { fail(res, err); }
};

// ── admin / sub-admin ────────────────────────────────────────────────────
exports.pendingForUser = async (req, res) => {
    try {
        await expireOld();
        const u = await User.findOne({ userId: req.params.userId }).select('userId managedBy').lean();
        if (!u) throw bad('User not found', 404);
        await assertCanDecide(req, u);
        const request = await AssignmentRequest.findOne({ userId: u.userId, status: { $in: ['pending', 'invoiced'] } }).sort({ createdAt: -1 }).lean();
        res.json({ request: request || null, invoicesEnabled: await invoicesEnabled() });
    } catch (err) { fail(res, err); }
};

exports.listOpen = async (req, res) => {
    try {
        await expireOld();
        const q = { status: { $in: ['pending', 'invoiced'] } };
        if (req.user.userType === 'subadmin') q.ownerId = req.user.userId;
        else if (req.user.userType !== 'admin') throw bad('Forbidden', 403);
        const rows = await AssignmentRequest.find(q).sort({ createdAt: -1 }).limit(200).lean();
        res.json({ requests: rows });
    } catch (err) { fail(res, err); }
};

// ── fee helpers ──────────────────────────────────────────────────────────
const INVOICE_DAYS = 3;
const roundUp50 = (n) => Math.ceil(Math.max(0, Number(n) || 0) / 50) * 50;
const isTrialPlan = (p) => ['Trial', 'Trial24'].includes(p);
const wholeRs = (v, label, { required = false } = {}) => {
    if ((v === undefined || v === null || v === '') && !required) return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw bad(`Enter ${label} as a whole number of rupees (0 or more).`);
    return n;
};
const invoiceNumber = (r) => `MC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(r._id).slice(-4).toUpperCase()}`;

/** Adds / removes the request's mouzas on the user document (not saved). */
async function applyMouzas(u, r) {
    const entries = (u.tehsilAccess || []).map(e => (e.toObject ? e.toObject() : { ...e }));
    for (const rem of r.toRemove) {
        const linked = (await getLinkedTehsils(rem.tehsil)).map(lc);
        for (const e of entries) {
            if (linked.includes(lc(e.tehsil)) || lc(e.tehsil) === lc(rem.tehsil)) e.mouzas = (e.mouzas || []).filter(m => !rem.mouzas.some(x => lc(x) === lc(m)));
        }
    }
    for (const ad of r.toAdd) {
        const linked = (await getLinkedTehsils(ad.tehsil)).map(lc);
        let e = entries.find(x => lc(x.tehsil) === lc(ad.tehsil)) || entries.find(x => linked.includes(lc(x.tehsil)));
        if (!e) { e = { tehsil: ad.tehsil, mouzas: [], tempGrants: [] }; entries.push(e); }
        for (const m of ad.mouzas) if (!(e.mouzas || []).some(x => lc(x) === lc(m))) e.mouzas.push(m);
    }
    const hadMouzas = new Set((u.tehsilAccess || []).filter(e => (e.mouzas || []).length).map(e => lc(e.tehsil)));
    u.tehsilAccess = entries.filter(e => (e.mouzas || []).length || !hadMouzas.has(lc(e.tehsil)) && (e.tempGrants || []).length);
    if (!u.tehsilAccess.some(e => e.tehsil === u.activeTehsil)) u.activeTehsil = u.tehsilAccess[0]?.tehsil || '';
    u.markModified('tehsilAccess');
}

/** Money for a sub-admin's customer is a bill line; for the admin's own it is revenue. */
async function recordMoney(req, u, sa, { type, amount, note, requestKey, extra = {} }) {
    if (!(amount > 0)) return;
    const now = new Date();
    if (u.managedBy) {
        const billing = require('../services/subAdminBilling');
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type, plan: u.subscriptionType, platformPrice: amount, paymentAmount: amount, customerFee: amount, billable: true, billDay: billing.pkDay(now), note, requestKey, ...extra }, req);
        await billing.announceLine(u.managedBy, { amount, userId: u.userId, label: note });
        const saDoc = sa || await SubAdmin.findOne({ userId: u.managedBy });
        if (saDoc) billing.checkCredit(saDoc).catch(() => {});
    } else {
        await recordEvent({ userId: u.userId, ownerAtEvent: null, type, plan: u.subscriptionType, paymentAmount: amount, note, requestKey, ...extra }, req);
    }
}

async function loadForDecision(req, statuses) {
    const r = await AssignmentRequest.findById(req.params.id);
    if (!r) throw bad('Request not found', 404);
    if (!statuses.includes(r.status)) throw bad(`This request is already ${r.status}.`, 409);
    const u = await User.findOne({ userId: r.userId });
    if (!u) throw bad('User not found', 404);
    const sa = await assertCanDecide(req, u);
    return { r, u, sa };
}

/**
 * Provider prices the change.
 *  - Removals only (or nothing to charge): applied now; the provider may lower the
 *    subscription fee (feeReduction), used from the next renewal. No refund.
 *  - Additions: an INVOICE is issued (due in 3 days). Mouzas are added only after
 *    the payment is confirmed (confirmPayment).
 *      paid plan: monthlyPrice × days left ÷ 30, rounded up to Rs 50;
 *                 new fee = fee + monthlyPrice (Monthly) or + monthlyPrice × 12 (Yearly)
 *      trial:     planFee + monthlyPrice (× 12 for Yearly), the plan starts on payment;
 *                 new fee = that total
 */
// Invoice-first flow: switched on/off by the admin (Admin Tools → Mouza Invoices), off by default.
// While off: the provider enters one fee and approves; the mouzas change straight away.
async function invoicesEnabled() {
    try {
        const doc = await require('../models/SystemConfig').findOne({ key: 'mouzaInvoicesEnabled' }).lean();
        return doc ? doc.value === true : false;
    } catch (e) { return false; }
}

async function approveDirect(req, res, { r, u, sa }) {
    const fee = wholeRs(req.body?.fee, 'the fee');
    const decisionNote = String(req.body?.note || '').trim().slice(0, 500);
    const claimed = await AssignmentRequest.findOneAndUpdate({ _id: r._id, status: 'pending' },
        { $set: { status: 'approved', fee, decisionNote, decidedBy: req.user.userId, decidedAt: new Date() } }, { new: true });
    if (!claimed) throw bad('This request was just decided.', 409);
    const before = snapshotUser(u);
    await applyMouzas(u, r);
    await u.save();
    const added = flat(r.toAdd), removed = flat(r.toRemove);
    await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_CHANGED', before: { tehsilAccess: before.tehsilAccess }, after: { tehsilAccess: snapshotUser(u).tehsilAccess, added, removed, requestId: r._id } }, req);
    await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUEST_DECIDED', after: { requestId: r._id, status: 'approved', fee }, note: decisionNote || undefined }, req);
    await recordMoney(req, u, sa, { type: 'ASSIGNMENT_TOPUP', amount: fee, note: `mouza change +${added.length} / −${removed.length}, ${r.daysLeft}d left`, requestKey: `assign-req:${r._id}` });
    await RenewalToken.deleteMany({ requestId: r._id });
    completeActions('assignment', r._id);
    tell(u.userId, 'Mouza change approved', `Your mouzas were updated.${added.length ? ` Added: ${added.join(', ')}.` : ''}${removed.length ? ` Removed: ${removed.join(', ')}.` : ''}${fee > 0 ? ` Fee: ${rs(fee)}.` : ''}`);
    if (sa) notifyAdmins({ type: 'profile', title: `[${sa.userId}] approved a mouza change`, message: `${u.userId}: +${added.length} / −${removed.length}${fee ? `, fee ${rs(fee)} billed` : ''}.` }).catch(() => {});
    return res.json({ message: `Approved.${fee > 0 ? ` Fee ${rs(fee)} recorded${u.managedBy ? ' on the bill' : ''}.` : ''}`, request: claimed });
}

exports.approve = async (req, res) => {
    try {
        const { r, u, sa } = await loadForDecision(req, ['pending']);
        if (r.expiresAt < new Date()) { r.status = 'expired'; await r.save(); throw bad('This request has expired.', 410); }
        if (!(await invoicesEnabled())) return await approveDirect(req, res, { r, u, sa });
        const b = req.body || {};
        const decisionNote = String(b.note || '').trim().slice(0, 500);
        const feeReduction = wholeRs(b.feeReduction, 'the fee reduction');
        const added = flat(r.toAdd), removed = flat(r.toRemove);
        const trial = isTrialPlan(u.subscriptionType);
        const now = new Date();

        let monthlyPrice = 0, mouzaFee = 0, planFee = 0, amount = 0, plan = u.subscriptionType, newFee;
        const daysLeft = daysLeftOf(u, now);
        if (added.length) {
            monthlyPrice = wholeRs(b.monthlyPrice, 'the monthly price of the added mouzas', { required: true });
            if (trial) {
                plan = b.plan === 'Yearly' ? 'Yearly' : 'Monthly';
                planFee = wholeRs(b.planFee, 'the subscription fee', { required: true });
                mouzaFee = plan === 'Yearly' ? monthlyPrice * 12 : monthlyPrice;
                amount = roundUp50(planFee + mouzaFee);
                newFee = Math.max(0, planFee + mouzaFee - feeReduction);
            } else {
                mouzaFee = monthlyPrice * daysLeft / 30;
                amount = roundUp50(mouzaFee);
                const perPeriod = u.subscriptionType === 'Yearly' ? monthlyPrice * 12 : monthlyPrice;
                newFee = Math.max(0, (u.fee || 0) + perPeriod - feeReduction);
            }
        } else {
            newFee = Math.max(0, (u.fee || 0) - feeReduction);
        }

        // Nothing to pay: apply straight away.
        if (amount === 0 && !(trial && added.length)) {
            const claimed = await AssignmentRequest.findOneAndUpdate({ _id: r._id, status: 'pending' },
                { $set: { status: 'approved', fee: 0, decisionNote, decidedBy: req.user.userId, decidedAt: now, invoice: { feeReduction, newFee, monthlyPrice, daysLeft } } }, { new: true });
            if (!claimed) throw bad('This request was just decided.', 409);
            const before = snapshotUser(u);
            const oldFee = u.fee || 0;
            await applyMouzas(u, r);
            u.fee = newFee;
            await u.save();
            await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_CHANGED', before: { tehsilAccess: before.tehsilAccess, fee: oldFee }, after: { tehsilAccess: snapshotUser(u).tehsilAccess, added, removed, requestId: r._id, fee: newFee } }, req);
            await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUEST_DECIDED', after: { requestId: r._id, status: 'approved', fee: 0, feeReduction, newFee }, note: decisionNote || undefined }, req);
            await RenewalToken.deleteMany({ requestId: r._id });
            completeActions('assignment', r._id);
            tell(u.userId, 'Mouza change approved', `Your mouzas were updated.${added.length ? ` Added: ${added.join(', ')}.` : ''}${removed.length ? ` Removed: ${removed.join(', ')}.` : ''}${newFee !== oldFee ? ` Subscription fee from your next renewal: ${rs(newFee)}.` : ''}`);
            if (sa) notifyAdmins({ type: 'profile', title: `[${sa.userId}] approved a mouza change`, message: `${u.userId}: +${added.length} / −${removed.length}, no charge${newFee !== oldFee ? `, fee now ${rs(newFee)}` : ''}.` }).catch(() => {});
            return res.json({ message: `Approved and applied (no charge).${newFee !== oldFee ? ` Subscription fee is now ${rs(newFee)}.` : ''}`, request: claimed });
        }

        // Additions with a charge: issue the invoice; mouzas wait for the payment.
        const invoice = {
            number: invoiceNumber(r), monthlyPrice, daysLeft, mouzaFee: Math.round(mouzaFee), trial, plan, planFee, amount, newFee, feeReduction,
            dueAt: new Date(now.getTime() + INVOICE_DAYS * 86400e3), issuedBy: req.user.userId, issuedAt: now
        };
        const claimed = await AssignmentRequest.findOneAndUpdate({ _id: r._id, status: 'pending' },
            { $set: { status: 'invoiced', fee: amount, decisionNote, invoice } }, { new: true });
        if (!claimed) throw bad('This request was just decided.', 409);
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUEST_DECIDED', after: { requestId: r._id, status: 'invoiced', invoice }, note: decisionNote || undefined }, req);

        const provider = await require('../services/providerService').getProviderForUser(u);
        const pay = provider?.paymentDetails || provider || {};
        const breakdown = trial
            ? `${plan} subscription ${rs(planFee)} + added mouzas ${rs(mouzaFee)}`
            : `${rs(monthlyPrice)}/month × ${daysLeft} day(s) left ÷ 30`;
        const invoiceText = [
            `*Invoice ${invoice.number}*`,
            `User ID: *${u.userId}*`,
            '',
            `Add ${added.length} mouza(s)${removed.length ? `, remove ${removed.length}` : ''}`,
            `Amount: *${rs(amount)}* (${breakdown}, rounded up to Rs 50)`,
            trial ? `Your ${plan} plan starts when the payment is confirmed.` : '',
            `Subscription fee from your next renewal: *${rs(newFee)}*`,
            `Pay by: *${invoice.dueAt.toLocaleDateString('en-GB')}*`,
            pay.easypaisa?.number ? `Easypaisa: ${pay.easypaisa.number} ${pay.easypaisa.title || ''}` : '',
            pay.jazzcash?.number ? `JazzCash: ${pay.jazzcash.number} ${pay.jazzcash.title || ''}` : '',
            '',
            'The mouzas are added after the payment is confirmed. Please send the payment screenshot.'
        ].filter(Boolean).join('\n');
        sendNotification(u.userId, { type: 'subscription', title: `Invoice ${invoice.number}: ${rs(amount)}`, message: `Pay ${rs(amount)} by ${invoice.dueAt.toLocaleDateString('en-GB')} to add ${added.length} mouza(s).`, details: { kind: 'invoice', ...invoice, added, removed } }).catch(() => {});
        if (sa) notifyAdmins({ type: 'profile', title: `[${sa.userId}] invoiced a mouza change`, message: `${u.userId}: +${added.length} / −${removed.length}, invoice ${rs(amount)}.` }).catch(() => {});
        res.json({ message: `Invoice ${invoice.number} for ${rs(amount)} sent to the customer. The mouzas are added when you confirm the payment.`, request: claimed, invoiceText });
    } catch (err) { fail(res, err); }
};

/** Payment received: apply the mouzas, record the money, set the new fee (trial → paid plan). */
exports.confirmPayment = async (req, res) => {
    try {
        const { r, u, sa } = await loadForDecision(req, ['invoiced']);
        const inv = r.invoice || {};
        const paymentRef = String(req.body?.paymentRef || '').trim().slice(0, 200);
        const now = new Date();
        const claimed = await AssignmentRequest.findOneAndUpdate({ _id: r._id, status: 'invoiced' },
            { $set: { status: 'approved', decidedBy: req.user.userId, decidedAt: now, 'invoice.paidAt': now, 'invoice.paymentRef': paymentRef, 'invoice.confirmedBy': req.user.userId } }, { new: true });
        if (!claimed) throw bad('This invoice was just confirmed.', 409);

        const before = snapshotUser(u);
        const previous = { plan: u.subscriptionType, start: u.startDate, end: u.endDate, fee: u.fee || 0 };
        await applyMouzas(u, r);
        if (inv.trial) { u.subscriptionType = inv.plan; u.startDate = now; }
        u.fee = inv.newFee;
        await u.save();                                   // save hook sets endDate/status for a new plan

        const added = flat(r.toAdd), removed = flat(r.toRemove);
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_CHANGED', before: { tehsilAccess: before.tehsilAccess, fee: previous.fee }, after: { tehsilAccess: snapshotUser(u).tehsilAccess, added, removed, requestId: r._id, fee: u.fee } }, req);
        if (inv.trial) {
            // Trial → paid plan: the subscription part is a renewal, the rest is the mouza top-up.
            const planPart = Math.min(inv.amount, inv.planFee || 0);
            await recordMoney(req, u, sa, {
                type: 'RENEWED', amount: planPart, note: `${inv.plan} from trial (invoice ${inv.number})`, requestKey: `assign-inv-plan:${r._id}`,
                extra: { previousPlan: previous.plan, periodStart: u.startDate, periodEnd: u.endDate, previousPeriodStart: previous.start, previousPeriodEnd: previous.end }
            });
            await recordMoney(req, u, sa, { type: 'ASSIGNMENT_TOPUP', amount: inv.amount - planPart, note: `mouza change +${added.length} (invoice ${inv.number})`, requestKey: `assign-req:${r._id}` });
        } else {
            await recordMoney(req, u, sa, { type: 'ASSIGNMENT_TOPUP', amount: inv.amount, note: `mouza change +${added.length} / −${removed.length}, ${inv.daysLeft}d left (invoice ${inv.number})`, requestKey: `assign-req:${r._id}` });
        }
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUEST_DECIDED', after: { requestId: r._id, status: 'paid', amount: inv.amount, paymentRef }, note: `invoice ${inv.number} paid` }, req);
        await RenewalToken.deleteMany({ requestId: r._id });
        completeActions('assignment', r._id);

        tell(u.userId, 'Payment received: mouzas updated', `Invoice ${inv.number} (${rs(inv.amount)}) is paid.${added.length ? ` Added: ${added.join(', ')}.` : ''}${removed.length ? ` Removed: ${removed.join(', ')}.` : ''}${inv.trial ? ` Your ${inv.plan} plan is active until ${new Date(u.endDate).toLocaleDateString('en-GB')}.` : ''} Subscription fee from your next renewal: ${rs(u.fee)}.`);
        if (sa) notifyAdmins({ type: 'profile', title: `[${sa.userId}] confirmed a mouza invoice`, message: `${u.userId}: invoice ${inv.number}, ${rs(inv.amount)} billed.` }).catch(() => {});
        res.json({ message: `Payment confirmed. Mouzas updated; ${rs(inv.amount)} recorded${u.managedBy ? ' on the bill' : ''}. New subscription fee ${rs(u.fee)}.`, request: claimed });
    } catch (err) { fail(res, err); }
};

exports.reject = async (req, res) => {
    try {
        const r = await AssignmentRequest.findById(req.params.id);
        if (!r) throw bad('Request not found', 404);
        if (!['pending', 'invoiced'].includes(r.status)) throw bad(`This request is already ${r.status}.`, 409);
        const u = await User.findOne({ userId: r.userId }).select('userId managedBy').lean();
        if (!u) throw bad('User not found', 404);
        await assertCanDecide(req, u);
        const reason = String(req.body?.reason || '').trim().slice(0, 500);
        r.status = 'rejected'; r.decisionNote = reason; r.decidedBy = req.user.userId; r.decidedAt = new Date();
        await r.save();
        await RenewalToken.deleteMany({ requestId: r._id });
        completeActions('assignment', r._id);
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy || null, type: 'ASSIGNMENT_REQUEST_DECIDED', after: { requestId: r._id, status: 'rejected' }, note: reason || undefined }, req);
        tell(u.userId, 'Mouza change not approved', `Your mouza change request was not approved.${reason ? ` Reason: ${reason}` : ''}`);
        res.json({ message: 'Request rejected.' });
    } catch (err) { fail(res, err); }
};
