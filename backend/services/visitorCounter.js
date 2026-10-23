/**
 * Visitor counting for the public website.
 *
 *  record(req, page)   count one page load (unique per visitor per day; repeats add views)
 *  summary(page)       visitors and page views for today, this week, 7 / 30 / 180 / 365 days,
 *                      plus a daily series (last 30 days) and a monthly series (12 months)
 */
const crypto = require('crypto');
const PageVisit = require('../models/PageVisit');
const { pkDay } = require('./subAdminBilling');

const COOKIE = 'nzv';
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|lighthouse|monitor/i;
const PAGE_RE = /^[a-z0-9_-]{1,40}$/;

function visitorId(req, res) {
    const fromCookie = String(req.cookies?.[COOKIE] || '');
    if (/^[a-f0-9]{32}$/.test(fromCookie)) return fromCookie;
    const id = crypto.randomBytes(16).toString('hex');
    try {
        // Shared by the website and the dashboard of the same domain, so they agree.
        const domain = require('../utils/siteConfig').cookieDomainForHost(req.hostname);
        res.cookie(COOKIE, id, { maxAge: 2 * 365 * 86400e3, httpOnly: true, sameSite: 'lax', secure: req.secure, domain });
    } catch (e) { /* ignore */ }
    // First visit: until the cookie comes back, the same IP + browser on the same day is one visitor.
    return crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}|${pkDay()}`).digest('hex').slice(0, 32);
}

async function record(req, res, page = 'home') {
    const ua = req.get('user-agent') || '';
    if (!ua || BOT_RE.test(ua)) return false;
    if (!PAGE_RE.test(page)) page = 'home';
    const vid = visitorId(req, res);
    const now = new Date();
    await PageVisit.updateOne(
        { page, day: pkDay(now), vid },
        {
            $inc: { views: 1 },
            $set: { lastAt: now },
            $setOnInsert: { firstAt: now, referrer: String(req.get('referer') || '').slice(0, 300), mobile: /Mobi|Android|iPhone/i.test(ua) }
        },
        { upsert: true }
    ).catch(e => { if (e.code !== 11000) throw e; });
    return true;
}

const dayMinus = (n) => pkDay(new Date(Date.now() - n * 86400e3));

async function windowCount(page, fromDay, toDay = pkDay()) {
    const [r] = await PageVisit.aggregate([
        { $match: { page, day: { $gte: fromDay, $lte: toDay } } },
        { $group: { _id: null, vids: { $addToSet: '$vid' }, views: { $sum: '$views' } } },
        { $project: { _id: 0, visitors: { $size: '$vids' }, views: 1 } }
    ]);
    return r || { visitors: 0, views: 0 };
}

async function summary(page = 'home') {
    const today = pkDay();
    // Week starts on Monday (PKT).
    const pkNow = new Date(Date.now() + 5 * 3600e3);
    const weekStart = dayMinus((pkNow.getUTCDay() + 6) % 7);
    const [t, w, d7, d30, d180, d365, all, daily, monthly] = await Promise.all([
        windowCount(page, today),
        windowCount(page, weekStart),
        windowCount(page, dayMinus(6)),
        windowCount(page, dayMinus(29)),
        windowCount(page, dayMinus(179)),
        windowCount(page, dayMinus(364)),
        windowCount(page, '0000-00-00'),
        PageVisit.aggregate([
            { $match: { page, day: { $gte: dayMinus(29) } } },
            { $group: { _id: '$day', visitors: { $sum: 1 }, views: { $sum: '$views' }, mobile: { $sum: { $cond: ['$mobile', 1, 0] } } } },
            { $sort: { _id: 1 } }
        ]),
        PageVisit.aggregate([
            { $match: { page, day: { $gte: dayMinus(364) } } },
            { $group: { _id: { $substr: ['$day', 0, 7] }, vids: { $addToSet: '$vid' }, views: { $sum: '$views' } } },
            { $project: { visitors: { $size: '$vids' }, views: 1 } },
            { $sort: { _id: 1 } }
        ])
    ]);
    // Fill missing days with zero so the chart has every day.
    const byDay = Object.fromEntries(daily.map(d => [d._id, d]));
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = dayMinus(i);
        days.push({ date: d, visitors: byDay[d]?.visitors || 0, views: byDay[d]?.views || 0, mobile: byDay[d]?.mobile || 0 });
    }
    return {
        page,
        windows: { today: t, week: w, d7, d30, d180, d365, all },
        daily: days,
        monthly: monthly.map(m => ({ month: m._id, visitors: m.visitors, views: m.views })),
        updatedAt: new Date()
    };
}

module.exports = { record, summary, COOKIE };
