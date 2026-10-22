// Readable random password for a customer: their first name (Capitalised),
// a random special character, the last 4 digits of their phone (random digits
// when there is no phone) and a random lower + upper case letter pair.
// e.g. "Arif#4821kQ". Always has upper, lower, digit and special characters.
const crypto = require('crypto');

const SPECIALS = '@#$&!*';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';   // no l / o (look like 1 / 0)
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no I / O
const pick = (s) => s[crypto.randomInt(0, s.length)];

function generateUserPassword(name, mobile) {
    const first = (String(name || '').trim().split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '').slice(0, 8) || 'User';
    const cap = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    const phone = String(mobile || '').replace(/\D/g, '');
    const digits = phone.length >= 4 ? phone.slice(-4) : String(crypto.randomInt(1000, 10000));
    // Random order of the closing pair so it isn't always lower-then-upper.
    const pair = crypto.randomInt(0, 2) ? pick(LOWER) + pick(UPPER) : pick(UPPER) + pick(LOWER);
    return `${cap}${pick(SPECIALS)}${digits}${pair}`;
}

module.exports = { generateUserPassword };
