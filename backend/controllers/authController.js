const jwt = require('jsonwebtoken');
const DemoLink = require('../models/DemoLink');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');
const { recordEvent, snapshotUser } = require('../services/accountEventService');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const { createSessionWithLocation } = require('../utils/geoUtils');
const { ensureUserTehsilState, ensureUserTehsilStateAsync, sanitizeUser, applyTehsilAssignmentsToUser, sanitizeTehsilAssignmentsInput } = require('../utils/userUtils');
const crypto = require('crypto');
const { sendResetEmail, sendOtpEmail, sendVerificationEmail, _sendVerificationEmail } = require('../utils/emailUtils');
const { limiterStrict } = require('../middleware/rateLimiters');

const SECRET_KEY = process.env.SECRET_KEY;
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')).toLowerCase();
// Chrome 80+ rule: SameSite=None cookies MUST have Secure=true or they are silently discarded.
// Also treat any deployment that sets CORS_ORIGIN to a production domain as "secure".
const _IS_PROD = process.env.NODE_ENV === 'production' ||
    process.platform === 'linux' ||
    (process.env.CORS_ORIGIN || '').startsWith('https://');
const COOKIE_SECURE = _IS_PROD || COOKIE_SAMESITE === 'none';
// Cookie domain comes from COOKIE_DOMAIN, else APP_URL (utils/siteConfig.js).
const { COOKIE_DOMAIN, APP_URL } = require('../utils/siteConfig');
const axios = require('axios');
const geoip = require('geoip-lite');

const DISPOSABLE_DOMAINS = [
    'mailinator.com', '10minutemail.com', 'tempmail.com', 'guerrillamail.com',
    'sharklasers.com', 'dispostable.com', 'getairmail.com', 'yopmail.com'
];

/**
 * Verifies Cloudflare Turnstile CAPTCHA token
 */
