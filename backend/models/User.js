const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { calculateDatesAndStatus } = require('../utils/dateUtils');

const renewalEntrySchema = new mongoose.Schema({
    date: { type: Date, required: true },
    type: { type: String, required: true },
    paymentAmount: { type: Number },
    previousSubscriptionType: { type: String },
    previousStartDate: { type: Date },
    previousEndDate: { type: Date }
}, { _id: false });

const warningSchema = new mongoose.Schema({
    type: { type: String, required: true }, // 'multi-ip', 'suspicious-activity', 'manual'
    message: { type: String, required: true },
    adminUserId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false }
}, { _id: false });

const tempGrantSchema = new mongoose.Schema({
    mouza: { type: String, required: true },
    expiresAt: { type: Date, required: true }
}, { _id: false });

const userTehsilSchema = new mongoose.Schema({
    tehsil: { type: String, required: true },
    mouzas: { type: [String], default: [] },
    tempGrants: { type: [tempGrantSchema], default: [] }
}, { _id: false });

const pushSubscriptionSchema = new mongoose.Schema({
    endpoint: { type: String, required: true },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true }
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    userName: String,
    userId: { type: String, unique: true, required: true },
    // SCALE-01: Lowercased mirror of userId for O(1) indexed exact-match lookups.
    // Avoids case-insensitive $regex queries (which force a full COLLSCAN) on
    // login/forgotPassword/impersonate/profile/location lookups.
    userIdLower: { type: String, unique: true, sparse: true },
    password: String,
    // passwordPlain field REMOVED for security
    mobileNumber: String,
    deviceId: { type: String },
    email: {
        type: String,
        sparse: true,
        trim: true,
        lowercase: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please fill a valid email address']
    },
    tehsilAccess: { type: [userTehsilSchema], default: [] },
    activeTehsil: { type: String, default: '' },
    startDate: Date,
    subscriptionType: String,
    endDate: Date,
    daysRemaining: Number,
    status: String,
    userType: { type: String, enum: ['user', 'subadmin', 'admin'], default: 'user' },

    // ── Sub-admin program ──────────────────────────────────────────────
    // Owner of this customer: a sub-admin's userId, or null = the admin's own.
    managedBy: { type: String, default: null },
    createdBy: { type: String },
    planTier: { type: String },                       // price-table tier key, e.g. 'T1'
    paidPeriod: {
        start: Date,
        end: Date,
        plan: String,                                 // 'Monthly' | 'Yearly'
        tierPricePaid: Number,                        // platform price paid for this period
        pricingVersion: Number,
        changeUsed: { type: Boolean, default: false } // one assignment change per paid period
    },
    // Email activation for customers created by sub-admins, and for new sub-admins.
    activation: {
        tokenHash: String,
        expiresAt: Date,
        resendDay: String,
        resendCount: { type: Number, default: 0 },
        plan: String,                                 // plan to start when activated
        customerFee: Number,
        activatedAt: Date,
        activatedIp: String,
        activatedDevice: String
    },
    pendingEmail: {
        email: String,
        tokenHash: String,
        expiresAt: Date
    },
    customMouzaLimit: Number,                         // raised by admin via an approved request
    customPlatformPrice: { monthly: Number, yearly: Number },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    fee: { type: Number, default: 1000 },
    renewalHistory: { type: [renewalEntrySchema], default: [] },
    renewalCount: { type: Number, default: 0 },
    warnings: { type: [warningSchema], default: [] },
    pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
    tokenVersion: { type: Number, default: 0 },
    lastActive: Date,
    profileEditedAt: { type: Date, default: Date.now },
    // Verification & Security
    isFirstLogin: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    otpSentCount: { type: Number, default: 0 },
    lastOtpSent: { type: Date },
    lastPasswordResetRequest: { type: Date },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },
    registrationSource: { type: String, enum: ['admin', 'public'], default: 'admin' },
    isPublicRegistration: { type: Boolean, default: false }
}, { timestamps: true });

