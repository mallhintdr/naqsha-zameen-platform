const mongoose = require('mongoose');

const userGeoAdjustmentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    tehsil: { type: String, required: true },
    mauza: { type: String, required: true },
    latOffset: { type: Number, default: 0 },
    lngOffset: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Index for fast lookups and to ensure uniqueness per user/mouza
userGeoAdjustmentSchema.index({ userId: 1, tehsil: 1, mauza: 1 }, { unique: true });

const UserGeoAdjustment = mongoose.model('UserGeoAdjustment', userGeoAdjustmentSchema);
module.exports = UserGeoAdjustment;
