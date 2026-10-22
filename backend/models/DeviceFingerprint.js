const mongoose = require('mongoose');

const deviceFingerprintSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    email: { type: String, required: true },
    ipAddress: { type: String },
    registeredAt: { type: Date, default: Date.now }
});

deviceFingerprintSchema.index({ email: 1 });

module.exports = mongoose.model('DeviceFingerprint', deviceFingerprintSchema);
