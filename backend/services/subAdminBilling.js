/**
 * Sub-admin billing (§15–17).
 *
 * Bill lines are AccountEvent documents with billable: true, billed to the
 * sub-admin in ownerAtEvent, for the Pakistan calendar day in billDay.
 * At midnight a day's lines close into one SubAdminBill. Payments settle the
 * oldest bills first. Only OVERDUE bills (past their payment window) count
 * toward the final warning, so a single large sale is treated like any other.
 */
const AccountEvent = require('../models/AccountEvent');
const SubAdmin = require('../models/SubAdmin');
const SubAdminBill = require('../models/SubAdminBill');
const SubAdminPayment = require('../models/SubAdminPayment');
const User = require('../models/User');
const logger = require('../utils/logger');

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of the Pakistan calendar day containing `date`. */
const pkDay = (date = new Date()) => new Date(new Date(date).getTime() + OFFSET_MS).toISOString().slice(0, 10);
/** UTC instant of 00:00 PKT on a 'YYYY-MM-DD' day. */
const pkDayStart = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() - OFFSET_MS);

const notify = (userId, payload) => {
    const { sendNotification } = require('../utils/notificationUtils');
    return sendNotification(userId, payload).catch(e => logger.error('sub-admin notify failed', { error: e.message }));
};
const notifyAdmin = (payload) => {
    const { notifyAdmins } = require('../utils/notificationUtils');
    return notifyAdmins(payload).catch(e => logger.error('admin notify failed', { error: e.message }));
};

/** Today's running total (lines not yet closed into a bill). */
async function todayTotal(subAdminId, now = new Date()) {
    const day = pkDay(now);
    const r = await AccountEvent.aggregate([
        { $match: { ownerAtEvent: subAdminId, billable: true, billDay: day } },
        { $group: { _id: null, total: { $sum: '$platformPrice' }, count: { $sum: 1 } } }
    ]);
    return { day, total: r[0]?.total || 0, count: r[0]?.count || 0 };
}

/** In-app notice to the sub-admin for every bill line as it's added (§15.1). */
async function announceLine(subAdminId, { amount, userId, label }) {
    const t = await todayTotal(subAdminId);
    const sign = amount < 0 ? '−' : '';
    return notify(subAdminId, {
        type: 'subscription',
        title: amount < 0 ? 'Credit added to today\'s bill' : 'Added to today\'s bill',
        message: `${sign}Rs ${Math.abs(amount).toLocaleString('en-PK')} — ${userId}, ${label}. Today's total: Rs ${t.total.toLocaleString('en-PK')}.`
    });
}

function computePositionFromData(bills, paidTotal, today, now) {
    let available = paidTotal || 0;
    // Bills with a negative total (net credits) add to what's available.
    for (const b of bills) if (b.total < 0) available += -b.total;

    let overdue = 0, dueNotOverdue = 0, oldestUnpaid = null;
    const allocations = [];
    for (const b of bills) {
        if (b.total <= 0) { allocations.push({ bill: b, paid: 0, unpaid: 0 }); continue; }
        const paid = Math.min(b.total, Math.max(0, available));
        available -= paid;
        const unpaid = b.total - paid;
        allocations.push({ bill: b, paid, unpaid });
        if (unpaid > 0) {
            if (!oldestUnpaid) oldestUnpaid = b;
            if (b.dueAt && new Date(b.dueAt) <= now) overdue += unpaid;
            else dueNotOverdue += unpaid;
        }
    }
    const billedTotal = bills.reduce((a, b) => a + b.total, 0);
    return {
        billedTotal,
        paidTotal: paidTotal || 0,
        balance: billedTotal - (paidTotal || 0) + today.total,   // incl. today's open lines
        closedBalance: billedTotal - (paidTotal || 0),
        advanceCredit: Math.max(0, available),
        overdue,
        dueNotOverdue,
        today,
        oldestUnpaid: oldestUnpaid ? { day: oldestUnpaid.day, dueAt: oldestUnpaid.dueAt } : null,
        allocations
    };
}

/**
 * Settles payments against bills oldest-first and returns the full position.
 * Pure calculation over the ledger; nothing is stored here.
 */
