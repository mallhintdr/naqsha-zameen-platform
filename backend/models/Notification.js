const mongoose = require('mongoose');

/**
 * Notification — Standalone notification document.
 * Migrated from: User.notifications[] embedded array.
 * Auto-expires after 90 days via TTL index.
 */

const notificationSchema = new mongoose.Schema({
    userId:    { type: String, required: true },
    type:      { type: String, enum: ['subscription', 'profile', 'alert', 'info', 'activation'], default: 'info' },
    title:     { type: String, required: true },
    message:   { type: String, required: true },
    read:      { type: Boolean, default: false },
    // Optional action button (e.g. open a renewal / mouza-change request). It is
    // hidden once the request is decided (actionDone).
    action: {
        label: String,
        url: String,        // in-app path, e.g. /admin/activate/<token>
        kind: String,       // 'renewal' | 'assignment'
        ref: String         // userId (renewal) or request id (assignment)
    },
    actionDone: { type: Boolean, default: false },
    // What answered the request, e.g. { label: 'Renewed', at, plan } (shown instead of the buttons).
    outcome: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Customer this notification is about: the admin / sub-admin can reply to them.
    replyTo: { type: String, default: null },
    lastReply: { at: Date, message: String },
    // Extra info shown in the expandable part of the notification (e.g. mouza
    // change: added / removed mouzas, current mouzas, fee paid, days left).
    details: { type: mongoose.Schema.Types.Mixed, default: undefined },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: false });

// ── Indexes ──────────────────────────────────────────────────────────────────
// Fetch all notifications for a user (unread first)
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// TTL: Auto-delete notifications after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
