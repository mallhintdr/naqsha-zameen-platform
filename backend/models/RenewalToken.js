const mongoose = require('mongoose');

const renewalTokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true },
    requestType: { type: String, enum: ['Renewal', 'Activation', 'AssignmentChange'], required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId },   // AssignmentChange: the AssignmentRequest
    requestedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date }
});

// Auto-expire documents after 7 days
renewalTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RenewalToken', renewalTokenSchema);
