const { Queue, Worker } = require('bullmq');
const { getRedisClient } = require('./redisClient');
const logger = require('../utils/logger');
const { JOBS_ENABLED } = require('../utils/siteConfig');

const initQueue = () => {
    const redisClient = getRedisClient();
    if (!redisClient) {
        logger.warn('Redis client not available, BullMQ queues will not be initialized');
        return null;
    }

    // Queues can share a connection as they are non-blocking
    const queueConnection = redisClient.duplicate({ maxRetriesPerRequest: null });
    queueConnection.on('error', () => {});

    const emailQueue = new Queue('email', { connection: queueConnection });
    const pushQueue = new Queue('push', { connection: queueConnection });
    const tasksQueue = new Queue('tasks', { connection: queueConnection });


    // Suppress raw connection errors from BullMQ instances to prevent log spam when Redis is down
    const suppressErr = (err) => {
        if (err && err.code === 'ECONNREFUSED') return;
        logger.error('Queue error detected:', err);
    };
    emailQueue.on('error', suppressErr);
    pushQueue.on('error', suppressErr);
    tasksQueue.on('error', suppressErr);

    // JOBS_ENABLED=false (parallel test copy): this process only adds jobs; the
    // production process consumes them and owns the repeatable schedules.
    if (JOBS_ENABLED) {
        // Each worker needs a dedicated connection because they perform blocking operations
        const emailWorkerConnection = redisClient.duplicate({ maxRetriesPerRequest: null });
        emailWorkerConnection.on('error', () => {});

        const emailWorker = new Worker('email', async job => {
            const { type, data } = job.data;
            if (type === 'resetPassword') {
                const { _sendResetEmail } = require('../utils/emailUtils');
                await _sendResetEmail(data.toEmail, data.userId, data.token, data.temporaryPassword);
            } else if (type === 'otp') {
                const { _sendOtpEmail } = require('../utils/emailUtils');
                await _sendOtpEmail(data.toEmail, data.userName, data.otp);
            } else if (type === 'verifyEmail') {
                const { _sendVerificationEmail } = require('../utils/emailUtils');
                await _sendVerificationEmail(data.toEmail, data.userName, data.token);
            }
        }, { connection: emailWorkerConnection });

        const pushWorkerConnection = redisClient.duplicate({ maxRetriesPerRequest: null });
        pushWorkerConnection.on('error', () => {});

        const pushWorker = new Worker('push', async job => {
            const pushService = require('./pushNotificationService');
            const User = require('../models/User');
            const { sub, payload, userId } = job.data;
        
            const success = await pushService.sendPushNotification(sub, payload);
            if (success === false) {
                // Remove invalid endpoint
                await User.updateOne(
                    { userId },
                    { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } }
                );
            }
        }, { connection: pushWorkerConnection, concurrency: 10 });

        const tasksWorkerConnection = redisClient.duplicate({ maxRetriesPerRequest: null });
        tasksWorkerConnection.on('error', () => {});

        const tasksWorker = new Worker('tasks', async job => {
            if (job.name === 'cleanup') {
                const dbHygiene = require('../utils/dbHygiene');
                await dbHygiene.runCleanupTasks();
            } else if (job.name === 'flushHeartbeats') {
                const { flushHeartbeats } = require('../controllers/profileController');
                await flushHeartbeats();
            } else if (job.name === 'multiDeviceWarnings') {
                await require('./multiDeviceWarnings').runMultiDeviceWarnings();
            } else if (job.name.startsWith('subadmin:')) {
                const jobs = require('./subAdminJobs');
                const fn = { 'subadmin:closeBills': jobs.closeBills, 'subadmin:dailyEmails': jobs.dailyEmails, 'subadmin:reminders': jobs.reminders, 'subadmin:creditChecks': jobs.creditChecks }[job.name];
                if (fn) await fn();
            }
        }, { connection: tasksWorkerConnection });

        emailWorker.on('failed', (job, err) => logger.error(`Email job ${job.id} failed:`, err));
        pushWorker.on('failed', (job, err) => logger.error(`Push job ${job.id} failed:`, err));
        tasksWorker.on('failed', (job, err) => logger.error(`Task job ${job.name} failed:`, err));
        emailWorker.on('error', suppressErr);
        pushWorker.on('error', suppressErr);
        tasksWorker.on('error', suppressErr);

        // Schedule repeatable jobs
        tasksQueue.add('cleanup', {}, {
            repeat: {
                pattern: '0 0 * * *' // Every day at midnight
            }
        });

        tasksQueue.add('flushHeartbeats', {}, {
            repeat: {
                every: 60000 // Every 60 seconds
            }
        });

        // Sub-admin billing (Asia/Karachi times). Each job is idempotent.
        tasksQueue.add('subadmin:closeBills', {}, { repeat: { pattern: '0 0 * * *', tz: 'Asia/Karachi' } });
        tasksQueue.add('multiDeviceWarnings', {}, { repeat: { pattern: '0 11 * * *', tz: 'Asia/Karachi' } });
        tasksQueue.add('subadmin:dailyEmails', {}, { repeat: { pattern: '10 0 * * *', tz: 'Asia/Karachi' } });
        tasksQueue.add('subadmin:reminders', {}, { repeat: { pattern: '0 10 * * *', tz: 'Asia/Karachi' } });
        tasksQueue.add('subadmin:creditChecks', {}, { repeat: { pattern: '5 * * * *', tz: 'Asia/Karachi' } });

        // NOTE: the admin operations report is no longer auto-scheduled — it's
        // generated on demand from Admin > Operations Report (a date-range tool)
        // via POST /api/admin/reports/generate, which calls runReportForRange()
        // in dailyReportJob.js directly.

    }
    logger.info(`BullMQ Job queue initialized (workers ${JOBS_ENABLED ? 'ON' : 'OFF'})`);

    return { emailQueue, pushQueue, tasksQueue };
};

// Singleton
let queues = null;

const getQueues = () => {
    if (!queues) {
        queues = initQueue();
    }
    return queues;
};

module.exports = {
    getQueues
};