const verifyTurnstile = async (token, ip) => {
    try {
        if (!token) return false;
        
        const secret = process.env.TURNSTILE_SECRET_KEY;
        const response = await axios.post(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            {
                secret: secret,
                response: token,
                remoteip: ip
            },
            { timeout: 5000 }
        );

        if (response.data.success !== true) {
            logger.warn('Turnstile verification failed:', { 
                errorCodes: response.data['error-codes'],
                challenge_ts: response.data.challenge_ts,
                hostname: response.data.hostname
            });
        }

        return response.data.success === true;
    } catch (error) {
        logger.error('Turnstile verification error:', { 
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        return false;
    }
};

exports.login = async (req, res) => {
    const { userId, password, otp } = req.body;
    try {
        // SCALE-01: indexed exact match on userIdLower instead of case-insensitive $regex (COLLSCAN)
        const user = await User.findOne({ userIdLower: String(userId || '').toLowerCase() });

        let isMatch = false;
        if (user) {
            isMatch = await bcrypt.compare(password, user.password);
        }

        if (!user || !isMatch) {
            // Log failed login attempt
            logger.security('Failed login attempt', {
                userId,
                ip: req.ip,
                userAgent: req.get('user-agent')
            });

            // Trigger the strict rate limiter on failed attempts
            return limiterStrict(req, res, () => {
                return res.status(401).json({ message: 'Invalid user ID or password.' });
            });
        }

        // Reset rate limit on successful credentials match
        if (limiterStrict && typeof limiterStrict.resetKey === 'function') {
            try {
                limiterStrict.resetKey(req);
            } catch (resetErr) {
                logger.error('Failed to reset login rate limiter key:', resetErr.message);
            }
        }

        // Handle verification status block
        if (user.status === 'PendingVerification') {
            return res.status(403).json({ message: 'Your account is pending email verification. Please verify your email before logging in.' });
        }
        if (user.status === 'AwaitingActivation') {
            return res.status(403).json({ message: 'Your account is not activated yet. Please open the activation link sent to your email.' });
        }

        // Handle first-time login OTP
        if (user.isFirstLogin) {
            if (!otp) {
                // Rate limiting: max 3 OTPs in 15 minutes
                const now = new Date();
                const fifteenMinsAgo = new Date(now - 15 * 60 * 1000);
                
                if (user.lastOtpSent && user.lastOtpSent > fifteenMinsAgo) {
                    if (user.otpSentCount >= 3) {
                        return res.status(429).json({ message: 'Maximum OTP attempts reached. Please try again in 15 minutes.' });
                    }
                } else {
                    // Reset count if 15 mins passed
                    user.otpSentCount = 0;
                }

                // Generate new OTP
                const newOtp = crypto.randomInt(100000, 1000000).toString(); // SEC-04: crypto CSPRNG, not Math.random
                const hashedOtp = crypto.createHash('sha256').update(newOtp).digest('hex');
                user.otp = hashedOtp;
                user.otpExpires = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins
                user.otpSentCount += 1;
                user.lastOtpSent = now;
                await user.save();

                if (user.email) {
                    try {
                        await sendOtpEmail(user.email, user.userName, newOtp);
                    } catch (emailErr) {
                        logger.error('Failed to send OTP email:', emailErr.message);
                        return res.status(500).json({ message: 'Failed to send verification code. Please contact admin.' });
                    }
                } else {
                    return res.status(400).json({ message: 'No registered email found for verification. Please contact admin.' });
                }

                return res.status(200).json({ 
                    needsOTP: true, 
                    message: 'A verification code has been sent to your registered email.' 
                });
            } else {
                // Verify OTP
                let otpIsValid = false;
                if (user.otp && otp) {
                    const hashedInput = crypto.createHash('sha256').update(otp).digest('hex');
                    if (Buffer.byteLength(hashedInput) === Buffer.byteLength(user.otp)) {
                        otpIsValid = crypto.timingSafeEqual(Buffer.from(hashedInput), Buffer.from(user.otp));
                    }
                }

                if (!otpIsValid || new Date() > user.otpExpires) {
                    return res.status(400).json({ message: 'Invalid or expired verification code.' });
                }
                // Success - mark as no longer first login
                user.isFirstLogin = false;
                user.otp = undefined;
                user.otpExpires = undefined;
                // Continue with regular login below
            }
        }

        const state = ensureUserTehsilState(user);
        
        // Removed status blocking to allow users to log in and see their status/warnings.
        // Data access for sensitive endpoints remains blocked by the isSubscribed middleware.

        const token = jwt.sign(
            { userId: user.userId, tokenVersion: user.tokenVersion || 0 }, 
            SECRET_KEY, 
            { expiresIn: '30d' }
        );

        // Create session with location tracking in standalone collection
        try {
            const sessionWithLocation = await createSessionWithLocation(req, geoip);
            const newSession = new Session({
                userId: user.userId,
                ...sessionWithLocation
            });
            await newSession.save();
        } catch (sessionError) {
            logger.error('Session creation failed (non-fatal):', { error: sessionError.message });
        }

        user.lastActive = new Date();
        if (state.changed) {
            user.markModified('tehsilAccess');
        }
        await user.save();

        // Count devices (not IPs) for multi-use checks; long-lived device cookie.
        if (user.userType !== 'admin') {
            await require('../services/deviceTracker').recordLogin(req, res, user.userId, { secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN });
        }

        // A real login ends any admin "Login as" session on this browser, so a later
        // logout can never switch back into the admin account.
        return res
            .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
            .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
            .cookie('authToken', token, {
                httpOnly: true,
                secure: COOKIE_SECURE,
                maxAge: 30 * 24 * 60 * 60 * 1000,
                sameSite: COOKIE_SAMESITE,
                domain: COOKIE_DOMAIN,
                path: '/'
            })
            .json({ message: 'Login successful' });

    } catch (error) {
        logger.error('Login error:', { error: error.message, stack: error.stack });
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

exports.logout = async (req, res) => {
    const isClearAll = req.body?.clearAll === true;
    try {
        if (req.user?.userId) {
            const lastSession = await Session.findOne({ userId: req.user.userId, end: null }).sort({ start: -1 });
            if (lastSession) {
                lastSession.end = new Date();
                lastSession.duration = Math.ceil((lastSession.end - lastSession.start) / 1000);
                await lastSession.save();
            }
            await User.updateOne({ userId: req.user.userId }, { lastActive: null });
        }
    } catch (error) {
        // console.error('Logout session error:', error);
    } finally {
        const adminToken = req.cookies?.adminAuthToken;
        // If an admin impersonated a user and issues a regular POST logout (not clearAll), restore the admin session
        if (!isClearAll && adminToken && req.method === 'POST') {
            res
                .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
                .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
                .cookie('authToken', adminToken, {
                    httpOnly: true,
                    secure: COOKIE_SECURE,
                    sameSite: COOKIE_SAMESITE,
                    domain: COOKIE_DOMAIN,
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    path: '/'
                })
                .json({ message: 'Logout successful', adminRestored: true });
        } else {
            res
                .clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
                .clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
                .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
                .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
                .clearCookie('x-csrf-token', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
                .clearCookie('x-csrf-token', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE });

            if (req.method === 'GET') {
                const redirectUrl = `${APP_URL}/login`;
                return res.redirect(redirectUrl);
            }
            return res.json({ message: isClearAll ? 'Cache and sessions cleared successfully' : 'Logout successful' });
        }
    }
};

exports.register = async (req, res) => {
    try {
        const {
            password,
            tehsilAccess: rawAssignments,
            tehsil,
            mauzaList,
            activeTehsil: requestedActiveTehsil,
            email,
            ...userData
        } = req.body || {};

        if (!password) {
            return res.status(400).json({ error: 'Password is required.' });
        }

        let emailVal = typeof email === 'string' ? email.trim() : email;
        if (!emailVal || emailVal === '') {
            return res.status(400).json({ error: 'Email address is required for public registration.' });
        }

        // Disposable Email Domain Check
        const emailDomain = emailVal.split('@')[1]?.toLowerCase();
        if (DISPOSABLE_DOMAINS.includes(emailDomain)) {
            return res.status(400).json({ error: 'Please use a valid, non-disposable email address.' });
        }

        const DeviceFingerprint = require('../models/DeviceFingerprint');
        const deviceId = (req.body.deviceId || '').trim();
        
        // Check if limits are enabled
        const limitsConfig = await SystemConfig.findOne({ key: 'limitsEnabled' });
        const limitsEnabled = limitsConfig ? limitsConfig.value !== false : true;

        if (limitsEnabled) {
            if (!deviceId) {
                return res.status(400).json({ error: 'Device validation is required for registration.' });
            }
            const existingDevice = await DeviceFingerprint.findOne({
                $or: [
                    { deviceId },
                    { email: emailVal }
                ]
            });
            if (existingDevice) {
                if (existingDevice.deviceId === deviceId) {
                    return res.status(400).json({ 
                        code: 'DEVICE_EXISTS',
                        error: 'Registration limit reached. You can only register one trial account per device.' 
                    });
                } else {
                    return res.status(400).json({ 
                        code: 'EMAIL_EXISTS',
                        error: 'Registration limit reached. An account with this email address already exists.' 
                    });
                }
            }
        }

        const newUser = new User({
            ...userData,
            password,
            email: emailVal,
            deviceId,
            registrationSource: 'public',
            isPublicRegistration: true
        });
        // BUG FIX: Do NOT set startDate here. The 2-day trial clock must start when the
        // user actually verifies their email (see verifyEmail below), not at registration
        // time. Setting it here made calculateDatesAndStatus() immediately compute an
        // "Active" status for a brand-new, unverified account (masked only by the status
        // guard below), which is why public registrations always showed as activated.

        newUser.status = 'PendingVerification';
        newUser.userType = 'user';

        // Generate email verification token
        const token = crypto.randomBytes(32).toString('hex');
        newUser.verificationToken = crypto.createHash('sha256').update(token).digest('hex');
        newUser.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        const { captchaToken } = req.body;
        // SEC-10: Turnstile is enabled by default whenever a secret key is configured.
        // Set ENABLE_TURNSTILE=false explicitly to disable it (e.g. local dev without a key).
        const ENABLE_TURNSTILE = process.env.ENABLE_TURNSTILE !== 'false' && !!process.env.TURNSTILE_SECRET_KEY;
        if (ENABLE_TURNSTILE) {
            const turnstileResult = await verifyTurnstile(captchaToken, req.ip);
            if (!turnstileResult && process.env.NODE_ENV === 'production') {
                return res.status(400).json({ 
                    error: 'Security verification failed. This can happen if your device time is incorrect or the session expired. Please refresh and try again.' 
                });
            }
        }

        if (!newUser.subscriptionType) newUser.subscriptionType = 'Trial';
        
        const assignments = sanitizeTehsilAssignmentsInput(
            rawAssignments,
            {
                fallbackTehsil: typeof tehsil === 'string' ? tehsil.trim() : '',
                fallbackMauzas: Array.isArray(mauzaList) ? mauzaList : []
            }
        );

        // Enforce public registration limits (max 1 tehsil, max 1 mouza total)
        const totalTehsils = assignments.length;
        const totalMouzas = assignments.reduce((sum, entry) => sum + (entry.mouzas?.length || 0), 0);
        if (totalTehsils > 1) {
            return res.status(400).json({ error: 'Public registration is limited to exactly 1 tehsil.' });
        }
        if (totalMouzas > 1) {
            return res.status(400).json({ error: 'Public registration is limited to exactly 1 mouza.' });
        }

        // AKAR chaks: admin only, never by public sign-up.
        const akar = require('../utils/akarGuard');
        if (akar.hasAkar(assignments)) {
            return res.status(403).json({ code: 'AKAR_RESTRICTED', error: akar.AKAR_MESSAGE });
        }
        // A tehsil and at least one mouza are required to register.
        if (totalTehsils < 1 || totalMouzas < 1) {
            return res.status(400).json({ error: 'Please select a tehsil and at least 1 mouza to register.' });
        }
        if (!assignments.length) {
            newUser.tehsilAccess = [];
            newUser.activeTehsil = '';
        } else {
            const { tehsilAccess, activeTehsil } = applyTehsilAssignmentsToUser(newUser, assignments, requestedActiveTehsil);
            newUser.tehsilAccess = tehsilAccess;
            newUser.activeTehsil = activeTehsil;
        }

        await newUser.save();
        await recordEvent({ userId: newUser.userId, type: 'USER_CREATED', plan: newUser.subscriptionType, note: 'public registration', after: snapshotUser(newUser) }, { ip: req.ip, user: { userId: newUser.userId, userType: 'user' } });

        // Create Device Fingerprint
        try {
            await DeviceFingerprint.create({
                deviceId,
                userId: newUser.userId,
                email: emailVal,
                ipAddress: req.ip
            });
        } catch (e) {
            logger.error('Failed to create device fingerprint:', e.message);
        }

        // Send activation email — queue first, direct SMTP fallback if queue unavailable
        try {
            await sendVerificationEmail(newUser.email, newUser.userName || newUser.userId, token);
            logger.info('Verification email queued/sent for:', { email: newUser.email, userId: newUser.userId });
        } catch (emailErr) {
            logger.error('Queue send failed, attempting direct SMTP fallback:', { error: emailErr.message, userId: newUser.userId });
            try {
                await _sendVerificationEmail(newUser.email, newUser.userName || newUser.userId, token);
                logger.info('Verification email sent via direct SMTP fallback for:', { email: newUser.email });
            } catch (smtpErr) {
                logger.error('Direct SMTP fallback also failed — email NOT sent:', { error: smtpErr.message, email: newUser.email, userId: newUser.userId });
            }
        }

        res.status(201).json({ message: 'User registered successfully! Please check your email to activate your account.' });
 
         // Notify admins in the background
         const { notifyAdmins } = require('../utils/notificationUtils');
         notifyAdmins({
             type: 'info',
             title: 'New Public Registration',
             message: `${newUser.userId} (${newUser.userName || newUser.userId}) created their account.`
         }).catch(err => logger.error('Public registration admin notification failed', { error: err.message }));
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0];
            const displayField = field === 'userId' ? 'User ID' : field;
            const errCode = field === 'userId' ? 'USERID_EXISTS' : field === 'email' ? 'EMAIL_EXISTS' : 'DUPLICATE_KEY';
            return res.status(400).json({ 
                code: errCode,
                error: `Registration failed. A user with this ${displayField} already exists.` 
            });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(400).json({ error: error.message || 'Registration failed' });
    }
};

exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ error: 'Verification token is required.' });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            verificationToken: hashedToken,
            verificationTokenExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired verification token.' });
        }

        // Activate a 48-hour trial counted from this exact moment. The User save
        // hook derives endDate from startDate + plan (dateUtils HOUR_BASED_PLANS).
        user.status = 'Trial';
        if (!user.subscriptionType || user.subscriptionType === 'Trial') user.subscriptionType = 'Trial';
        user.startDate = new Date();
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();
        await recordEvent({ userId: user.userId, ownerAtEvent: user.managedBy || null, type: 'ACTIVATED', plan: user.subscriptionType, periodStart: user.startDate, periodEnd: user.endDate }, { ip: req.ip, user: { userId: user.userId, userType: 'user' } });

        // Notify admins in the background that public user has activated
        const { notifyAdmins } = require('../utils/notificationUtils');
        notifyAdmins({
            type: 'activation',
            title: 'Public User Activated',
            message: `${user.userId} (${user.userName || user.userId}) activated their account.`
        }).catch(err => logger.error('Public user activation admin notification failed', { error: err.message }));

        res.status(200).json({ 
            message: 'Account verified and activated successfully! You can now log in.',
            userId: user.userId,
            userName: user.userName
        });
    } catch (error) {
        logger.error('Email verification error:', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Internal server error during email verification.' });
    }
};

