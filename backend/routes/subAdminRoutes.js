const express = require('express');
const router = express.Router();
const sub = require('../controllers/subAdminController');
const admin = require('../controllers/adminSubAdminController');
const activation = require('../controllers/activationController');
const { isAuthenticated, isAdmin, isSubAdmin, requireSubAdminWritable } = require('../middleware/authMiddleware');
const { apiLimiter, limiterStrict, subAdminWriteLimiter } = require('../middleware/rateLimiters');
const { asyncHandler } = require('../middleware/errorHandler');

// ── Public, token-protected activation (the link only opens a page; activation is this POST) ──
router.get('/api/activation-info', apiLimiter, asyncHandler(activation.customerActivationInfo));
router.post('/api/activate', limiterStrict, asyncHandler(activation.activateCustomer));
router.get('/api/subadmin/activation-info', apiLimiter, asyncHandler(activation.subAdminActivationInfo));
router.post('/api/subadmin/activate', limiterStrict, asyncHandler(activation.activateSubAdmin));
router.post('/api/confirm-email-change', limiterStrict, asyncHandler(activation.confirmEmailChange));

// ── Any logged-in customer ──
router.get('/api/users/me/provider', isAuthenticated, asyncHandler(activation.myProvider));
router.post('/api/users/me/report-provider', isAuthenticated, apiLimiter, asyncHandler(activation.reportProvider));

// ── Sub-admin (own customers only) ──
const S = [isAuthenticated, isSubAdmin];
const W = [isAuthenticated, isSubAdmin, requireSubAdminWritable, subAdminWriteLimiter];
router.get('/api/subadmin/me', ...S, asyncHandler(sub.me));
router.put('/api/subadmin/me/payment-details', ...S, subAdminWriteLimiter, asyncHandler(sub.updatePaymentDetails));
router.get('/api/subadmin/pricing/quote', ...S, asyncHandler(sub.quote));
router.get('/api/subadmin/users', ...S, asyncHandler(sub.listUsers));
router.post('/api/subadmin/users', ...W, asyncHandler(sub.createUser));
router.get('/api/subadmin/users/:userId(*)/history', ...S, asyncHandler(sub.getUserHistory));
router.post('/api/subadmin/users/:userId(*)/resend-activation', ...W, asyncHandler(sub.resendActivation));
router.patch('/api/subadmin/users/:userId(*)/profile', ...W, asyncHandler(sub.updateProfile));
router.put('/api/subadmin/users/:userId(*)/assignment', ...W, asyncHandler(sub.updateAssignment));
router.post('/api/subadmin/users/:userId(*)/renew', ...W, asyncHandler(sub.renew));
router.post('/api/subadmin/users/:userId(*)/suspend', ...W, asyncHandler(sub.suspend));
router.post('/api/subadmin/users/:userId(*)/reactivate', ...W, asyncHandler(sub.reactivate));
router.get('/api/subadmin/users/:userId(*)', ...S, asyncHandler(sub.getUser));
router.post('/api/subadmin/requests', ...W, asyncHandler(sub.createRequest));
router.get('/api/subadmin/requests', ...S, asyncHandler(sub.listRequests));
router.get('/api/subadmin/today', ...S, asyncHandler(sub.today));
router.get('/api/subadmin/bills', ...S, asyncHandler(sub.listBills));
router.get('/api/subadmin/bills/:id', ...S, asyncHandler(sub.getBill));
router.get('/api/subadmin/payments', ...S, asyncHandler(sub.listPayments));
router.get('/api/subadmin/stats', ...S, asyncHandler(sub.stats));

// ── Admin console ──
const A = [isAuthenticated, isAdmin];
router.get('/api/admin/subadmins', ...A, asyncHandler(admin.list));
router.post('/api/admin/subadmins', ...A, asyncHandler(admin.create));
router.get('/api/admin/subadmins-overview', ...A, asyncHandler(admin.overview));
router.get('/api/admin/subadmins-rankings', ...A, asyncHandler(admin.rankings));
router.post('/api/admin/subadmins/promote/:userId(*)', ...A, asyncHandler(admin.promote));
router.get('/api/admin/subadmins/:userId/events', ...A, asyncHandler(admin.events));
// Admin: the same statistics a sub-admin sees on their dashboard (performance charts).
router.get('/api/admin/subadmins/:userId/stats', ...A, asyncHandler(async (req, res) => {
    const sa = await require('../models/SubAdmin').findOne({ userId: req.params.userId });
    if (!sa) return res.status(404).json({ message: 'Sub-admin not found' });
    req.subAdmin = sa;
    return sub.stats(req, res);
}));
router.get('/api/admin/subadmins/:userId/bills', ...A, asyncHandler(admin.bills));
router.post('/api/admin/subadmins/:userId/payments', ...A, asyncHandler(admin.recordPayment));
router.post('/api/admin/subadmins/:userId/correct-balance', ...A, asyncHandler(admin.correctBalance));
router.put('/api/admin/subadmins/:userId/payment-details', ...A, asyncHandler(admin.setPaymentDetails));
router.post('/api/admin/subadmins/:userId/disable', ...A, asyncHandler(admin.disable));
router.post('/api/admin/subadmins/:userId/enable', ...A, asyncHandler(admin.enable));
router.post('/api/admin/subadmins/:userId/restore', ...A, asyncHandler(admin.restore));
router.post('/api/admin/subadmins/:userId/resend-activation', ...A, asyncHandler(admin.resendActivation));
router.get('/api/admin/subadmins/:userId', ...A, asyncHandler(admin.detail));
router.patch('/api/admin/subadmins/:userId', ...A, asyncHandler(admin.update));
router.get('/api/admin/subadmin-bills/:billId', ...A, asyncHandler(admin.billLines));
router.post('/api/admin/subadmin-payments/:paymentId/reverse', ...A, asyncHandler(admin.reversePayment));
router.put('/api/admin/subadmin-payments/:paymentId', ...A, asyncHandler(admin.editPayment));
router.put('/api/admin/subadmins/:userId/bill-lines/:eventId', ...A, asyncHandler(admin.editBillLine));
router.post('/api/admin/users/assign', ...A, asyncHandler(admin.assignUsers));
router.get('/api/admin/subadmin-requests', ...A, asyncHandler(admin.listRequests));
router.post('/api/admin/subadmin-requests/:id/approve', ...A, asyncHandler(admin.approveRequest));
router.post('/api/admin/subadmin-requests/:id/reject', ...A, asyncHandler(admin.rejectRequest));
router.get('/api/admin/pricing', ...A, asyncHandler(admin.getPricing));
router.put('/api/admin/pricing', ...A, asyncHandler(admin.savePricing));
router.get('/api/admin/pricing/versions', ...A, asyncHandler(admin.pricingVersions));
router.post('/api/admin/pricing/versions/:version/restore', ...A, asyncHandler(admin.restorePricing));
router.get('/api/admin/payment-details', ...A, asyncHandler(admin.getAdminPaymentDetails));
router.put('/api/admin/payment-details', ...A, asyncHandler(admin.setAdminPaymentDetails));
router.get('/api/admin/subadmin-policy', ...A, asyncHandler(admin.getPolicy));
router.put('/api/admin/subadmin-policy', ...A, asyncHandler(admin.setPolicy));

module.exports = router;
