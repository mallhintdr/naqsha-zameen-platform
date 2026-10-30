const LandRecord = require('../models/LandRecord');
const { accessLevel } = require('../services/accessPolicy');

exports.getTehsils = async (_req, res) => {
    try {
        const tehsils = await LandRecord.distinct('tehsil');
        res.json(tehsils.sort((a, b) => a.localeCompare(b)));
    } catch (err) {
        res.status(500).json({ error: 'Unable to fetch tehsils' });
    }
};

exports.getMauzas = async (req, res) => {
    try {
        const mauzas = await LandRecord.distinct('mouza', { tehsil: req.params.tehsil });
        res.json(mauzas.sort((a, b) => a.localeCompare(b)));
    } catch (err) {
        res.status(500).json({ error: 'Unable to fetch mauzas' });
    }
};

exports.getKhewats = async (req, res) => {
    const { tehsil, mauza } = req.params;
    try {
        const recs = await LandRecord.find({ tehsil, $or: [{ mouza: mauza }, { mauza }] })
            .select('khewatId khewatNo -_id')
            .sort('khewatNo');
        res.json(recs);
    } catch (err) {
        res.status(500).json({ error: 'Unable to fetch khewats' });
    }
};

exports.getRecordDetails = async (req, res) => {
    const khewatId = parseInt(req.params.khewatId, 10);
    try {
        const rec = await LandRecord.findOne({ khewatId });
        if (!rec) return res.status(404).json({ message: 'Record not found' });
        const mouzaName = rec.mouza || rec.get?.('mauza');
        if (req.user?.userType !== 'admin') {
            const level = await accessLevel(req.user, rec.tehsil, mouzaName);
            if (level !== 'full') {
                return res.status(403).json({ message: 'Access denied: You are not subscribed to this mouza.' });
            }
        }
        res.json(rec);
    } catch (err) {
        res.status(500).json({ error: 'Unable to fetch record' });
    }
};
