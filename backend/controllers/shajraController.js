/**
 * Public Shajra Nasab tool API (no login): save / load a case for a share link, the
 * legal-citation data, and a server-rendered PDF of the website's print view.
 * No personal data is logged; cases expire after 30 days (TTL index).
 */
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const logger = require('../utils/logger');
const ShajraCase = require('../models/ShajraCase');
const { SITE_URL } = require('../utils/siteConfig');

const ENGINE_DIR = path.join(__dirname, '../../packages/inheritance-engine');
let enginePromise;
const engine = () => (enginePromise ??= import(pathToFileURL(path.join(ENGINE_DIR, 'src/index.ts')).href));

const MAX_BYTES = 300 * 1024;
const MAX_PERSONS = 400;
const reviveBig = (_k, v) => (v && typeof v === 'object' && '$big' in v ? BigInt(v.$big) : v);
const ID_RE = /^[A-Za-z0-9_-]{8,24}$/;

/** Parses, size-checks and validates a case by running the engine on it. */
async function validateCase(raw) {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (!text || Buffer.byteLength(text) > MAX_BYTES) throw Object.assign(new Error('Case is empty or too large.'), { status: 413 });
    let c;
    try { c = JSON.parse(text, reviveBig); } catch { throw Object.assign(new Error('Invalid case JSON.'), { status: 400 }); }
    if (!c || !Array.isArray(c.persons) || !c.persons.length || c.persons.length > MAX_PERSONS || !Array.isArray(c.parents) || !Array.isArray(c.unions)) {
        throw Object.assign(new Error('Invalid case.'), { status: 400 });
    }
    const { compute } = await engine();
    try { compute(c); } catch (e) { throw Object.assign(new Error(`Case cannot be computed: ${e.message}`), { status: 422 }); }
    return { text, policyVersion: String(c.policy?.policyVersion || '') };
}

const newId = () => crypto.randomBytes(9).toString('base64url'); // 12 chars

// POST /api/public/shajra/cases
exports.saveCase = async (req, res) => {
    try {
        const { text, policyVersion } = await validateCase(req.body?.case);
        const id = newId();
        await ShajraCase.create({ _id: id, data: text, policyVersion });
        res.status(201).json({ id, shareUrl: `${SITE_URL}/tools/shajra-nasab/?case=${id}` });
    } catch (e) {
        if (e.status) return res.status(e.status).json({ message: e.message });
        logger.error('shajra save failed', { error: e.message });
        res.status(500).json({ message: 'Could not save the case.' });
    }
};

// GET /api/public/shajra/cases/:id
exports.getCase = async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ message: 'Invalid id.' });
    const doc = await ShajraCase.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'This link has expired or does not exist.' });
    res.set('Cache-Control', 'no-store');
    res.type('application/json').send(doc.data);
};

// GET /api/public/shajra/law/:policyVersion
exports.law = async (req, res) => {
    try {
        const json = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'law/citations.json'), 'utf8'));
        if (req.params.policyVersion !== json.policyVersion) return res.status(404).json({ message: `Policy version ${req.params.policyVersion} not available (current: ${json.policyVersion}).` });
        res.set('Cache-Control', 'public, max-age=3600');
        res.json(json);
    } catch (e) {
        res.status(500).json({ message: 'Law data unavailable.' });
    }
};

// POST /api/public/shajra/pdf  { case } -> application/pdf
// Saves the case (so the PDF carries its share link / QR), opens the website print view
// in Puppeteer and prints it: the same React view and engine as in the browser.
let browserPromise;
const browser = () => (browserPromise ??= require('puppeteer').launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    .catch((e) => { browserPromise = null; throw e; }));

exports.pdf = async (req, res) => {
    let page;
    try {
        const { text, policyVersion } = await validateCase(req.body?.case);
        const id = newId();
        await ShajraCase.create({ _id: id, data: text, policyVersion });
        const b = await browser();
        page = await b.newPage();
        await page.emulateMediaType('print');
        const url = `${process.env.SHAJRA_PRINT_BASE || SITE_URL}/tools/shajra-nasab/?case=${id}&pdf=1`;
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
        await page.waitForSelector('[data-shajra-ready="1"]', { timeout: 20000 });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '12mm', left: '10mm', right: '10mm' } });
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="shajra-${id}.pdf"`, 'X-Shajra-Case': id });
        res.send(Buffer.from(pdf));
    } catch (e) {
        if (e.status) return res.status(e.status).json({ message: e.message });
        logger.error('shajra pdf failed', { error: e.message });
        res.status(500).json({ message: 'Could not create the PDF. Please use Print / Save PDF instead.' });
    } finally {
        if (page) page.close().catch(() => {});
    }
};

exports._validateCase = validateCase;