async function computePosition(subAdmin, now = new Date()) {
    const subAdminId = subAdmin.userId;
    const [bills, payments, today] = await Promise.all([
        SubAdminBill.find({ subAdminId }).sort({ day: 1 }).lean(),
        SubAdminPayment.aggregate([{ $match: { subAdminId } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        todayTotal(subAdminId, now)
    ]);
    return computePositionFromData(bills, payments[0]?.total || 0, today, now);
}

/**
 * Batched version of computePosition for an array of sub-admins (3 queries total instead of 3*N).
 */
async function computePositionsBulk(subAdmins, now = new Date()) {
    const ids = subAdmins.map(s => s.userId);
    if (ids.length === 0) return {};
    const day = pkDay(now);
    const [allBills, allPayments, allToday] = await Promise.all([
        SubAdminBill.find({ subAdminId: { $in: ids } }).sort({ day: 1 }).lean(),
        SubAdminPayment.aggregate([
            { $match: { subAdminId: { $in: ids } } },
            { $group: { _id: '$subAdminId', total: { $sum: '$amount' } } }
        ]),
        AccountEvent.aggregate([
            { $match: { ownerAtEvent: { $in: ids }, billable: true, billDay: day } },
            { $group: { _id: '$ownerAtEvent', total: { $sum: '$platformPrice' }, count: { $sum: 1 } } }
        ])
    ]);

    const billsBySub = new Map();
    for (const b of allBills) {
        if (!billsBySub.has(b.subAdminId)) billsBySub.set(b.subAdminId, []);
        billsBySub.get(b.subAdminId).push(b);
    }
    const paidBySub = new Map(allPayments.map(p => [p._id, p.total || 0]));
    const todayBySub = new Map(allToday.map(t => [t._id, { day, total: t.total || 0, count: t.count || 0 }]));

    const result = {};
    for (const id of ids) {
        result[id] = computePositionFromData(
            billsBySub.get(id) || [],
            paidBySub.get(id) || 0,
            todayBySub.get(id) || { day, total: 0, count: 0 },
            now
        );
    }
    return result;
}

/** Writes each bill's paidAmount/status from a fresh allocation. */
async function refreshBillStatuses(subAdmin, now = new Date()) {
    const pos = await computePosition(subAdmin, now);
    const ops = pos.allocations
        .filter(a => a.bill.total > 0)
        .map(a => {
            const status = a.unpaid <= 0 ? 'paid' : a.paid > 0 ? 'part_paid' : 'issued';
            if (a.bill.paidAmount === a.paid && a.bill.status === status) return null;
            return { updateOne: { filter: { _id: a.bill._id }, update: { $set: { paidAmount: a.paid, status } } } };
        })
        .filter(Boolean);
    if (ops.length) await SubAdminBill.bulkWrite(ops);
    return pos;
}

/**
 * Unpaid-bills state machine (§16). Safe to call any time: after payments,
 * after billable actions, and hourly.
 */
async function checkCredit(subAdminDoc, now = new Date()) {
    const subAdmin = subAdminDoc.toObject ? subAdminDoc : await SubAdmin.findById(subAdminDoc._id);
    if (!subAdmin || subAdmin.status === 'disabled' || subAdmin.status === 'awaiting_activation') return null;
    const pos = await refreshBillStatuses(subAdmin, now);
    const threshold = subAdmin.unpaidThreshold ?? 10000;
    const over = pos.overdue >= threshold;
    const name = subAdmin.userId;
    const rs = (n) => `Rs ${Number(n).toLocaleString('en-PK')}`;

    if (subAdmin.status === 'active' && over) {
        const deadline = new Date(now.getTime() + (subAdmin.finalWarningHours || 48) * 3600 * 1000);
        subAdmin.status = 'final_warning';
        subAdmin.finalWarning = { issuedAt: now, deadline, amountAtIssue: pos.overdue };
        await subAdmin.save();
        const msg = `Your overdue bills total ${rs(pos.overdue)}. Please pay by ${deadline.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} or your sub-admin account will be suspended. Your customers are not affected.`;
        await notify(name, { type: 'alert', title: 'Final warning: overdue bills', message: msg });
        await notifyAdmin({ type: 'alert', title: `Final warning sent to ${name}`, message: `Overdue ${rs(pos.overdue)}; deadline ${deadline.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}.` });
        await sendFinalWarningEmail(subAdmin, pos.overdue, deadline);
    } else if (subAdmin.status === 'final_warning' && !over) {
        subAdmin.status = 'active';
        subAdmin.finalWarning = undefined;
        await subAdmin.save();
        await notify(name, { type: 'info', title: 'Final warning cleared', message: 'Thank you — your overdue amount is below the limit again.' });
    } else if (subAdmin.status === 'final_warning' && over && subAdmin.finalWarning?.deadline && now >= new Date(subAdmin.finalWarning.deadline)) {
        subAdmin.status = 'suspended_unpaid';
        subAdmin.suspendedAt = now;
        await subAdmin.save();
        await notify(name, { type: 'alert', title: 'Sub-admin account suspended', message: `Suspended for overdue bills of ${rs(pos.overdue)}. You can still view your users and bills. Your account is restored as soon as a payment is recorded. Your customers are not affected.` });
        await notifyAdmin({ type: 'alert', title: `${name} suspended for unpaid bills`, message: `Overdue ${rs(pos.overdue)}.` });
    } else if (subAdmin.status === 'suspended_unpaid' && !over) {
        subAdmin.status = 'active';
        subAdmin.finalWarning = undefined;
        subAdmin.suspendedAt = undefined;
        await subAdmin.save();
        await notify(name, { type: 'activation', title: 'Sub-admin account restored', message: 'Your payment has been recorded and your account is active again.' });
        await notifyAdmin({ type: 'info', title: `${name} restored`, message: `Overdue amount is now ${rs(pos.overdue)}.` });
    }
    return pos;
}

async function sendFinalWarningEmail(subAdmin, overdue, deadline) {
    const { safeSend, shell, money } = require('./subAdminEmails');
    const user = await User.findOne({ userId: subAdmin.userId }).select('email userName').lean();
    const to = subAdmin.billEmail || user?.email;
    if (!to) return;
    await safeSend({
        to,
        subject: 'Final warning: overdue bills',
        html: shell('Final warning', `<p>Hello <strong>${user?.userName || subAdmin.userId}</strong>,</p>
          <p>Your overdue bills total <strong>${money(overdue)}</strong>. Please pay by <strong>${deadline.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</strong>.</p>
          <p>If it isn't paid by then, your sub-admin account will be suspended (view-only) until payment is recorded. Your customers are not affected.</p>`)
    }, 'final warning');
}

/**
 * Closes one Pakistan day's lines into bills (idempotent: one bill per
 * sub-admin per day, enforced by a unique index).
 */
async function closeBillsForDay(day, now = new Date()) {
    const groups = await AccountEvent.aggregate([
        { $match: { billable: true, billDay: day, ownerAtEvent: { $ne: null } } },
        { $group: {
            _id: '$ownerAtEvent',
            count: { $sum: 1 },
            linesTotal: { $sum: { $cond: [{ $gt: ['$platformPrice', 0] }, '$platformPrice', 0] } },
            creditsTotal: { $sum: { $cond: [{ $lt: ['$platformPrice', 0] }, '$platformPrice', 0] } }
        } }
    ]);
    const created = [];
    for (const g of groups) {
        const subAdmin = await SubAdmin.findOne({ userId: g._id }).lean();
        const windowDays = subAdmin?.paymentWindowDays ?? 3;
        const issuedAt = pkDayStart(day).getTime() + DAY_MS;               // 00:00 PKT after the day
        try {
            const bill = await SubAdminBill.create({
                subAdminId: g._id,
                day,
                lineCount: g.count,
                linesTotal: g.linesTotal,
                creditsTotal: g.creditsTotal,
                total: g.linesTotal + g.creditsTotal,
                issuedAt: new Date(Math.min(issuedAt, now.getTime() + 60000)),
                dueAt: new Date(issuedAt + windowDays * DAY_MS)
            });
            created.push(bill);
        } catch (e) {
            if (e.code !== 11000) throw e;                                  // already closed
        }
    }
    return created;
}

/**
 * Recomputes an already-closed day's bill from its lines (after a line's billed
 * amount was edited). Today's open lines have no bill yet, so nothing to do.
 */
async function recomputeBill(subAdminId, day) {
    const bill = await SubAdminBill.findOne({ subAdminId, day });
    if (!bill) return null;
    const [g] = await AccountEvent.aggregate([
        { $match: { ownerAtEvent: subAdminId, billable: true, billDay: day } },
        { $group: {
            _id: null,
            count: { $sum: 1 },
            linesTotal: { $sum: { $cond: [{ $gt: ['$platformPrice', 0] }, '$platformPrice', 0] } },
            creditsTotal: { $sum: { $cond: [{ $lt: ['$platformPrice', 0] }, '$platformPrice', 0] } }
        } }
    ]);
    bill.lineCount = g?.count || 0;
    bill.linesTotal = g?.linesTotal || 0;
    bill.creditsTotal = g?.creditsTotal || 0;
    bill.total = bill.linesTotal + bill.creditsTotal;
    await bill.save();
    return bill;
}

/** Lines of one bill (for the PDF / screens). */
async function billLines(subAdminId, day) {
    const lines = await AccountEvent.find({ ownerAtEvent: subAdminId, billable: true, billDay: day }).sort({ createdAt: 1 }).lean();
    return lines.map(l => ({
        at: l.createdAt,
        userId: l.userId,
        type: l.type,
        plan: l.plan,
        tier: l.tier,
        amount: l.platformPrice,
        note: l.note
    }));
}

module.exports = {
    pkDay, pkDayStart, todayTotal, announceLine, computePosition, computePositionsBulk, refreshBillStatuses,
    checkCredit, closeBillsForDay, billLines, recomputeBill
};
