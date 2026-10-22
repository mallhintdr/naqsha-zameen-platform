const mongoose = require('mongoose');

/**
 * Requests a sub-admin sends to the admin:
 *  - correction:    reverse a billable action (e.g. renewed the wrong customer)
 *  - more_mouzas:   assign more mouzas than the limit to a customer
 *  - extra_change:  another assignment change within a paid period
 */
const subAdminRequestSchema = new mongoose.Schema({
    kind: { type: String, enum: ['correction', 'more_mouzas', 'extra_change'], required: true },
    subAdminId: { type: String, required: true },
    userId: { type: String, required: true },
    eventId: mongoose.Schema.Types.ObjectId,                         // correction target
    requestedAssignment: [{ tehsil: String, mouzas: [String], _id: false }],
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    decidedBy: String,
    decidedAt: Date,
    decisionNote: String,
    approvedMonthlyPrice: Number,
    approvedYearlyPrice: Number,
    approvedMouzaLimit: Number
}, { timestamps: true });

subAdminRequestSchema.index({ status: 1, createdAt: -1 });
subAdminRequestSchema.index({ subAdminId: 1, createdAt: -1 });

module.exports = mongoose.model('SubAdminRequest', subAdminRequestSchema);
