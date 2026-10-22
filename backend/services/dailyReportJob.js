/**
 * dailyReportJob.js
 *
 * Orchestrates the full admin operations-report pipeline for an admin-chosen
 * date range:
 *   aggregate data -> render charts -> build HTML -> render PDF -> email admin
 *
 * Wrapped so that a failure at ANY stage still results in the admin getting
 * a plain-text fallback email with the raw numbers, rather than silence.
 */
const logger = require('../utils/logger');
const { loadLogoBuffer } = require('../utils/logoPath');

async function getLogoBase64() {
    const buf = await loadLogoBuffer();
    if (!buf) {
        logger.warn('Operations report: GeoMatrix logo not found — rendering the PDF without it');
        return '';
    }
    return buf.toString('base64');
}

function buildPlainTextSummary(data, pdfError) {
    const { reportDate, kpis, revenue } = data;
    return [
        ...(pdfError ? [`NOTE: the PDF could not be generated - ${pdfError}`, ''] : []),
        `Operations Report - ${reportDate}`,
        `Active Users: ${kpis.activeUsers}`,
        `New Registrations: ${kpis.newRegistrationsToday}`,
        `Renewals: ${kpis.renewalsToday}`,
        `Expired: ${kpis.expiredToday}`,
        `Revenue: Rs. ${revenue.today}`,
        `Change vs. prior equivalent period: ${revenue.todayChangePct}%`
    ].join('\n');
}

/**
 * @param {{ startDate: string, endDate: string }} range 'YYYY-MM-DD' Pakistan
 *   calendar dates, inclusive on both ends.
 * @param {{ recipientEmail?: string }} [opts] optional single-recipient
 *   override (defaults to the usual admin report recipient list).
 */
async function runReportForRange(range, opts = {}) {
    const { getReportData } = require('./dailyReportService');
    const { sendDailyReportEmail } = require('../utils/emailUtils');

    const data = await getReportData(range); // let validation errors (bad dates, range too large) propagate to the caller

    let pdfBuffer = null;
    let pdfError = null;
    try {
        const chartRenderer = require('./chartRenderer');
        const { buildReportHtml } = require('../templates/dailyReportTemplate');
        const { renderHtmlToPdf } = require('./pdfReportService');

        const [revenueImg, registrationsImg, healthImg, tehsilsImg] = await Promise.all([
            chartRenderer.renderRevenueTrendChart(data.revenue.trend30d),
            chartRenderer.renderRegistrationsTrendChart(data.registrationsTrend30d),
            chartRenderer.renderSubscriptionHealthDonut(data.subscriptionHealth),
            chartRenderer.renderTopTehsilsChart(data.topTehsils)
        ]);

        const chartImages = {
            revenue: revenueImg.toString('base64'),
            registrations: registrationsImg.toString('base64'),
            health: healthImg.toString('base64'),
            tehsils: tehsilsImg.toString('base64')
        };

        const html = buildReportHtml(data, chartImages, await getLogoBase64());
        pdfBuffer = await renderHtmlToPdf(html);
    } catch (err) {
        logger.error('Operations report: PDF rendering failed — sending plain-text fallback instead', { error: err.message, stack: err.stack });
        pdfBuffer = null;
        pdfError = String(err.message || err).split('\n')[0].slice(0, 300);
    }

    try {
        await sendDailyReportEmail(pdfBuffer, data.reportDate, buildPlainTextSummary(data, pdfError), opts.recipientEmail);
        logger.info(`Operations report ${pdfBuffer ? '(PDF)' : '(plain-text fallback)'} sent for ${data.reportDate}`);
    } catch (err) {
        logger.error('Operations report: email delivery failed', { error: err.message, stack: err.stack });
        throw err;
    }

    return { reportDate: data.reportDate, pdfGenerated: !!pdfBuffer, pdfError };
}

module.exports = { runReportForRange };
