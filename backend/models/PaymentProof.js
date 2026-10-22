const mongoose = require('mongoose');

/**
 * Optional evidence attached to a payment: a screenshot, the text of a payment
 * SMS, and/or a note. Kept separate from the payment and renewal records (which
 * are append-only) so any kind of payment can carry proof later.
 *
 * kind 'subadmin_payment' -> refId = SubAdminPayment._id, subAdminId set
 * kind 'renewal'          -> refId = AccountEvent._id of the RENEWED event (when found), userId set
 */
const paymentProofSchema = new mongoose.Schema({
    kind: { type: String, enum: ['subadmin_payment', 'renewal'], required: true },
    refId: { type: String, default: null },
    userId: { type: String, default: null },       // customer, for renewals
    subAdminId: { type: String, default: null },   // sub-admin the payment belongs to
    file: {
        path: String,      // relative to the proofs directory, e.g. 2026-09/abc123.jpg
        mime: String,
        size: Number
    },
    smsText: { type: String, maxlength: 2000 },
    note: { type: String, maxlength: 1000 },
    uploadedBy: String,
    uploaderRole: String,
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

paymentProofSchema.index({ kind: 1, refId: 1 });
paymentProofSchema.index({ userId: 1, createdAt: -1 });
paymentProofSchema.index({ subAdminId: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentProof', paymentProofSchema);
