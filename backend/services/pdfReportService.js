/**
 * pdfReportService.js
 * Renders an HTML string to a PDF buffer via headless Chromium (Puppeteer).
 * Kept as a single-purpose module so the daily report job (or any future
 * report) can reuse it without depending on Puppeteer directly.
 */
const logger = require('../utils/logger');

async function renderHtmlToPdf(html) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }
        });
        return pdfBuffer;
    } finally {
        await browser.close().catch((e) => logger.warn('Puppeteer close failed:', e.message));
    }
}

module.exports = { renderHtmlToPdf };
