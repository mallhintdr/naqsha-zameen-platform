/**
 * landInfoBannerRenderer.js
 *
 * Renders the branded "info banner" PNG embedded in each exported KMZ as a
 * KML ScreenOverlay pinned to the top of the Google Earth view — logo,
 * allotment details (Mouza / Murabba No / Killa No / Allottee / CNIC), and a
 * footer credit line. Reuses @napi-rs/canvas, the same dependency already
 * proven working for the daily admin PDF report's chart rendering.
 *
 * Width is measured from the actual content (two-pass: measure on a scratch
 * canvas first, then draw the real one at the computed size) rather than a
 * fixed 1000px canvas — the banner used to carry a lot of empty right-side
 * space once column widths didn't need to stretch to fill an arbitrary width.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const logger = require('../utils/logger');

const BRAND_NAVY = '#1b3a5c';
const BRAND_NAVY_DARK = '#12293f';
const BRAND_LIME = '#8dc63f';
const BRAND_GRAY = '#64748b';
const { loadLogoBuffer } = require('../utils/logoPath');

const MARGIN = 20;
const LOGO_SIZE = 143; // 30% larger than the original 110px
const TITLE_FONT = 'bold 41px "Segoe UI", Arial, sans-serif';
const LABEL_FONT = '600 18px "Segoe UI", Arial, sans-serif';
const VALUE_FONT = 'bold 28px "Segoe UI", Arial, sans-serif';
const FOOTER_FONT = 'bold 22px "Segoe UI", Arial, sans-serif';
const TITLE_TEXT = 'Cholistan AKAR Alottment';
const FOOTER_TEXT = 'GeoMatrix Technologies  ·  Phone# 0314-6796144';
const COL_GAP = 28;
const COL_COUNT = 3;
const ROW_HEIGHT = 60;

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function buildFields(info) {
    return [
        ['Mouza', info.mouza || '-'],
        ['Murabba No', info.murabbaNo || '-'],
        ['Killa No', (info.killaNos || []).join(', ') || '-'],
        ['Allottee', info.allotteeName || '-'],
        ['CNIC', info.cnic || '-']
    ];
}

/** Measures each column's required width (max of its fields' label/value text) on a scratch context. */
function measureColumnWidths(ctx, fields) {
    const colWidths = new Array(COL_COUNT).fill(0);
    fields.forEach(([label, value], i) => {
        const col = i % COL_COUNT;
        ctx.font = LABEL_FONT;
        const labelW = ctx.measureText(label.toUpperCase()).width;
        ctx.font = VALUE_FONT;
        const valueW = ctx.measureText(String(value)).width;
        colWidths[col] = Math.max(colWidths[col], labelW, valueW);
    });
    return colWidths;
}

/**
 * @param {{ mouza: string, murabbaNo: string, killaNos: string[], allotteeName: string, cnic: string }} info
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>} PNG buffer + its pixel dimensions
 *   (dimensions are returned so the KML ScreenOverlay can specify an explicit
 *   width+height fraction instead of relying on auto/aspect-locked scaling,
 *   which Google Earth's mobile app does not reliably honor for a wide,
 *   short-aspect image like this banner — see kmzBuilderService.js).
 */
async function renderLandInfoBanner(info) {
    const fields = buildFields(info);

    // ── Pass 1: measure on a small scratch canvas to compute the real width ──
    const scratch = createCanvas(10, 10).getContext('2d');
    const colWidths = measureColumnWidths(scratch, fields);
    scratch.font = TITLE_FONT;
    const titleWidth = scratch.measureText(TITLE_TEXT).width;
    scratch.font = FOOTER_FONT;
    const footerWidth = scratch.measureText(FOOTER_TEXT).width;

    const textX = MARGIN + LOGO_SIZE + 18;
    const gridWidth = colWidths.reduce((a, b) => a + b, 0) + COL_GAP * (COL_COUNT - 1);
    const contentWidth = Math.max(gridWidth, titleWidth, footerWidth - textX + MARGIN);
    const WIDTH = Math.round(textX + contentWidth + MARGIN);
    const HEIGHT = 250;

    // ── Pass 2: draw at the now-known, content-fitted size ──
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Card background
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, WIDTH, HEIGHT, 14);
    ctx.fill();
    ctx.strokeStyle = '#d0d7e2';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 14);
    ctx.stroke();

    // Left accent bar
    ctx.fillStyle = BRAND_LIME;
    ctx.fillRect(0, 0, 8, HEIGHT);

    // Logo
    try {
        const logoBuffer = await loadLogoBuffer();
        if (!logoBuffer) throw new Error('logo unavailable');
        const logo = await loadImage(logoBuffer);
        ctx.drawImage(logo, MARGIN, 14, LOGO_SIZE, LOGO_SIZE);
    } catch (e) {
        logger.warn('landInfoBannerRenderer: failed to load GeoMatrix logo', { error: e.message });
    }

    // Title
    ctx.fillStyle = BRAND_NAVY_DARK;
    ctx.font = TITLE_FONT;
    ctx.fillText(TITLE_TEXT, textX, 42);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(textX, 56);
    ctx.lineTo(WIDTH - MARGIN, 56);
    ctx.stroke();

    // Field grid — each column only as wide as its own content needs
    const colX = [textX];
    for (let c = 1; c < COL_COUNT; c++) {
        colX.push(colX[c - 1] + colWidths[c - 1] + COL_GAP);
    }
    fields.forEach(([label, value], i) => {
        const col = i % COL_COUNT;
        const row = Math.floor(i / COL_COUNT);
        const x = colX[col];
        const y = 86 + row * ROW_HEIGHT;
        ctx.fillStyle = BRAND_GRAY;
        ctx.font = LABEL_FONT;
        ctx.fillText(label.toUpperCase(), x, y);
        ctx.fillStyle = BRAND_NAVY_DARK;
        ctx.font = VALUE_FONT;
        ctx.fillText(String(value), x, y + 28);
    });

    // Footer credit bar
    const footerH = 44;
    ctx.fillStyle = BRAND_NAVY;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT - footerH);
    ctx.lineTo(WIDTH, HEIGHT - footerH);
    ctx.lineTo(WIDTH, HEIGHT - 14);
    ctx.arcTo(WIDTH, HEIGHT, WIDTH - 14, HEIGHT, 14);
    ctx.lineTo(14, HEIGHT);
    ctx.arcTo(0, HEIGHT, 0, HEIGHT - 14, 14);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = FOOTER_FONT;
    ctx.textAlign = 'center';
    ctx.fillText(FOOTER_TEXT, WIDTH / 2, HEIGHT - footerH / 2 + 7);
    ctx.textAlign = 'left';

    return { buffer: canvas.toBuffer('image/png'), width: WIDTH, height: HEIGHT };
}

module.exports = { renderLandInfoBanner };
