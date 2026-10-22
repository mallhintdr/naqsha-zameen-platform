const mongoose = require('mongoose');

/**
 * Sub-admin profile. The login account is a normal User document with
 * userType 'subadmin'; this holds everything about running a reseller
 * account: territory, limits, billing settings, payment details shown to
 * their customers, and the unpaid-bills state machine.
 */
const subAdminSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    status: {
        type: String,
        enum: ['awaiting_activation', 'active', 'final_warning', 'suspended_unpaid', 'disabled'],
        default: 'awaiting_activation'
    },
    territory: { type: [String], default: [] },          // canonical tehsil names

    allowedPlans: { type: [String], default: ['Trial24', 'Monthly', 'Yearly'] },
    trialQuotaPerMonth: { type: Number, default: 30 },
    trialMaxMouzas: { type: Number, default: 2 },
    priceOverride: {
        type: [{ tierKey: String, monthly: Number, yearly: Number, _id: false }],
        default: []
    },

    // Unpaid bills (§16)
    unpaidThreshold: { type: Number, default: 10000 },
    paymentWindowDays: { type: Number, default: 3 },
    finalWarningHours: { type: Number, default: 48 },
    finalWarning: {
        issuedAt: Date,
        deadline: Date,
        amountAtIssue: Number
    },
    suspendedAt: Date,
    // One-time correction of "money owed" by the admin (set once, never cleared).
    balanceCorrection: {
        at: Date,
        by: String,
        from: Number,
        to: Number,
        reason: String
    },

    billEmail: String,
    paymentDetails: {
        jazzcash: { title: String, number: String },
        easypaisa: { title: String, number: String },
        phone: String,
        whatsapp: String,
        bank: { name: String, title: String, iban: String },
        lockedByAdmin: { type: Boolean, default: false },
        updatedAt: Date
    },
    policy: { version: String, acceptedAt: Date, acceptedIp: String },

    appointedBy: String,
    appointedAt: { type: Date, default: Date.now },
    activatedAt: Date,
    disabledBy: String,
    disabledAt: Date,
    disabledReason: String,
    notes: String
}, { timestamps: true });

subAdminSchema.index({ status: 1 });
subAdminSchema.index({ territory: 1 });

module.exports = mongoose.model('SubAdmin', subAdminSchema);
