const mongoose = require('mongoose');

/**
 * Permanent, append-only history of everything that happens to a user
 * account: creation, activation, renewals, plan and access changes, profile
 * edits, suspensions, transfers, deletions and corrections. Never updated or
 * deleted, including when the user itself is deleted. Revenue figures across
 * the app are read from here (type RENEWED / TIER_UPGRADED with paymentAmount).
 */
const EVENT_TYPES = [
    'USER_CREATED',
    'ACTIVATION_SENT',
    'ACTIVATION_RESENT',
    'ACTIVATED',
    'RENEWED',
    'TIER_UPGRADED',
    'PLAN_CHANGED',
    'ASSIGNMENT_CHANGED',
    'PROFILE_EDITED',
    'EMAIL_CHANGE_REQUESTED',
    'EMAIL_CHANGED',
    'SUSPENDED',
    'REACTIVATED',
    'TRANSFERRED',
    'DELETED',
    'CORRECTION_APPROVED',
    'MOUZA_REQUEST_APPROVED',
    'PAYMENT_DETAILS_CHANGED',
    'PRICING_CHANGED',
    'BALANCE_ADJUSTED',         // admin correction of a sub-admin's money owed
    'PAYMENT_EDITED',           // admin edited a recorded sub-admin payment (audit record)
    'BILL_LINE_EDITED',         // admin edited the billed amount of a line (audit record)
    'ASSIGNMENT_REQUESTED',     // customer asked for a mouza change
    'ASSIGNMENT_REQUEST_DECIDED', // provider approved / rejected it
    'ASSIGNMENT_TOPUP',         // fee for an approved mouza change (billable for sub-admins)
    'TRIAL_GIVEN'               // free 24h trial given to an existing customer (not billed, no revenue)
];

const accountEventSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    ownerAtEvent: { type: String, default: null },   // managedBy at the time (null = admin)
    actorId: { type: String, default: null },
    actorRole: { type: String, enum: ['admin', 'subadmin', 'user', 'system'], default: 'system' },
    type: { type: String, enum: EVENT_TYPES, required: true },

    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },

    // Subscription / money details (renewals, activations, upgrades)
    plan: String,
    previousPlan: String,
    tier: String,
    periodStart: Date,
    periodEnd: Date,
    previousPeriodStart: Date,
    previousPeriodEnd: Date,
    paymentAmount: { type: Number, default: 0 },     // what the customer paid you (direct revenue); null = not recorded (old data)
    // Old renewals often have no recorded amount. The Renewals tab has always
    // shown the user's fee in that case; kept separately so recorded and
    // estimated revenue are never mixed silently.
    estimatedAmount: Number,
    customerFee: Number,                             // what a sub-admin reports charging
    platformPrice: Number,                           // what a sub-admin is billed
    billable: { type: Boolean, default: false },
    billDay: String,                                 // 'YYYY-MM-DD' PKT
    billId: mongoose.Schema.Types.ObjectId,
    pricingVersion: Number,
    reversesEventId: mongoose.Schema.Types.ObjectId,

    requestKey: { type: String },
    source: { type: String, enum: ['live', 'migrated'], default: 'live' },
    ip: String,
    note: String,
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

accountEventSchema.index({ userId: 1, createdAt: -1 });
accountEventSchema.index({ ownerAtEvent: 1, createdAt: -1 });
accountEventSchema.index({ type: 1, createdAt: -1 });
accountEventSchema.index({ ownerAtEvent: 1, billable: 1, billDay: 1 });
accountEventSchema.index({ requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });

// Append-only: block updates and deletes at the model level.
const blockMutation = function (next) {
    next(new Error('AccountEvent is append-only'));
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']
    .forEach(op => accountEventSchema.pre(op, blockMutation));

module.exports = mongoose.model('AccountEvent', accountEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
