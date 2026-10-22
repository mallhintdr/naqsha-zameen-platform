const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        enum: [
            'LOGIN',
            'LOGOUT',
            'LOGIN_FAILED',
            'PASSWORD_CHANGE',
            'PASSWORD_RESET',
            'USER_CREATE',
            'USER_UPDATE',
            'USER_DELETE',
            'ADMIN_IMPERSONATION',
            'GEOJSON_SHIFT',
            'GEOJSON_RESET',
            'SUBSCRIPTION_RENEWAL',
            'DEMO_LINK_CREATE',
        ],
    },
    adminId: {
        type: String,
        required: true,
    },
    targetUserId: {
        type: String,
    },
    ipAddress: String,
    userAgent: String,
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: { expireAfterSeconds: 60 * 24 * 60 * 60 },
    },
    success: {
        type: Boolean,
        default: true,
    },
});

// Index for efficient queries
auditLogSchema.index({ adminId: 1, timestamp: -1 });
auditLogSchema.index({ targetUserId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
