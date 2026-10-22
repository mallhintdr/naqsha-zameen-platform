const mongoose = require('mongoose');

/**
 * One bill per sub-admin per Pakistan calendar day that had billable lines.
 * Lines themselves are AccountEvent documents (billable: true, billDay).
 */
const subAdminBillSchema = new mongoose.Schema({
    subAdminId: { type: String, required: true },
    day: { type: String, required: true },          // 'YYYY-MM-DD' PKT
    lineCount: { type: Number, default: 0 },
    linesTotal: { type: Number, default: 0 },       // positive lines
    creditsTotal: { type: Number, default: 0 },     // credits (negative lines), as a negative number
    total: { type: Number, default: 0 },            // linesTotal + creditsTotal
    paidAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['issued', 'part_paid', 'paid'], default: 'issued' },
    issuedAt: { type: Date, default: Date.now },
    dueAt: Date,                                    // end of the payment window
    pdfPath: String,
    emailedAt: Date
}, { versionKey: false });

subAdminBillSchema.index({ subAdminId: 1, day: 1 }, { unique: true });
subAdminBillSchema.index({ subAdminId: 1, status: 1, dueAt: 1 });

module.exports = mongoose.model('SubAdminBill', subAdminBillSchema);
