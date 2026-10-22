const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isAdmin, maybeAuthenticated, isAdminOrOwner } = require('../middleware/authMiddleware');
const { limiterStrict, registrationLimiter, passwordResetLimiter, apiLimiter } = require('../middleware/rateLimiters');
const {
    loginValidation,
    registerValidation,
    changePasswordValidation,
    resetPasswordValidation
} = require('../middleware/validationMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/login', maybeAuthenticated, loginValidation, asyncHandler(authController.login));
router.post('/api/login', maybeAuthenticated, loginValidation, asyncHandler(authController.login));
router.get(['/login', '/api/login'], (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Authentication service active. Use POST /api/login to authenticate.' });
});

router.post('/register', maybeAuthenticated, registrationLimiter, registerValidation, asyncHandler(authController.register));
router.post('/api/register', maybeAuthenticated, registrationLimiter, registerValidation, asyncHandler(authController.register));

router.get('/verify-email', maybeAuthenticated, asyncHandler(authController.verifyEmail));
router.get('/api/verify-email', maybeAuthenticated, asyncHandler(authController.verifyEmail));

router.all(['/logout', '/api/logout'], maybeAuthenticated, asyncHandler(authController.logout));

router.post('/change-password', isAuthenticated, limiterStrict, changePasswordValidation, asyncHandler(authController.changePassword));
router.post('/api/change-password', isAuthenticated, limiterStrict, changePasswordValidation, asyncHandler(authController.changePassword));

router.post('/forgot-password', maybeAuthenticated, passwordResetLimiter, asyncHandler(authController.forgotPassword));
router.post('/api/forgot-password', maybeAuthenticated, passwordResetLimiter, asyncHandler(authController.forgotPassword));

router.post('/reset-password', maybeAuthenticated, passwordResetLimiter, resetPasswordValidation, asyncHandler(authController.resetPassword));
router.post('/api/reset-password', maybeAuthenticated, passwordResetLimiter, resetPasswordValidation, asyncHandler(authController.resetPassword));

// Specialized/Admin routes
router.post('/admin/login-as/:userId(*)', isAuthenticated, isAdminOrOwner, limiterStrict, asyncHandler(authController.impersonateUser));
router.post('/api/admin/login-as/:userId(*)', isAuthenticated, isAdminOrOwner, limiterStrict, asyncHandler(authController.impersonateUser));
router.get(['/admin/login-as/:userId(*)', '/api/admin/login-as/:userId(*)'], (req, res) => {
    res.status(405).json({ error: 'Method Not Allowed', message: 'Use POST to impersonate a user.' });
});

// Demo access (public – no auth cookie required, rate-limited to prevent brute-force)
router.get('/demo-access/:token', maybeAuthenticated, apiLimiter, asyncHandler(authController.demoAccess));

module.exports = router;
