/**
 * pdfReportService.js
 * Renders an HTML string to a PDF buffer via headless Chromium (Puppeteer).
 * Kept as a single-purpose module so the daily report job (or any future
 * report) can reuse it without depending on Puppeteer directly.
 */
const logger = require('../utils/logger');

let activeReportRenders = 0;
const MAX_CONCURRENT_REPORTS = 2;

async function renderHtmlToPdf(html) {
    if (activeReportRenders >= MAX_CONCURRENT_REPORTS) {
        const err = new Error('Report generator is busy. Please try again in a moment.');
        err.statusCode = 429;
        throw err;
    }
    activeReportRenders++;
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (url.startsWith('data:') || url.startsWith('about:')) {
                req.continue();
            } else {
                req.abort();
            }
        });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }
        });
        return pdfBuffer;
    } finally {
        activeReportRenders--;
        await browser.close().catch((e) => logger.warn('Puppeteer close failed:', e.message));
    }
}

module.exports = { renderHtmlToPdf };
