const mongoose = require('mongoose');

/**
 * Website visitors (e.g. the www.naqsha-zameen.pk home page).
 * One document per visitor, per page, per day (Pakistan day); `views` counts
 * repeat loads that day. Unique visitors = distinct `vid` in a date range.
 */
const pageVisitSchema = new mongoose.Schema({
    day: { type: String, required: true },          // 'YYYY-MM-DD' (PKT)
    page: { type: String, required: true },         // e.g. 'home'
    vid: { type: String, required: true },          // visitor id (cookie, or hash of IP + browser)
    views: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    referrer: String,
    mobile: Boolean
}, { versionKey: false });

pageVisitSchema.index({ page: 1, day: 1, vid: 1 }, { unique: true });
pageVisitSchema.index({ day: 1 });

module.exports = mongoose.model('PageVisit', pageVisitSchema);
