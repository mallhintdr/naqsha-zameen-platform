const mongoose = require('mongoose');

/**
 * A customer's request to change their own mouzas (add / remove).
 * The customer only asks; nothing changes until their provider (the admin, or
 * the sub-admin who manages them) approves it and sets the fee for the change.
 * One open (pending) request per customer; a new request replaces the old one.
 */
const entrySchema = new mongoose.Schema({
    tehsil: { type: String, required: true },
    mouzas: { type: [String], default: [] }
}, { _id: false });

const assignmentRequestSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    ownerId: { type: String, default: null },         // managedBy at request time (null = admin)
    // pending → (invoiced → paid/applied) | approved (free / removals only) | rejected / cancelled / expired
    status: { type: String, enum: ['pending', 'invoiced', 'approved', 'rejected', 'cancelled', 'expired'], default: 'pending', index: true },
    // Invoice (mouzas are added only after the payment is confirmed)
    invoice: {
        number: String,                 // e.g. MC-20261021-AB12
        monthlyPrice: Number,           // provider's price per month for the added mouzas
        daysLeft: Number,               // paid days left when invoiced
        mouzaFee: Number,               // monthlyPrice × daysLeft ÷ 30 (trial: full monthly price)
        trial: Boolean,                 // trial customer: becomes a paid plan on payment
        plan: String,                   // plan after payment (trial conversion)
        planFee: Number,                // subscription fee included for a trial customer
        amount: Number,                 // total to pay, rounded up to Rs 50
        newFee: Number,                 // subscription fee from now on (used at renewals)
        feeReduction: Number,           // for removed mouzas, set by the provider
        dueAt: Date,
        issuedBy: String,
        issuedAt: Date,
        paidAt: Date,
        paymentRef: String,
        confirmedBy: String
    },
    toAdd: { type: [entrySchema], default: [] },
    toRemove: { type: [entrySchema], default: [] },
    note: String,                                      // customer's message
    daysLeft: Number,                                  // paid days left when asked (for the fee)
    plan: String,
    fee: Number,                                       // set by the approver
    decisionNote: String,
    decidedBy: String,
    decidedAt: Date,
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

assignmentRequestSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AssignmentRequest', assignmentRequestSchema);
