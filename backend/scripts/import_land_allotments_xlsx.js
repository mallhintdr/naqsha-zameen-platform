/**
 * XLSX-direct importer for the Cholistan land-allotment data — the real fix
 * for two Excel-caused data corruption problems that a manual "Save As CSV"
 * step in Excel cannot avoid:
 *
 *   1. Urdu/Unicode text -> "???????"
 *      Excel's default "CSV (Comma delimited)" export uses the Windows ANSI
 *      codepage, which cannot represent Urdu characters at all — they are
 *      silently replaced with '?' and are UNRECOVERABLE once that export has
 *      happened. Reading the .xlsx directly (this script) never goes through
 *      that lossy step — SheetJS reads the workbook's real Unicode strings.
 *
 *   2. Murabba No like "1/3" -> "March-1" / "01-Mar"
 *      Excel's autocorrect silently reinterprets a typed value like "1/3" as
 *      a date THE MOMENT YOU TYPE IT (before any export), whenever both
 *      parts look like a valid day/month. This is why some values (e.g.
 *      "49/16") survive untouched — 16 isn't a valid month — while "1/3",
 *      "3/5", "11/12" etc. get converted. The day/month numbers are NOT
 *      lost, just relabeled: "March 1" unambiguously reverses to "1/3". But
 *      that reversal is only possible from the real date VALUE, which is
 *      why this needs the original .xlsx (with `cellDates: true`), not a
 *      CSV that Excel has already re-stringified into "01-Mar" or similar.
 *
 * Usage: node backend/scripts/import_land_allotments_xlsx.js path/to/file.xlsx [sheetName]
 *
 * Safe to re-run: upserts on (cnic, murabbaNo, killaNos), same as the CSV
 * importer, so re-importing a corrected workbook doesn't create duplicates.
 *
 * PREVENTION for future data entry (cheaper than any recovery):
 *   Before typing/pasting values into the MurabaNo / Murabba_No / KhasraNo
 *   columns in Excel, select those columns and set Format Cells -> Text
 *   FIRST. That disables Excel's date autocorrect for those cells entirely.
 */
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI is not defined in the environment variables.');
    process.exit(1);
}

const normalizeCnic = (raw) => String(raw || '').replace(/\D/g, '');

// Columns that are at risk of Excel's date autocorrect (anything that can
// look like "day/month" or "day-month").
const DATE_RISK_COLUMNS = new Set(['MurabaNo', 'Murabba_No', 'KhasraNo']);

/**
 * Reverses an Excel-autocorrected date back to its original "day/month"
 * text form. Works on either a real JS Date (best — from `cellDates:true`
 * reading the .xlsx directly) or an already-stringified date like "01-Mar"
 * / "1-Mar-24" / "3/1/2024" (fallback, for when only a corrupted CSV
 * survives — less reliable, since Excel's CSV string format varies by
 * locale/settings, but covers the common cases).
 */
function reverseDateCorruption(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
        return `${value.getDate()}/${value.getMonth() + 1}`;
    }
    if (typeof value === 'string') {
        // "01-Mar", "1-Mar-24", "1-Mar-2024"
        const m1 = value.match(/^(\d{1,2})-([A-Za-z]{3,9})(?:-\d{2,4})?$/);
        if (m1) {
            const day = parseInt(m1[1], 10);
            const month = new Date(`${m1[2]} 1, 2000`).getMonth() + 1;
            if (day && month) return `${day}/${month}`;
        }
        // "3/1/2024" or "3/1/24" (Excel US-locale date-string export of a
        // cell that was typed as "day/month" and autocorrected)
        const m2 = value.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
        if (m2) {
            // In a US-locale export this is month/day/year — the ORIGINAL
            // typed value was day/month, so swap back.
            return `${parseInt(m2[2], 10)}/${parseInt(m2[1], 10)}`;
        }
    }
    return value;
}

/** Repairs a whole row's date-risk columns in place. */
function repairRow(row) {
    const repaired = { ...row };
    for (const col of DATE_RISK_COLUMNS) {
        if (col in repaired) {
            repaired[col] = reverseDateCorruption(repaired[col]);
        }
    }
    return repaired;
}

async function run() {
    const xlsxPath = process.argv[2];
    const sheetName = process.argv[3];

    if (!xlsxPath) {
        console.error('Usage: node backend/scripts/import_land_allotments_xlsx.js <path/to/file.xlsx> [sheetName]');
        process.exit(1);
    }

    console.log(`Reading ${xlsxPath}...`);
    // cellDates:true is the key setting — without it, date cells come back
    // as raw Excel serial numbers instead of JS Date objects, and we'd lose
    // the ability to cleanly reverse the day/month.
    const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
    const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
    if (!sheet) {
        console.error(`Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
        process.exit(1);
    }

    // raw:false would re-stringify dates using Excel's own formatting (the
    // very problem we're avoiding) — keep raw:true and repair manually.
    const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
    console.log(`Parsed ${rows.length} rows.`);

    let dateRepairsMade = 0;
    const repairedRows = rows.map((row) => {
        const repaired = repairRow(row);
        for (const col of DATE_RISK_COLUMNS) {
            if (repaired[col] !== row[col]) dateRepairsMade++;
        }
        return repaired;
    });
    if (dateRepairsMade > 0) {
        console.log(`Repaired ${dateRepairsMade} Excel-autocorrupted date value(s) back to their original day/month form.`);
    }

    await mongoose.connect(MONGO_URI, { family: 4 });
    console.log('Connected to MongoDB');

    const LandAllotment = require('../models/LandAllotment');
    const importBatch = `${path.basename(xlsxPath)}:${new Date().toISOString()}`;

    let imported = 0, skipped = 0;
    const ops = [];

    for (const row of repairedRows) {
        const cnicRaw = String(row.CNIC || '').trim();
        const cnic = normalizeCnic(cnicRaw);
        const murabbaNo = String(row.Murabba_No || '').trim();
        const fullName = String(row.FullName || '').trim();
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
                lotTehsil: String(row.LotTehsil || '').trim(),
                lotMauza: String(row.LotMauza || '').trim(),
                applicantTehsil: String(row.ApplicantTehsil || '').trim(),
                lotNumber: String(row.LotNumber || '').trim(),
                blockNo: String(row.BlockNo || '').trim(),
                murabaNo: String(row.MurabaNo || '').trim(),
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
