/**
 * Runs the admin operations report once, on demand, for a date range.
 * Usage: node scripts/run_daily_report.js 2026-09-01 2026-09-20
 *        node scripts/run_daily_report.js 2026-09-19            (single day)
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

(async () => {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    const { runReportForRange } = require('../services/dailyReportJob');
    const startDate = process.argv[2];
    if (!startDate) {
        console.error('Usage: node scripts/run_daily_report.js <startDate YYYY-MM-DD> [endDate YYYY-MM-DD]');
        process.exit(1);
    }
    const endDate = process.argv[3] || startDate;
    const result = await runReportForRange({ startDate, endDate });
    console.log(result);
    await mongoose.connection.close();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
