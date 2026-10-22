const mongoose = require('mongoose');

/**
 * Payments received from sub-admins, recorded by the admin in Rs.
 * A mistake can be reversed (negative amount pointing at the original) or the
 * payment edited by the admin; every edit is kept in `edits` and also written
 * to the account history as PAYMENT_EDITED.
 */
const subAdminPaymentSchema = new mongoose.Schema({
    subAdminId: { type: String, required: true },
    amount: { type: Number, required: true },       // Rs; negative for a reversal
    receivedAt: { type: Date, default: Date.now },
    method: { type: String, enum: ['jazzcash', 'easypaisa', 'bank', 'cash', 'reversal'], required: true },
    reference: String,
    note: String,
    recordedBy: String,
    reversesPaymentId: mongoose.Schema.Types.ObjectId,
    reversedByPaymentId: mongoose.Schema.Types.ObjectId,
    edits: [{
        at: Date, by: String, reason: String,
        before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed
    }],
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

subAdminPaymentSchema.index({ subAdminId: 1, createdAt: -1 });
subAdminPaymentSchema.index({ reference: 1 }, { sparse: true });

module.exports = mongoose.model('SubAdminPayment', subAdminPaymentSchema);
