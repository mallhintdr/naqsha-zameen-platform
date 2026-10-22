// One definition of a sub-admin "sale", shared by the admin's sub-admin list and
// the sub-admin dashboard (so their counts always agree): a paid activation or
// renewal of one of the sub-admin's customers, whoever saved it, and not later
// reversed by an approved correction.
const AccountEvent = require('../models/AccountEvent');

const SALE_TYPES = ['RENEWED', 'ACTIVATED'];
const NON_PAID_PLANS = [null, 'Trial', 'Trial24', 'Free', 'Permanent', 'trial', 'trial24', 'free', 'permanent'];

/** Mongo match for the sales of one sub-admin (string) or several (array). */
async function saleMatch(owners) {
    const ownerAtEvent = Array.isArray(owners) ? { $in: owners } : owners;
    const reversed = await AccountEvent.distinct('reversesEventId', { type: 'CORRECTION_APPROVED', ownerAtEvent });
    return {
        ownerAtEvent,
        type: { $in: SALE_TYPES },
        plan: { $nin: NON_PAID_PLANS },
        ...(reversed.length ? { _id: { $nin: reversed } } : {})
    };
}

/** Start of the current calendar month, Pakistan time. */
function pkMonthStart(now = new Date()) {
    const pk = new Date(now.getTime() + 5 * 3600e3);
    return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), 1) - 5 * 3600e3);
}

module.exports = { saleMatch, pkMonthStart, SALE_TYPES };
