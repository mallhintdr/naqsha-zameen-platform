const mongoose = require('mongoose');

// Saved Shajra Nasab cases (public tool, anonymous). Removed automatically after 30 days.
const shajraCaseSchema = new mongoose.Schema({
    _id: { type: String },                 // short public id used in the share link
    data: { type: String, required: true }, // sanitized case JSON (BigInt as {"$big": "..."})
    policyVersion: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
}, { versionKey: false });

module.exports = mongoose.models.ShajraCase || mongoose.model('ShajraCase', shajraCaseSchema);
