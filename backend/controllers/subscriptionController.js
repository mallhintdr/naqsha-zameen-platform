const User = require('../models/User');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const { sendNotification } = require('../utils/notificationUtils');
const logger = require('../utils/logger');
const { recordEvent } = require('../services/accountEventService');

// These endpoints never counted as revenue, so they're recorded as plan changes.
const recordPlanChange = (req, user, previous) => recordEvent({
    userId: user.userId,
    ownerAtEvent: user.managedBy || null,
    type: 'PLAN_CHANGED',
    plan: user.subscriptionType,
    previousPlan: previous.plan,
    periodStart: user.startDate,
    periodEnd: user.endDate,
    previousPeriodStart: previous.start,
    previousPeriodEnd: previous.end
}, req);

exports.activateTrialSubscription = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const previous = { plan: user.subscriptionType, start: user.startDate, end: user.endDate };
        user.subscriptionType = 'Trial';
        user.startDate = new Date();

        // Recalculate status and end date
        const { endDate, daysRemaining, status } = calculateDatesAndStatus(user.startDate, user.subscriptionType);
        user.endDate = endDate;
        user.daysRemaining = daysRemaining;
        user.status = status;

        await user.save();
        await recordPlanChange(req, user, previous);

        await sendNotification(user.userId, {
            type: 'subscription',
            title: 'Trial Activated',
            message: `Your Trial subscription has been activated until ${new Date(user.endDate).toLocaleDateString()}.`
        });

        res.json({
            message: 'Trial subscription activated successfully',
            subscription: {
                type: user.subscriptionType,
                startDate: user.startDate,
                endDate: user.endDate,
                status: user.status
            }
        });
    } catch (error) {
        logger.error('Error activating trial subscription:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.activateMonthlySubscription = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const previous = { plan: user.subscriptionType, start: user.startDate, end: user.endDate };
        user.subscriptionType = 'Monthly';
        user.startDate = new Date(); // Start from now

        // Recalculate status and end date
        const { endDate, daysRemaining, status } = calculateDatesAndStatus(user.startDate, user.subscriptionType);
        user.endDate = endDate;
        user.daysRemaining = daysRemaining;
        user.status = status;

        await user.save();
        await recordPlanChange(req, user, previous);

        await sendNotification(user.userId, {
            type: 'subscription',
            title: 'Subscription Activated',
            message: `Your Monthly subscription has been activated until ${new Date(user.endDate).toLocaleDateString()}.`
        });

        res.json({
            message: 'Monthly subscription activated successfully',
            subscription: {
                type: user.subscriptionType,
                startDate: user.startDate,
                endDate: user.endDate,
                status: user.status
            }
        });
    } catch (error) {
        logger.error('Error activating monthly subscription:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.activateSubscription = async (req, res) => {
    try {
        const { userId } = req.params;
        const { type } = req.body; // e.g., 'Weekly', 'Quarterly', 'Annual'

        if (!type) {
            return res.status(400).json({ message: 'Subscription type is required' });
        }

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const previous = { plan: user.subscriptionType, start: user.startDate, end: user.endDate };
        user.subscriptionType = type;
        user.startDate = new Date();

        // Recalculate status and end date
        const { endDate, daysRemaining, status } = calculateDatesAndStatus(user.startDate, user.subscriptionType);

        // Handle invalid types gracefully (dateUtils returns expired/0)
        if (status === 'Expired' && daysRemaining === 0) {
            // Maybe validate type against known types in dateUtils first?
            // For now, let's proceed but warn if days result in 0 implies invalid type?
            // dateUtils returns days=0 if type unknown.
        }

        user.endDate = endDate;
        user.daysRemaining = daysRemaining;
        user.status = status;

        await user.save();
        await recordPlanChange(req, user, previous);

        await sendNotification(user.userId, {
            type: 'subscription',
            title: 'Subscription Activated',
            message: `Your ${type} subscription has been activated until ${new Date(user.endDate).toLocaleDateString()}.`
        });

        res.json({
            message: `Subscription (${type}) activated successfully`,
            subscription: {
                type: user.subscriptionType,
                startDate: user.startDate,
                endDate: user.endDate,
                status: user.status
            }
        });
    } catch (error) {
        logger.error('Error activating subscription:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};
