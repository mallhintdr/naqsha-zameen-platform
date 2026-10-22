/**
 * Scheduled work for the sub-admin program (§28). Each job is idempotent:
 * running it twice, or late, produces the same result.
 *
 *   closeBills      00:00 PKT  close yesterday's lines into bills (+ catch-up for the last 7 days)
 *   dailyEmails     00:10 PKT  bill PDF + operations summary to each sub-admin
 *   reminders       10:00 PKT  unpaid-bill reminders (wording escalates once overdue, and after 7 days)
 *   creditChecks    hourly     final warning at Rs 10,000 overdue → suspension after 48 h → restore on payment
 */
const SubAdmin = require('../models/SubAdmin');
const SubAdminBill = require('../models/SubAdminBill');
const AccountEvent = require('../models/AccountEvent');
const User = require('../models/User');
const logger = require('../utils/logger');
const billing = require('./subAdminBilling');
const emails = require('./subAdminEmails');

const DAY_MS = 24 * 60 * 60 * 1000;
const yesterday = (now = new Date()) => billing.pkDay(new Date(now.getTime() - DAY_MS));

async function closeBills(now = new Date()) {
    let created = 0;
    for (let i = 7; i >= 1; i--) {
        const day = billing.pkDay(new Date(now.getTime() - i * DAY_MS));
        created += (await billing.closeBillsForDay(day, now)).length;
    }
    if (created) logger.info(`Sub-admin billing: closed ${created} bill(s)`);
    return created;
}

const LABELS = {
    USER_CREATED: 'Customers created',
    ACTIVATED: 'Activations',
    RENEWED: 'Renewals',
    TIER_UPGRADED: 'Upgrades',
    ASSIGNMENT_CHANGED: 'Mouza changes',
    PROFILE_EDITED: 'Profile edits',
    SUSPENDED: 'Suspensions',
    REACTIVATED: 'Reactivations',
    CORRECTION_APPROVED: 'Corrections approved',
    TRANSFERRED: 'Customers assigned to you'
};

