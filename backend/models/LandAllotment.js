const mongoose = require('mongoose');

/**
 * One row = one allottee's 5-acre Cholistan state-land allotment.
 * Sourced from CSV imports (see scripts/import_land_allotments.js) — see
 * backend/data/AKAR/CDA-AKAR-CSV.csv for the canonical column layout.
 */
const landAllotmentSchema = new mongoose.Schema({
    // Normalized (digits-only) CNIC, indexed for fast exact-match search.
    // Not unique — the same CNIC could theoretically appear on more than one
    // allotment record (e.g. imported from different estates over time).
    cnic: { type: String, required: true, index: true },
    cnicRaw: { type: String }, // original formatted value, e.g. "31103-7042992-8"

    fullName: { type: String, required: true },

    lotTehsil: String,
    lotMauza: { type: String, required: true, index: true }, // estate name, e.g. "Chak No 239 DB"
    applicantTehsil: String,
    lotNumber: String,
    blockNo: String,
    murabaNo: String,
    murabbaNo: { type: String, required: true, index: true }, // e.g. "49/1" — matches Murabba_No in the estate GeoJSON

    // Parsed from the CSV's comma-separated KhasraNo column, e.g. "11, 12, 13, 14, 15"
    killaNos: { type: [String], required: true },

    importBatch: String, // source filename / import run identifier, for audit trail
}, {
    timestamps: true
});

// Compound index for the common "search by CNIC" path, and a text index for
// name-based fallback search.
landAllotmentSchema.index({ cnic: 1, murabbaNo: 1 });
landAllotmentSchema.index({ fullName: 'text' });

module.exports = mongoose.model('LandAllotment', landAllotmentSchema);
