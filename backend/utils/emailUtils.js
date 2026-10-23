const nodemailer = require('nodemailer');
const { getQueues } = require('../services/queueService');

const logger = require('./logger');

// SEC-06: Singleton transporter with connection pooling
let transporter;
const getTransporter = () => {
    if (!transporter) {
        const port = parseInt(process.env.SMTP_PORT, 10) || 465;
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'mail.naqsha-zameen.pk',
            port: port,
            secure: port === 465, // true for 465, false for 587/other
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
            pool: true,
            maxConnections: 3,
            maxMessages: 100,
        });
    }
    return transporter;
};

const getFrontendUrl = () => require('./siteConfig').APP_URL;

const _sendResetEmail = async (toEmail, userId, token, temporaryPassword = null) => {
    let subject, html;

    if (temporaryPassword) {
        // Admin-initiated password reset — send temporary password
        subject = 'Your Password Has Been Reset - Geo Dashboard';
        html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; borderRadius: 8px;">
                <h2 style="color: #212529; text-align: center;">Password Reset by Administrator</h2>
                <p>Hello,</p>
                <p>The password for your account (User ID: <strong>${userId}</strong>) has been reset by an administrator.</p>
                <p>Your temporary password is:</p>
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 6px;">
                    <code style="font-size: 1.2rem; font-weight: bold; color: #0d6efd; letter-spacing: 2px;">${temporaryPassword}</code>
                </div>
                <p style="color: #dc3545; font-weight: bold;">⚠ Please change your password immediately after logging in.</p>
                <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
                <p style="font-size: 12px; color: #6c757d; text-align: center;">This is an automated message, please do not reply.</p>
            </div>
        `;
    } else {
        // User-initiated forgot password — send reset link
        const resetUrl = `${getFrontendUrl()}/reset-password?token=${token}`;
        subject = 'Password Reset Request - Geo Dashboard';
        html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; borderRadius: 8px;">
                <h2 style="color: #212529; text-align: center;">Password Reset Request</h2>
                <p>Hello,</p>
                <p>We received a request to reset the password for your account (User ID: <strong>${userId}</strong>).</p>
                <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="background-color: #0d6efd; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
                </div>
                <p>If you did not request this, please ignore this email or contact support if you have concerns.</p>
                <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
                <p style="font-size: 12px; color: #6c757d; text-align: center;">This is an automated message, please do not reply.</p>
            </div>
        `;
    }

    const mailOptions = {
        from: `"${process.env.FROM_NAME || 'Geo Dashboard'}" <${process.env.FROM_EMAIL}>`,
        to: toEmail,
        subject,
        html,
    };

    await getTransporter().sendMail(mailOptions);
};

const sendResetEmail = async (toEmail, userId, token, temporaryPassword = null) => {
    const queues = getQueues();
    if (queues && queues.emailQueue) {
        await queues.emailQueue.add('resetPassword', { type: 'resetPassword', data: { toEmail, userId, token, temporaryPassword } });
    } else {
        await _sendResetEmail(toEmail, userId, token, temporaryPassword);
    }
};