function billHtml({ sa, user, bill, lines, pos, ops, awaiting, trialsEnding, day, logoBase64, adminPay }) {
    const { esc, money } = emails;
    const rows = lines.map(l => `<tr><td>${new Date(l.at).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(l.userId)}</td><td>${esc(l.type === 'TIER_UPGRADED' ? 'Upgrade' : l.type === 'CORRECTION_APPROVED' ? 'Correction credit' : l.type === 'ACTIVATED' ? 'Activation' : 'Renewal')} · ${esc(l.plan || '')}${l.tier ? ' · ' + esc(l.tier) : ''}</td><td style="text-align:right">${money(l.amount)}</td></tr>`).join('');
    const opsRows = Object.entries(ops).map(([k, v]) => `<tr><td>${esc(LABELS[k] || k)}</td><td style="text-align:right">${v}</td></tr>`).join('') || '<tr><td colspan="2">No activity.</td></tr>';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;color:#1e293b;font-size:12px;margin:0}
      .wrap{padding:24px 28px} h1{font-size:18px;margin:0 0 4px;color:#12293f} h2{font-size:13px;margin:18px 0 6px;color:#1b3a5c;text-transform:uppercase;letter-spacing:.04em}
      table{width:100%;border-collapse:collapse} th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left} th{background:#1b3a5c;color:#fff;font-size:11px}
      .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #8dc63f;padding-bottom:10px;margin-bottom:14px}
      .tot td{font-weight:bold;border-top:2px solid #1b3a5c} .muted{color:#64748b}
      .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin-top:8px}
    </style></head><body><div class="wrap">
      <div class="head">
        ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" style="height:46px">` : '<div></div>'}
        <div style="text-align:right"><h1>Daily bill — ${esc(day)}</h1>
          <div class="muted">${esc(user?.userName || sa.userId)} (${esc(sa.userId)})${bill ? ` · Bill ${esc(sa.userId)}-${esc(day)}` : ''}</div>
          ${bill ? `<div class="muted">Payable by ${new Date(bill.dueAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })}</div>` : ''}</div>
      </div>
      <h2>Bill lines</h2>
      ${lines.length ? `<table><thead><tr><th>Time</th><th>Customer</th><th>Action</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}
        <tr class="tot"><td colspan="3">Total for ${esc(day)}</td><td style="text-align:right">${money(bill?.total || 0)}</td></tr></tbody></table>`
        : '<p class="muted">No billable actions on this day.</p>'}
      <div class="box">
        <div>Total owed now: <strong>${money(pos.balance)}</strong></div>
        <div>Overdue: <strong>${money(pos.overdue)}</strong>${pos.advanceCredit ? ` · Advance credit: ${money(pos.advanceCredit)}` : ''}</div>
      </div>
      <h2>Your operations on ${esc(day)}</h2>
      <table><tbody>${opsRows}</tbody></table>
      <p>Customers awaiting activation: <strong>${awaiting}</strong> · Trials ending in the next 24 hours: <strong>${trialsEnding}</strong></p>
      <h2>How to pay</h2>
      <p>JazzCash ${esc(adminPay.jazzcash?.number || '')} (${esc(adminPay.jazzcash?.title || '')}) · EasyPaisa ${esc(adminPay.easypaisa?.number || '')} (${esc(adminPay.easypaisa?.title || '')})</p>
      <p class="muted">Please send your payment reference to the admin. Overdue bills of ${money(sa.unpaidThreshold)} or more lead to a final warning and, if unpaid after ${sa.finalWarningHours} hours, suspension until payment. Your customers are never affected.</p>
    </div></body></html>`;
}

async function dailyEmails(now = new Date(), { day = yesterday(now) } = {}) {
    const { renderHtmlToPdf } = require('./pdfReportService');
    const { loadLogoBuffer } = require('../utils/logoPath');
    const { getAdminPaymentDetails } = require('./providerService');
    const dayStart = billing.pkDayStart(day);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const logo = await loadLogoBuffer().catch(() => null);
    const logoBase64 = logo ? logo.toString('base64') : '';
    const adminPay = await getAdminPaymentDetails();
    await billing.closeBillsForDay(day, now);          // in case the close job hasn't run yet
    let sent = 0;

    const subs = await SubAdmin.find({ status: { $nin: ['disabled', 'awaiting_activation'] } });
    for (const sa of subs) {
        try {
            const bill = await SubAdminBill.findOne({ subAdminId: sa.userId, day });
            if (bill?.emailedAt) continue;
            const opsAgg = await AccountEvent.aggregate([
                { $match: { ownerAtEvent: sa.userId, actorRole: { $in: ['subadmin', 'user', 'admin'] }, createdAt: { $gte: dayStart, $lt: dayEnd }, type: { $in: Object.keys(LABELS) } } },
                { $group: { _id: '$type', n: { $sum: 1 } } }
            ]);
            const ops = Object.fromEntries(opsAgg.map(o => [o._id, o.n]));
            const pos = await billing.computePosition(sa, now);
            if (!bill && !Object.keys(ops).length && pos.balance <= 0) continue;          // nothing to say

            const [user, awaiting, trialsEnding] = await Promise.all([
                User.findOne({ userId: sa.userId }).select('userName email').lean(),
                User.countDocuments({ managedBy: sa.userId, status: 'AwaitingActivation' }),
                User.countDocuments({ managedBy: sa.userId, subscriptionType: 'Trial24', endDate: { $gt: now, $lte: new Date(now.getTime() + DAY_MS) } })
            ]);
            const to = sa.billEmail || user?.email;
            if (!to) continue;
            const lines = bill ? await billing.billLines(sa.userId, day) : [];
            const html = billHtml({ sa, user, bill, lines, pos, ops, awaiting, trialsEnding, day, logoBase64, adminPay });

            let attachments = [];
            try {
                const pdf = await renderHtmlToPdf(html);
                attachments = [{ filename: `bill-${sa.userId}-${day}.pdf`, content: pdf, contentType: 'application/pdf' }];
            } catch (e) {
                logger.warn('Sub-admin bill PDF failed; sending HTML only', { subAdmin: sa.userId, error: e.message });
            }
            const subject = bill ? `Your daily bill for ${day}: ${emails.money(bill.total)} (total owed ${emails.money(pos.balance)})` : `Your daily summary for ${day}`;
            const ok = await emails.safeSend({ to, subject, html, attachments }, 'daily bill');
            if (ok && bill) { bill.emailedAt = new Date(); await bill.save(); }
            if (ok) sent++;
        } catch (e) {
            logger.error('Sub-admin daily email failed', { subAdmin: sa.userId, error: e.message });
        }
    }
    if (sent) logger.info(`Sub-admin billing: sent ${sent} daily email(s) for ${day}`);
    return sent;
}

async function reminders(now = new Date()) {
    const { sendNotification } = require('../utils/notificationUtils');
    const subs = await SubAdmin.find({ status: { $nin: ['disabled', 'awaiting_activation'] } });
    let n = 0;
    for (const sa of subs) {
        const pos = await billing.computePosition(sa, now);
        const owed = pos.closedBalance;
        if (owed <= 0) continue;
        const oldest = pos.oldestUnpaid;
        const overdueDays = oldest?.dueAt ? Math.floor((now - new Date(oldest.dueAt)) / DAY_MS) : -1;
        let title = 'Payment reminder';
        let message = `You owe ${emails.money(owed)}. Oldest unpaid bill: ${oldest?.day}, payable by ${oldest?.dueAt ? new Date(oldest.dueAt).toLocaleDateString('en-PK') : '—'}.`;
        if (pos.overdue > 0) {
            title = overdueDays >= 7 ? 'Overdue for more than a week' : 'Bill overdue';
            message = `Overdue: ${emails.money(pos.overdue)} (total owed ${emails.money(owed)}). Please pay as soon as possible. At ${emails.money(sa.unpaidThreshold)} overdue a final warning is sent, and suspension follows ${sa.finalWarningHours} hours later.`;
        }
        await sendNotification(sa.userId, { type: pos.overdue > 0 ? 'alert' : 'subscription', title, message }).catch(() => {});
        const user = await User.findOne({ userId: sa.userId }).select('email userName').lean();
        const to = sa.billEmail || user?.email;
        if (to) await emails.safeSend({ to, subject: title, html: emails.shell(title, `<p>Hello <strong>${emails.esc(user?.userName || sa.userId)}</strong>,</p><p>${emails.esc(message)}</p>`) }, 'reminder');
        n++;
    }
    return n;
}

async function creditChecks(now = new Date()) {
    const subs = await SubAdmin.find({ status: { $in: ['active', 'final_warning', 'suspended_unpaid'] } });
    for (const sa of subs) {
        try { await billing.checkCredit(sa, now); } catch (e) { logger.error('credit check failed', { subAdmin: sa.userId, error: e.message }); }
    }
    return subs.length;
}

/**
 * In-memory scheduler used when BullMQ/Redis is off: checks the Pakistan
 * clock every minute and runs each job at most once per slot.
 */
function startFallbackScheduler() {
    const ran = new Set();
    const tick = async () => {
        const now = new Date();
        const pk = new Date(now.getTime() + 5 * 3600e3);
        const hh = pk.getUTCHours(), mm = pk.getUTCMinutes();
        const day = billing.pkDay(now);
        const slot = (name, key) => { const k = `${name}:${key}`; if (ran.has(k)) return false; ran.add(k); return true; };
        try {
            if (hh === 0 && mm >= 0 && slot('close', day)) await closeBills(now);
            if (hh === 0 && mm >= 10 && slot('emails', day)) await dailyEmails(now);
            if (hh === 10 && slot('reminders', day)) await reminders(now);
            if (mm >= 5 && slot('credit', `${day}T${hh}`)) await creditChecks(now);
        } catch (e) {
            logger.error('Sub-admin fallback scheduler error', { error: e.message });
        }
        if (ran.size > 500) ran.clear();
    };
    setInterval(tick, 60 * 1000);
    logger.info('Sub-admin billing: in-memory scheduler started (BullMQ not active)');
}

module.exports = { closeBills, dailyEmails, reminders, creditChecks, billHtml, startFallbackScheduler };
