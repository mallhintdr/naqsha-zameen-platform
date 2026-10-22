/**
 * The ONLY place sub-admin prices are calculated. The create-form preview,
 * renewals, upgrades and bill lines all call quote()/upgradeCharge(), so the
 * price shown is always the price billed. Prices sent by the browser are
 * never used.
 */
const PricingVersion = require('../models/PricingVersion');

const DEFAULT_TABLE = {
    tiers: [
        { key: 'T1', minMouzas: 1, maxMouzas: 1, monthly: 300, yearlyPinned: null },
        { key: 'T2', minMouzas: 2, maxMouzas: 2, monthly: 500, yearlyPinned: null },
        { key: 'T3', minMouzas: 3, maxMouzas: 3, monthly: 750, yearlyPinned: null },
        { key: 'T4', minMouzas: 4, maxMouzas: 5, monthly: 1000, yearlyPinned: null },
        { key: 'T5', minMouzas: 6, maxMouzas: 8, monthly: 1500, yearlyPinned: null }
    ],
    yearlyDiscountPct: 30,
    roundTo: 100,
    roundMode: 'nearest',
    maxMouzas: 8,
    trialMaxMouzas: 2,
    minUpgradeCharge: 100
};

const PERIOD_DAYS = { Monthly: 30, Yearly: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

let cached = null;
let cachedAt = 0;
const CACHE_MS = 30 * 1000;

/** Current price table (creates version 1 from the defaults the first time). */
async function getCurrentTable({ fresh = false } = {}) {
    if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
    let current = await PricingVersion.findOne().sort({ version: -1 }).lean();
    if (!current) {
        try {
            current = (await PricingVersion.create({ version: 1, ...DEFAULT_TABLE, createdBy: 'system', note: 'Initial price table' })).toObject();
        } catch (e) {
            if (e.code !== 11000) throw e;
            current = await PricingVersion.findOne().sort({ version: -1 }).lean();
        }
    }
    cached = current;
    cachedAt = Date.now();
    return current;
}

// Price table: cleared on ALL instances when the admin saves prices (cacheBus).
require('../utils/cacheBus').register('pricing', () => { cached = null; cachedAt = 0; });
function clearCache() { require('../utils/cacheBus').bump('pricing'); }

function roundAmount(amount, table) {
    const step = table.roundTo || 1;
    const fn = table.roundMode === 'up' ? Math.ceil : table.roundMode === 'down' ? Math.floor : Math.round;
    return fn(amount / step) * step;
}

/** Validates a proposed table. Returns an array of problems (empty = valid). */
function validateTable(t) {
    const problems = [];
    const tiers = Array.isArray(t.tiers) ? [...t.tiers].sort((a, b) => a.minMouzas - b.minMouzas) : [];
    if (!tiers.length) problems.push('At least one tier is required.');
    const keys = new Set();
    let expectedMin = 1;
    for (const tier of tiers) {
        if (!tier.key || keys.has(tier.key)) problems.push(`Tier key "${tier.key}" is missing or repeated.`);
        keys.add(tier.key);
        if (!Number.isInteger(tier.minMouzas) || !Number.isInteger(tier.maxMouzas) || tier.minMouzas > tier.maxMouzas) {
            problems.push(`Tier ${tier.key}: mouza range ${tier.minMouzas}–${tier.maxMouzas} is invalid.`);
        }
        if (tier.minMouzas !== expectedMin) problems.push(`Tier ${tier.key}: must start at ${expectedMin} mouza(s) (no gaps or overlaps).`);
        expectedMin = tier.maxMouzas + 1;
        if (!Number.isInteger(tier.monthly) || tier.monthly <= 0) problems.push(`Tier ${tier.key}: monthly price must be a positive whole number.`);
        if (tier.yearlyPinned != null && (!Number.isInteger(tier.yearlyPinned) || tier.yearlyPinned <= 0)) {
            problems.push(`Tier ${tier.key}: pinned yearly price must be a positive whole number.`);
        }
    }
    if (tiers.length && tiers[tiers.length - 1].maxMouzas !== t.maxMouzas) problems.push(`The last tier must end at the mouza limit (${t.maxMouzas}).`);
    if (!(t.yearlyDiscountPct >= 0 && t.yearlyDiscountPct < 100)) problems.push('Yearly discount must be between 0 and 99%.');
    if (!(t.roundTo >= 1)) problems.push('Rounding step must be at least 1.');
    if (!['nearest', 'up', 'down'].includes(t.roundMode)) problems.push('Rounding must be nearest, up or down.');
    if (!(Number.isInteger(t.trialMaxMouzas) && t.trialMaxMouzas >= 1 && t.trialMaxMouzas <= t.maxMouzas)) problems.push('Trial mouza limit must be between 1 and the mouza limit.');
    if (!(t.minUpgradeCharge >= 0)) problems.push('Minimum upgrade charge cannot be negative.');
    return problems;
}

function yearlyFor(tier, table) {
    if (tier.yearlyPinned) return tier.yearlyPinned;
    return roundAmount(tier.monthly * 12 * (1 - table.yearlyDiscountPct / 100), table);
}

function tierForCount(mouzaCount, table) {
    return table.tiers.find(t => mouzaCount >= t.minMouzas && mouzaCount <= t.maxMouzas) || null;
}

/**
 * Price for a customer.
 * @param {{ mouzaCount:number, plan:'Monthly'|'Yearly', subAdmin?:object, customer?:object, table?:object }} p
 * @returns {{ ok:true, tierKey, plan, price, monthly, yearly, pricingVersion } | { ok:false, reason }}
 */
async function quote({ mouzaCount, plan, subAdmin, customer, table }) {
    table = table || await getCurrentTable();
    if (!['Monthly', 'Yearly'].includes(plan)) return { ok: false, reason: `Plan must be Monthly or Yearly.` };

    // A price you set for one customer (approved request) wins.
    if (customer?.customPlatformPrice && (customer.customPlatformPrice.monthly || customer.customPlatformPrice.yearly)) {
        const monthly = customer.customPlatformPrice.monthly || null;
        const yearly = customer.customPlatformPrice.yearly || (monthly ? roundAmount(monthly * 12 * (1 - table.yearlyDiscountPct / 100), table) : null);
        const price = plan === 'Yearly' ? yearly : monthly;
        if (price) return { ok: true, tierKey: 'custom', plan, price, monthly, yearly, pricingVersion: table.version };
    }

    if (!Number.isInteger(mouzaCount) || mouzaCount < 1) return { ok: false, reason: 'At least one mouza is required.' };

    // No mouza limit for now: counts above the last tier use the top tier's price.
    const tiers = [...(table.tiers || [])].sort((a, b) => a.maxMouzas - b.maxMouzas);
    const tier = tierForCount(mouzaCount, table) || (mouzaCount > (tiers[tiers.length - 1]?.maxMouzas || 0) ? tiers[tiers.length - 1] : null);
    if (!tier) return { ok: false, reason: `No price is set for ${mouzaCount} mouzas. Send a request to the admin.` };

    let monthly = tier.monthly;
    let yearly = yearlyFor(tier, table);
    const override = (subAdmin?.priceOverride || []).find(o => o.tierKey === tier.key);
    if (override) {
        if (override.monthly) monthly = override.monthly;
        yearly = override.yearly || (override.monthly ? roundAmount(override.monthly * 12 * (1 - table.yearlyDiscountPct / 100), table) : yearly);
    }
    return { ok: true, tierKey: tier.key, plan, price: plan === 'Yearly' ? yearly : monthly, monthly, yearly, pricingVersion: table.version };
}

/**
 * Charge for moving to a higher tier mid-period (§13.2): the price difference
 * for the days left, rounded, with a minimum charge. 0 when not an upgrade.
 */
function upgradeCharge({ newPrice, paidPrice, periodEnd, plan, table, now = new Date() }) {
    const diff = newPrice - (paidPrice || 0);
    if (diff <= 0) return 0;
    const periodDays = PERIOD_DAYS[plan] || 30;
    const daysLeft = Math.min(periodDays, Math.max(0, Math.ceil((new Date(periodEnd).getTime() - now.getTime()) / DAY_MS)));
    if (daysLeft <= 0) return 0;
    const raw = diff * daysLeft / periodDays;
    return Math.max(table.minUpgradeCharge || 0, roundAmount(raw, table));
}

/** Full price list for display (monthly + yearly per tier, overrides applied). */
async function priceList(subAdmin) {
    const table = await getCurrentTable();
    const rows = [];
    for (const tier of table.tiers) {
        const q = await quote({ mouzaCount: tier.minMouzas, plan: 'Monthly', subAdmin, table });
        rows.push({ key: tier.key, minMouzas: tier.minMouzas, maxMouzas: tier.maxMouzas, monthly: q.monthly, yearly: q.yearly });
    }
    return { version: table.version, maxMouzas: table.maxMouzas, trialMaxMouzas: table.trialMaxMouzas, yearlyDiscountPct: table.yearlyDiscountPct, tiers: rows };
}

module.exports = {
    DEFAULT_TABLE, PERIOD_DAYS,
    getCurrentTable, clearCache, validateTable, roundAmount, quote, upgradeCharge, priceList, tierForCount
};