// Add indexes for performance
userSchema.index({ userName: 1 });
userSchema.index({ deviceId: 1 });
userSchema.index({ status: 1 });
userSchema.index({ profileEditedAt: -1 });
userSchema.index({ 'tehsilAccess.tehsil': 1 });
userSchema.index({ lastActive: -1 });
userSchema.index({ updatedAt: -1 });
userSchema.index({ status: 1, subscriptionType: 1 }); // Compound index
userSchema.index({ resetPasswordToken: 1 }, { sparse: true }); // sparse: skips docs with no token
userSchema.index({ lastActive: -1, userType: 1 });              // online users query
userSchema.index({ userName: 'text', userId: 'text' });
userSchema.index({ managedBy: 1, status: 1 });
userSchema.index({ 'activation.tokenHash': 1 }, { sparse: true });
userSchema.index({ 'pendingEmail.tokenHash': 1 }, { sparse: true });

// Common passwords to reject
const COMMON_PASSWORDS = [
    'password', '12345678', 'qwerty', 'aaaaaa', '123456',
    'password123', 'admin', 'letmein', 'welcome'
];

userSchema.pre('save', async function (next) {
    try {
        // SCALE-01: keep userIdLower in sync whenever userId changes (including on create)
        if (this.isModified('userId') || this.isNew) {
            this.userIdLower = String(this.userId || '').toLowerCase();
        }

        if (this.isModified('password')) {
            const plainPassword = this.password;

            // Validate password strength
            if (plainPassword.length < 8) {
                return next(new Error('Password must be at least 8 characters'));
            }
            if (!/[A-Z]/.test(plainPassword)) {
                return next(new Error('Password must contain at least one uppercase letter'));
            }
            if (!/[a-z]/.test(plainPassword)) {
                return next(new Error('Password must contain at least one lowercase letter'));
            }
            if (!/[0-9]/.test(plainPassword)) {
                return next(new Error('Password must contain at least one number'));
            }
            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(plainPassword)) {
                return next(new Error('Password must contain at least one special character'));
            }

            // Check against common passwords
            if (COMMON_PASSWORDS.includes(plainPassword.toLowerCase())) {
                return next(new Error('Password is too common, please choose a stronger password'));
            }

            // Hash password with increased rounds (12 instead of 10)
            const salt = await bcrypt.genSalt(12);
            this.password = await bcrypt.hash(plainPassword, salt);
        }

        // Issue #18: Only recalculate subscription dates when relevant fields change
        if (this.isNew || this.isModified('startDate') || this.isModified('subscriptionType') || this.isModified('status')) {
            const { endDate, daysRemaining, status } = calculateDatesAndStatus(
                this.startDate,
                this.subscriptionType
            );
            this.endDate = endDate;
            this.daysRemaining = daysRemaining;
            
            // Statuses a save must not overwrite unless the plan or start date changes
            // (a renewal of a suspended customer lifts the suspension).
            const HOLD_STATUSES = ['Pending', 'PendingVerification', 'AwaitingActivation', 'Suspended'];
            const isPendingNewUser = this.isNew && HOLD_STATUSES.includes(this.status);
            const isPendingModified = !this.isNew && HOLD_STATUSES.includes(this.status) && !this.isModified('subscriptionType') && !this.isModified('startDate');

            if (isPendingNewUser || isPendingModified) {
                // Keep as Pending / PendingVerification
            } else {
                this.status = status;
            }
        }

        if (this.warnings && this.warnings.length > 30) {
            this.warnings = this.warnings.slice(-30);
        }
        if (this.pushSubscriptions && this.pushSubscriptions.length > 10) {
            this.pushSubscriptions = this.pushSubscriptions.slice(-10);
        }
        if (this.isModified('subscriptionType') || this.isModified('startDate') || this.isModified('password') || this.isModified('tehsilAccess') || this.isModified('activeTehsil') || this.isModified('mobileNumber') || this.isModified('email')) {
            this.profileEditedAt = new Date();
        }

        next();
    } catch (error) {
        next(error);
    }
});

userSchema.post('save', function (doc) {
    try {
        const { invalidateAuthUser } = require('../middleware/authMiddleware');
        if (doc && doc.userId) invalidateAuthUser(doc.userId);
    } catch (_) {}
});

userSchema.post('findOneAndUpdate', function (doc) {
    try {
        const { invalidateAuthUser } = require('../middleware/authMiddleware');
        if (doc && doc.userId) invalidateAuthUser(doc.userId);
    } catch (_) {}
});

const User = mongoose.model('User', userSchema);
module.exports = User;
