const mongoose = require('mongoose');

/**
 * Session — Standalone session document.
 * Migrated from: User.sessions[] embedded array.
 * Pattern follows: AuditLog.js (separate collection, proper TTL + compound indexes)
 */

const locationSchema = new mongoose.Schema({
    latitude: { type: Number },
    longitude: { type: Number },
    city: String,
    region: String,
    country: String,
    countryCode: String,
    timezone: String,
    isp: String,
    accuracy: Number,
    source: { type: String, enum: ['ip-geolocation', 'gps', 'manual'], default: 'ip-geolocation' }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
    userId:     { type: String, required: true },
    start:      { type: Date,   required: true },
    end:        { type: Date,   default: null },   // null = session still active
    duration:   { type: Number },                  // seconds
    ipAddress:  { type: String },
    deviceId:   { type: String },
    location:   { type: locationSchema },
    userAgent:  { type: String },
    adminImpersonated: { type: Boolean, default: false },
    deviceInfo: {
        type:       { type: String, default: 'unknown' },
        deviceType: { type: String, enum: ['Desktop', 'Mobile', 'Tablet', 'Unknown'], default: 'Unknown' },
        os:         String,
        browser:    String,
        mobile:     Boolean
    }
}, { timestamps: false });

// ── Indexes ──────────────────────────────────────────────────────────────────
// Primary lookup: sessions for a user, newest first
sessionSchema.index({ userId: 1, start: -1 });

// Global aggregation: all sessions in a time range (statsController pipelines)
sessionSchema.index({ start: -1 });

// Find active (open) sessions: end is null
sessionSchema.index({ end: 1 });

// Compound for location heatmap queries
sessionSchema.index({ userId: 1, 'location.country': 1 });

// TTL: Auto-delete sessions older than 90 days (matches dbHygiene 30-day prune window)
sessionSchema.index({ start: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Session = mongoose.model('Session', sessionSchema);
module.exports = Session;
