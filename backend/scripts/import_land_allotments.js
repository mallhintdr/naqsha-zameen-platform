/**
 * One-time (and re-runnable) importer for the Cholistan land-allotment CSV.
 *
 * Usage: node backend/scripts/import_land_allotments.js [path/to/file.csv]
 * Defaults to backend/data/AKAR/CDA-AKAR-CSV.csv if no path is given.
 *
 * Safe to re-run: upserts on (cnic, murabbaNo, killaNos-as-sorted-string) so
 * re-importing the same CSV (or a corrected version) doesn't create
 * duplicate allotment records.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI is not defined in the environment variables.');
    process.exit(1);
}

const normalizeCnic = (raw) => String(raw || '').replace(/\D/g, '');

async function run() {
    const csvPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(__dirname, '..', 'data', 'AKAR', 'CDA-AKAR-CSV.csv');

    if (!fs.existsSync(csvPath)) {
        console.error(`CSV file not found: ${csvPath}`);
        process.exit(1);
    }

    console.log(`Reading ${csvPath}...`);
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
    console.log(`Parsed ${rows.length} rows.`);

    await mongoose.connect(MONGO_URI, { family: 4 });
    console.log('Connected to MongoDB');

    const LandAllotment = require('../models/LandAllotment');
    const importBatch = `${path.basename(csvPath)}:${new Date().toISOString()}`;

    let imported = 0, skipped = 0;
    const ops = [];

    for (const row of rows) {
        const cnicRaw = row.CNIC?.trim();
        const cnic = normalizeCnic(cnicRaw);
        const murabbaNo = row.Murabba_No?.trim();
        const fullName = row.FullName?.trim();
        const killaNos = String(row.KhasraNo || '')
            .split(',')
            .map(k => k.trim())
            .filter(Boolean);

        if (!cnic || !murabbaNo || !fullName || killaNos.length === 0) {
            skipped++;
            continue;
        }

        const filter = { cnic, murabbaNo, killaNos: { $eq: killaNos } };
        const update = {
            $set: {
                cnic,
                cnicRaw,
                fullName,
                lotTehsil: row.LotTehsil?.trim(),
                lotMauza: row.LotMauza?.trim(),
                applicantTehsil: row.ApplicantTehsil?.trim(),
                lotNumber: row.LotNumber?.trim(),
                blockNo: row.BlockNo?.trim(),
                murabaNo: row.MurabaNo?.trim(),
                murabbaNo,
                killaNos,
                importBatch
            }
        };

        ops.push({ updateOne: { filter, update, upsert: true } });
        imported++;

        if (ops.length >= 500) {
            await LandAllotment.bulkWrite(ops.splice(0, ops.length), { ordered: false });
        }
    }

    if (ops.length) {
        await LandAllotment.bulkWrite(ops, { ordered: false });
    }

    console.log(`Done. Imported/updated: ${imported}, skipped (missing required fields): ${skipped}`);
    await mongoose.connection.close();
    process.exit(0);
}

run().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
});
