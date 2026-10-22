const logger = require('../utils/logger');

/**
 * POST /api/admin/reports/generate
 * Body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * Generates the operations-report PDF for the given (Pakistan-calendar,
 * inclusive) date range and emails it to the admin report recipient(s).
 * Runs synchronously and responds once the email has been sent/attempted —
 * a range spanning many months can take a while (chart rendering + PDF).
 */
exports.generate = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate are required (YYYY-MM-DD).' });
        }

        const { runReportForRange } = require('../services/dailyReportJob');
        const result = await runReportForRange({ startDate, endDate }, { recipientEmail: req.user?.email });

        res.json({
            message: result.pdfGenerated
                ? `Report generated and emailed for ${result.reportDate}.`
                : `PDF generation failed (${result.pdfError}); a plain-text summary was emailed instead for ${result.reportDate}.`,
            ...result
        });
    } catch (error) {
        logger.error('reportController.generate error:', { error: error.message, stack: error.stack });
        // Validation errors (bad/missing dates, range too large) vs. unexpected failures
        const isValidationError = /required|Invalid date|must be on or after|too large/.test(error.message || '');
        res.status(isValidationError ? 400 : 500).json({ message: error.message || 'Failed to generate report' });
    }
};