const _sendOtpEmail = async (toEmail, userName, otp) => {
    const subject = 'Verification Code - Geo Dashboard';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #212529; text-align: center;">Account Verification</h2>
            <p>Hello <strong>${userName}</strong>,</p>
            <p>Your verification code for logging into Geo Dashboard for the first time is:</p>
            <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border: 2px dashed #28a745; border-radius: 6px;">
                <code style="font-size: 2rem; font-weight: bold; color: #28a745; letter-spacing: 5px;">${otp}</code>
            </div>
            <p>This code will expire in 15 minutes. For security, please do not share this code with anyone.</p>
            <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
            <p style="font-size: 12px; color: #6c757d; text-align: center;">This is an automated message, please do not reply.</p>
        </div>
    `;

    const mailOptions = {
        from: `"${process.env.FROM_NAME || 'Geo Dashboard'}" <${process.env.FROM_EMAIL}>`,
        to: toEmail,
        subject,
        html,
    };

    await getTransporter().sendMail(mailOptions);
};

const sendOtpEmail = async (toEmail, userName, otp) => {
    const queues = getQueues();
    if (queues && queues.emailQueue) {
        await queues.emailQueue.add('otp', { type: 'otp', data: { toEmail, userName, otp } });
    } else {
        await _sendOtpEmail(toEmail, userName, otp);
    }
};

const _sendVerificationEmail = async (toEmail, userName, token) => {
    const verificationUrl = `${getFrontendUrl()}/verify-email?token=${token}`;
    const subject = 'Activate Your Account - Geo Dashboard';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #212529; text-align: center;">Account Activation</h2>
            <p>Hello <strong>${userName}</strong>,</p>
            <p>Thank you for registering. Please click the button below to verify your email address and activate your account:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Verify Email & Activate</a>
            </div>
            <p style="font-size: 13px; color: #555;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${verificationUrl}">${verificationUrl}</a></p>
            <p>This verification link will expire in 24 hours.</p>
            <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
            <p style="font-size: 12px; color: #6c757d; text-align: center;">This is an automated message, please do not reply.</p>
        </div>
    `;

    const mailOptions = {
        from: `"${process.env.FROM_NAME || 'Geo Dashboard'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
        to: toEmail,
        subject,
        html,
    };

    try {
        const info = await getTransporter().sendMail(mailOptions);
        logger.info('Verification email sent successfully:', { to: toEmail, messageId: info.messageId });
        return info;
    } catch (err) {
        logger.error('Failed to send verification email:', { to: toEmail, error: err.message, stack: err.stack });
        throw err;
    }
};

const sendVerificationEmail = async (toEmail, userName, token) => {
    const queues = getQueues();
    if (queues && queues.emailQueue) {
        await queues.emailQueue.add('verifyEmail', { type: 'verifyEmail', data: { toEmail, userName, token } });
    } else {
        await _sendVerificationEmail(toEmail, userName, token);
    }
};

/**
 * Generic sender for the sub-admin program's emails (activation links, bills,
 * reminders). Sent directly; callers log and tolerate failures.
 */
const sendHtmlEmail = async ({ to, subject, html, attachments = [] }) => {
    if (!to) throw new Error('No recipient email address');
    return getTransporter().sendMail({
        from: `"${process.env.FROM_NAME || 'GeoMatrix Naqsha Zameen'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
        to,
        subject,
        html,
        attachments
    });
};

/**
 * Sends the daily admin report PDF as an email attachment. Runs synchronously
 * inside the caller (the daily report job is itself already a queued BullMQ
 * task, so there's no need to nest it into the generic email queue).
 * Falls back to a plain-text summary if no PDF buffer is available, so the
 * admin never misses a day's numbers because of a rendering failure upstream.
 */
const sendDailyReportEmail = async (pdfBuffer, reportDate, summaryText, recipientEmail) => {
    const recipients = recipientEmail
        ? [recipientEmail]
        : (process.env.ADMIN_REPORT_EMAIL || 'mallhintdr@gmail.com')
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean);

    const safeFileName = String(reportDate).replace(/[^a-zA-Z0-9-]+/g, '_');
    const mailOptions = {
        from: `"${process.env.FROM_NAME || 'GeoMatrix Naqsha Zameen'}" <${process.env.FROM_EMAIL}>`,
        to: recipients.join(','),
        subject: `Operations Report — ${reportDate}`,
        html: pdfBuffer
            ? `<p>Please find attached the operations report for <strong>${reportDate}</strong>.</p>`
            : `<p><strong>PDF generation failed for ${reportDate}.</strong> Plain-text summary below:</p><pre style="white-space:pre-wrap;">${summaryText || ''}</pre>`,
        attachments: pdfBuffer
            ? [{ filename: `operations-report-${safeFileName}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
            : []
    };

    await getTransporter().sendMail(mailOptions);
};

module.exports = {
    sendResetEmail,
    sendOtpEmail,
    sendVerificationEmail,
    sendDailyReportEmail,
    sendHtmlEmail,
    getFrontendUrl,
    _sendResetEmail,
    _sendOtpEmail,
    _sendVerificationEmail
};
