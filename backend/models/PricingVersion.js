const mongoose = require('mongoose');

/**
 * Price table for sub-admin sales, versioned and append-only. The current
 * table is the highest version; restoring an old one creates a new version.
 * Every bill line stores the version it was priced from.
 */
const tierSchema = new mongoose.Schema({
    key: { type: String, required: true },
    minMouzas: { type: Number, required: true },
    maxMouzas: { type: Number, required: true },
    monthly: { type: Number, required: true },
    yearlyPinned: { type: Number, default: null }
}, { _id: false });

const pricingVersionSchema = new mongoose.Schema({
    version: { type: Number, required: true, unique: true },
    tiers: { type: [tierSchema], required: true },
    yearlyDiscountPct: { type: Number, default: 30 },
    roundTo: { type: Number, default: 100 },
    roundMode: { type: String, enum: ['nearest', 'up', 'down'], default: 'nearest' },
    maxMouzas: { type: Number, default: 8 },
    trialMaxMouzas: { type: Number, default: 2 },
    minUpgradeCharge: { type: Number, default: 100 },
    createdBy: String,
    note: String,
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('PricingVersion', pricingVersionSchema);