// Only these fields are ever copied from the request into a new user. Anything
// else (renewalHistory, tokenVersion, managedBy, ...) is ignored.
const ADMIN_REGISTER_FIELDS = ['userName', 'userId', 'mobileNumber', 'startDate', 'subscriptionType', 'userType', 'fee'];
const ADMIN_REGISTER_USER_TYPES = ['user', 'admin'];

exports.adminRegister = async (req, res) => {
    try {
        const {
            password,
            tehsilAccess: rawAssignments,
            tehsil,
            mauzaList,
            activeTehsil: requestedActiveTehsil,
            email
        } = req.body || {};

        const userData = {};
        for (const key of ADMIN_REGISTER_FIELDS) {
            if (req.body?.[key] !== undefined) userData[key] = req.body[key];
        }
        if (userData.userType !== undefined && !ADMIN_REGISTER_USER_TYPES.includes(userData.userType)) {
            return res.status(400).json({ error: 'Invalid user type.' });
        }

        if (!password) {
            return res.status(400).json({ error: 'Password is required.' });
        }

        let emailVal = typeof email === 'string' ? email.trim() : email;
        if (emailVal === '') emailVal = undefined;

        const newUser = new User({ ...userData, password, email: emailVal });
        if (!newUser.startDate) newUser.startDate = new Date();

        const isAdminUser = newUser.userType === 'admin';

        if (isAdminUser) {
            newUser.subscriptionType = 'Permanent';
            await ensureUserTehsilStateAsync(newUser);
        } else {
            if (!newUser.subscriptionType) newUser.subscriptionType = 'Trial';
            
            const assignments = sanitizeTehsilAssignmentsInput(
                rawAssignments,
                {
                    fallbackTehsil: typeof tehsil === 'string' ? tehsil.trim() : '',
                    fallbackMauzas: Array.isArray(mauzaList) ? mauzaList : []
                }
            );

            if (!assignments.length) {
                return res.status(400).json({ error: 'At least one tehsil with mouzas is required for admin-created users.' });
            } else {
                const { tehsilAccess, activeTehsil } = applyTehsilAssignmentsToUser(newUser, assignments, requestedActiveTehsil);
                newUser.tehsilAccess = tehsilAccess;
                newUser.activeTehsil = activeTehsil;
            }
        }

        await newUser.save();
        await recordEvent({ userId: newUser.userId, ownerAtEvent: newUser.managedBy || null, type: 'USER_CREATED', plan: newUser.subscriptionType, periodStart: newUser.startDate, periodEnd: newUser.endDate, after: snapshotUser(newUser) }, req);
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0];
            const displayField = field === 'userId' ? 'User ID' : field;
            return res.status(400).json({ error: `Registration failed. A user with this ${displayField} already exists.` });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(400).json({ error: error.message || 'Registration failed' });
    }
};



exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const user = await User.findOne({ userId: req.user.userId });
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect old password.' });

        if (user.lastPasswordResetRequest && Date.now() - user.lastPasswordResetRequest < 24 * 60 * 60 * 1000) {
            return res.status(429).json({ message: 'You can only change your password once every 24 hours.' });
        }

        user.password = newPassword;
        user.lastPasswordResetRequest = Date.now();
        await user.save();
        res.clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
            .status(200)
            .json({ message: 'Password changed successfully. Please log in again.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to change password.' });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ message: 'User ID is required.' });

        // SCALE-01: indexed exact match on userIdLower instead of case-insensitive $regex (COLLSCAN)
        const user = await User.findOne({ userIdLower: String(userId || '').toLowerCase() });

        const limitsConfig = await SystemConfig.findOne({ key: 'limitsEnabled' });
        const limitsEnabled = limitsConfig ? limitsConfig.value !== false : true;

        if (limitsEnabled && user && user.lastPasswordResetRequest && Date.now() - user.lastPasswordResetRequest < 24 * 60 * 60 * 1000) {
            return res.status(429).json({ message: 'You can only request a password reset once every 24 hours.' });
        }

        let targetEmail = '';
        if (user && user.email) {
            const parts = user.email.split('@');
            if (parts.length === 2) {
                const name = parts[0];
                const domain = parts[1];
                const visibleLen = Math.min(3, Math.floor(name.length / 2));
                const maskedName = name.substring(0, visibleLen) + '***' + name.substring(name.length - Math.min(1, name.length - visibleLen));
                targetEmail = `${maskedName}@${domain}`;
            } else {
                targetEmail = '***@***';
            }
        }

        // Add timing-safe delay to prevent user enumeration
        await Promise.all([
            (async () => {
                if (!user || !user.email) return;

                // Generate token
                const resetToken = crypto.randomBytes(32).toString('hex');
                const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

                user.resetPasswordToken = hashedToken;
                user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
                user.lastPasswordResetRequest = Date.now();
                await user.save();

                await sendResetEmail(user.email, user.userId, resetToken);
            })(),
            new Promise(r => setTimeout(r, 500 + Math.random() * 500))
        ]);

        res.status(200).json({ 
            message: 'If an account exists with that ID, a reset link has been sent to the registered email.',
            email: targetEmail
        });
    } catch (error) {
        logger.error('Forgot password error:', { error: error.message });
        res.status(500).json({ message: 'Failed to send reset email. Please try again later.' });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Invalid request.' });

    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) return res.status(400).json({ message: 'Token is invalid or has expired.' });

        // Update password and invalidate all sessions
        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.sessions = []; // Clear all sessions
        user.lastActive = null;
        
        await user.save();

        // Invalidate active sessions in Session collection
        try {
            await Session.updateMany(
                { userId: user.userId, end: null },
                { $set: { end: new Date(), terminationReason: 'password_reset' } }
            );
        } catch (sessionErr) {
            logger.warn('Failed to update sessions on password reset:', { error: sessionErr.message });
        }
        
        // Clear all authentication cookies across host-only and domain variants
        res
            .clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
            .clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
            .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
            .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
            .clearCookie('x-csrf-token', { path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
            .clearCookie('x-csrf-token', { path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
            .json({ 
                message: 'Password reset successful. You have been logged out from all devices.',
                userId: user.userId 
            });
    } catch (err) {
        logger.error('Reset password error:', { error: err.message });
        res.status(500).json({ message: 'Internal server error.' });
    }
};

exports.impersonateUser = async (req, res) => {
    try {
        // SCALE-01: indexed exact match on userIdLower instead of case-insensitive $regex (COLLSCAN)
        const target = await User.findOne({ userIdLower: String(req.params.userId || '').toLowerCase() });
        if (!target) return res.status(404).json({ message: 'User not found' });

        const state = ensureUserTehsilState(target);

        const adminToken = req.cookies.authToken;
        const token = jwt.sign({ userId: target.userId, tokenVersion: target.tokenVersion || 0 }, SECRET_KEY, { expiresIn: '30d' }); // Restored to 30 days

        // Create session with location tracking in standalone collection
        try {
            const sessionWithLocation = await createSessionWithLocation(req, geoip);
            const newSession = new Session({
                userId: target.userId,
                ...sessionWithLocation,
                adminImpersonated: true // Mark session so it is ignored for IP misuse tracking
            });
            await newSession.save();
        } catch (sessionError) {
            logger.error('Session creation failed during impersonation (non-fatal):', { error: sessionError.message });
        }

        target.lastActive = new Date();
        if (state.changed) {
            target.markModified('tehsilAccess');
        }
        await target.save();

        // AUDIT LOG: Record impersonation
        await AuditLog.create({
            action: 'ADMIN_IMPERSONATION',
            adminId: req.user.userId,
            targetUserId: target.userId,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            metadata: {
                adminName: req.user.userName,
                targetName: target.userName
            }
        });

        logger.audit('ADMIN_IMPERSONATION', req.user.userId, {
            targetUserId: target.userId,
            ip: req.ip
        });
        // A sub-admin logging in as one of their customers: let the admin know.
        if (req.user.userType === 'subadmin') {
            require('../utils/notificationUtils').notifyAdmins({
                type: 'info', title: `[${req.user.userId}] logged in as a customer`, message: `${req.user.userId} opened ${target.userId}'s account (Login As).`
            }).catch(() => {});
        }

        res
            .cookie('authToken', token, {
                httpOnly: true,
                secure: COOKIE_SECURE,
                sameSite: COOKIE_SAMESITE,
                domain: COOKIE_DOMAIN,
                maxAge: 30 * 24 * 60 * 60 * 1000,
                path: '/'
            })
            .cookie('adminAuthToken', adminToken, {
                httpOnly: true,
                secure: COOKIE_SECURE,
                sameSite: COOKIE_SAMESITE,
                domain: COOKIE_DOMAIN,
                maxAge: 30 * 24 * 60 * 60 * 1000,
                path: '/'
            })
            .json({ message: 'Impersonation successful' });
    } catch (err) {
        logger.error('Impersonation failed', { error: err.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * GET /demo-access/:token
 * Validates a demo link token, issues a session cookie, and redirects to the app.
 */
exports.demoAccess = async (req, res) => {
    try {
        const { token } = req.params;
        if (!token) {
            return res.status(400).send('<h2>Invalid or expired link.</h2>');
        }

        const demoLink = await DemoLink.findOne({ token }).populate('user');
        if (!demoLink) {
            return res.status(400).send('<h2>Invalid or expired link.</h2>');
        }

        if (new Date() > demoLink.expiresAt) {
            await DemoLink.deleteOne({ _id: demoLink._id });
            return res.status(400).send('<h2>Invalid or expired link.</h2>');
        }

        const user = demoLink.user;
        if (!user) {
            return res.status(400).send('<h2>Invalid or expired link.</h2>');
        }

        if (demoLink.useCount >= (demoLink.maxUses || 5)) {
            await DemoLink.deleteOne({ _id: demoLink._id });
            return res.status(400).send('<h2>Link usage limit exceeded.</h2>');
        }

        // Update usage stats
        demoLink.lastUsedAt = new Date();
        demoLink.useCount = (demoLink.useCount || 0) + 1;
        await demoLink.save();

        // Issue a short-lived JWT (same duration as the link's remaining validity)
        const remaining = Math.max(0, demoLink.expiresAt - Date.now());
        const authToken = jwt.sign({ userId: user.userId }, SECRET_KEY, { expiresIn: Math.floor(remaining / 1000) });

        // Where the React app lives. With FRONTEND_URL / CORS_ORIGIN unset on the
        // server this used to redirect to "/" on the API host, which answered
        // "Route not found". Fall back to the dashboard like server.js does, and
        // take the first entry when CORS_ORIGIN is a comma-separated list.
        const redirectTarget = `${APP_URL}/`;

        res
            .cookie('authToken', authToken, {
                httpOnly: true,
                secure: COOKIE_SECURE,
                maxAge: remaining,
                sameSite: COOKIE_SAMESITE,
                // BUG FIX: without an explicit domain this cookie is host-only on the API
                // subdomain (e.g. api.naqsha-zameen.pk) and never reaches the dashboard
                // subdomain after the redirect below, same as login()/impersonateUser().
                domain: COOKIE_DOMAIN,
                path: '/'
            })
            .redirect(redirectTarget);

    } catch (err) {
        logger.error('Demo access failed', { error: err.message });
        res.status(500).send('<h2>An error occurred. Please try again.</h2>');
    }
};

