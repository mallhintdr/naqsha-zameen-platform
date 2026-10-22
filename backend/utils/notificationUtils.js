const User = require('../models/User');
const Notification = require('../models/Notification');
const socketService = require('../services/socketService');
const pushService = require('../services/pushNotificationService');
const { getQueues } = require('../services/queueService');
const logger = require('./logger');

/**
 * Sends a notification to a user via Socket.io and Web Push, 
 * and persists it to their notification history in MongoDB.
 * 
 * PERF-06: Uses atomic $push with $slice instead of loading full document.
 * PERF-08: Uses Promise.allSettled for parallel push sends.
 */
const sendNotification = async (userId, { type, title, message, action, replyTo, details }) => {
    try {
        // 1. Persist to MongoDB
        const created = await Notification.create({
            userId,
            type,
            title,
            message,
            read: false,
            ...(action ? { action } : {}),
            ...(replyTo ? { replyTo } : {}),
            ...(details ? { details } : {})
        });

        const notification = {
            id: created._id.toString(),
            type,
            title,
            message,
            timestamp: created.createdAt || new Date(),
            read: false,
            ...(action ? { action, actionDone: false } : {}),
            ...(replyTo ? { replyTo } : {}),
            ...(details ? { details } : {})
        };

        // 2. Emit via Socket.io (Real-time)
        socketService.emitNotification(userId, notification);

        // 3. Send via Web Push (Background)
        // Only fetch push subscriptions if needed
        const user = await User.findOne({ userId })
            .select('pushSubscriptions')
            .lean();

        if (user && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
            const pushPayload = {
                title,
                body: message,
                tag: notification.id,
                data: {
                    url: (action && action.url) || '/', // tapping the notification opens the request
                    notificationId: notification.id
                }
            };

            const queues = getQueues();
            if (queues && queues.pushQueue) {
                // Enqueue jobs
                for (const sub of user.pushSubscriptions) {
                    await queues.pushQueue.add('push', { sub, payload: pushPayload, userId });
                }
            } else {
                // Fallback to inline
                const results = await Promise.allSettled(
                    user.pushSubscriptions.map(sub =>
                        pushService.sendPushNotification(sub, pushPayload)
                    )
                );

                // Cleanup invalid subscriptions
                const invalidEndpoints = [];
                results.forEach((result, idx) => {
                    if (result.status === 'fulfilled' && result.value === false) {
                        invalidEndpoints.push(user.pushSubscriptions[idx].endpoint);
                    }
                });

                if (invalidEndpoints.length > 0) {
                    await User.updateOne(
                        { userId },
                        { $pull: { pushSubscriptions: { endpoint: { $in: invalidEndpoints } } } }
                    );
                }
            }
        }

        return notification;
    } catch (error) {
        logger.error('Error sending notification:', { error: error.message, stack: error.stack });
    }
};

/**
 * Broadcasts a notification to all admin users.
 */
const notifyAdmins = async ({ type = 'info', title, message, action, replyTo, details }) => {
    try {
        const admins = await User.find({ userType: 'admin' }).select('userId').lean();
        if (!admins || admins.length === 0) return [];

        // Broadcast to admins socket room for immediate delivery to any connected admin
        socketService.emitToAdmins({
            type,
            title,
            message,
            timestamp: new Date(),
            read: false,
            ...(action ? { action, actionDone: false } : {}),
            ...(replyTo ? { replyTo } : {}),
            ...(details ? { details } : {})
        });

        return await Promise.allSettled(
            admins.map(admin => sendNotification(admin.userId, { type, title, message, action, replyTo, details }))
        );
    } catch (err) {
        logger.error('notifyAdmins error:', { error: err.message, stack: err.stack });
        return [];
    }
};

/**
 * Hide the action button of every notification for a request once it is decided
 * (approved / rejected / renewed / cancelled). kind: 'renewal' | 'assignment'.
 */
const completeActions = async (kind, ref) => {
    try {
        if (!kind || !ref) return;
        await Notification.updateMany({ 'action.kind': kind, 'action.ref': String(ref), actionDone: { $ne: true } }, { $set: { actionDone: true } });
    } catch (err) {
        logger.error('completeActions error:', { error: err.message });
    }
};

module.exports = { sendNotification, notifyAdmins, completeActions };
