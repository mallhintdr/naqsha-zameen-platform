// Payment proofs: optional screenshot and/or SMS text attached to a payment.
// Files are stored on the server's disk (never served statically) and are only
// streamed back to the admin, or to the sub-admin the payment belongs to.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PaymentProof = require('../models/PaymentProof');
const SubAdminPayment = require('../models/SubAdminPayment');
const AccountEvent = require('../models/AccountEvent');
const User = require('../models/User');
const logger = require('../utils/logger');

// Where screenshots live. Override with PAYMENT_PROOF_DIR on the VPS if needed;
// include this folder in backups.
const PROOF_DIR = path.resolve(process.env.PAYMENT_PROOF_DIR || path.join(__dirname, '..', 'uploads', 'payment-proofs'));
const MAX_BYTES = 3 * 1024 * 1024; // after decoding; the browser compresses well below this

// Only real images, checked by their first bytes (not by what the browser claims).
const SIGNATURES = [
    { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' }
];

class ProofError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (res, err) => {
    if (err instanceof ProofError) return res.status(err.status).json({ message: err.message });
    logger.error('paymentProof error', { error: err.message, stack: err.stack });
    return res.status(500).json({ message: 'Could not save the payment proof.' });
};
const clean = (v, max) => String(v || '').trim().slice(0, max);

function decodeImage(dataUrl) {
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new ProofError('The screenshot must be a JPG, PNG or WebP image.');
    const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (!buf.length) throw new ProofError('The screenshot is empty.');
    if (buf.length > MAX_BYTES) throw new ProofError('The screenshot is too large (max 3 MB).');
    const sig = SIGNATURES.find(s => s.test(buf));
    if (!sig) throw new ProofError('That file is not a valid image.');
    return { buf, ...sig };
}

async function saveFile(img) {
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(PROOF_DIR, month);
    await fs.promises.mkdir(dir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${img.ext}`;
    await fs.promises.writeFile(path.join(dir, name), img.buf, { flag: 'wx' });
    return { path: `${month}/${name}`, mime: img.mime, size: img.buf.length };
}

// Can this user see / attach proof for this payment?
async function authorise(req, { kind, refId, userId, attachToLatest }) {
    const me = req.user;
    const isAdmin = me.userType === 'admin';
    if (kind === 'subadmin_payment') {
        const p = await SubAdminPayment.findById(refId).lean().catch(() => null);
        if (!p) throw new ProofError('Payment not found.', 404);
        if (!isAdmin) throw new ProofError('Only the admin records sub-admin payments.', 403);
        return { refId: String(p._id), subAdminId: p.subAdminId, userId: null };
    }
    if (kind === 'renewal') {
        const u = await User.findOne({ userId: String(userId || '') }).select('userId managedBy').lean();
        if (!u) throw new ProofError('User not found.', 404);
        if (!isAdmin && !(me.userType === 'subadmin' && u.managedBy === me.userId)) throw new ProofError('Not allowed.', 403);
        // Link to the given renewal event, or to this customer's latest renewal (the one just saved).
        let ev = null;
        if (refId) ev = await AccountEvent.findOne({ _id: refId, userId: u.userId, type: 'RENEWED' }).select('_id').lean().catch(() => null);
        if (!ev) {
            // attachToLatest: proof added later to an existing renewal (no new renewal is
            // created) -> link to the most recent renewal whatever its age.
            // Otherwise: only a renewal saved just now (within 30 min) counts.
            const q = { userId: u.userId, type: 'RENEWED' };
            if (!attachToLatest) q.createdAt = { $gte: new Date(Date.now() - 30 * 60 * 1000) };
            ev = await AccountEvent.findOne(q).sort({ createdAt: -1 }).select('_id').lean();
            if (attachToLatest && !ev) throw new ProofError('This customer has no renewal yet to attach the proof to.');
        }
        return { refId: ev ? String(ev._id) : null, userId: u.userId, subAdminId: u.managedBy || null };
    }
    throw new ProofError('Unknown payment type.');
}

/** POST /api/payment-proofs  { kind, refId?, userId?, image?: dataURL, smsText?, note? } — all evidence optional, at least one needed. */
exports.create = async (req, res) => {
    try {
        const b = req.body || {};
        const smsText = clean(b.smsText, 2000);
        const note = clean(b.note, 1000);
        if (!b.image && !smsText && !note) throw new ProofError('Add a screenshot, SMS text or a note.');
        const link = await authorise(req, { kind: b.kind, refId: b.refId, userId: b.userId, attachToLatest: b.attachToLatest === true });
        const file = b.image ? await saveFile(decodeImage(b.image)) : undefined;
        const proof = await PaymentProof.create({
            kind: b.kind, ...link, file, smsText: smsText || undefined, note: note || undefined,
            uploadedBy: req.user.userId, uploaderRole: req.user.userType
        });
        res.status(201).json({ message: 'Payment proof saved.', proof: { ...proof.toObject(), file: proof.file?.path ? { mime: proof.file.mime, size: proof.file.size } : undefined } });
    } catch (err) { fail(res, err); }
};

/** GET /api/payment-proofs?kind=&refId=&userId=&subAdminId= */
exports.list = async (req, res) => {
    try {
        const me = req.user;
        const q = {};
        if (req.query.kind) q.kind = String(req.query.kind);
        if (req.query.refId) q.refId = { $in: String(req.query.refId).split(',').slice(0, 200) };
        if (req.query.userId) q.userId = String(req.query.userId);
        if (req.query.subAdminId) q.subAdminId = String(req.query.subAdminId);
        if (me.userType === 'subadmin') q.subAdminId = me.userId;           // only their own
        else if (me.userType !== 'admin') return res.status(403).json({ message: 'Not allowed.' });
        const rows = await PaymentProof.find(q).sort({ createdAt: -1 }).limit(500).lean();
        res.json({ proofs: rows.map(p => ({ ...p, file: p.file?.path ? { mime: p.file.mime, size: p.file.size } : undefined })) });
    } catch (err) { fail(res, err); }
};

/** GET /api/payment-proofs/:id/file — streams the screenshot to an allowed viewer. */
exports.file = async (req, res) => {
    try {
        const p = await PaymentProof.findById(req.params.id).lean().catch(() => null);
        if (!p || !p.file?.path) return res.status(404).json({ message: 'No screenshot.' });
        const me = req.user;
        if (me.userType !== 'admin' && !(me.userType === 'subadmin' && p.subAdminId === me.userId)) return res.status(403).json({ message: 'Not allowed.' });
        const full = path.resolve(PROOF_DIR, p.file.path);
        if (!full.startsWith(PROOF_DIR + path.sep)) return res.status(400).json({ message: 'Bad path.' });
        res.setHeader('Content-Type', p.file.mime);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        fs.createReadStream(full).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); }).pipe(res);
    } catch (err) { fail(res, err); }
};

exports.PROOF_DIR = PROOF_DIR;
