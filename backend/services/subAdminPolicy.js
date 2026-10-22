/**
 * Fair Charge Policy (§18.1). Stored in SystemConfig 'subadminPolicy' so the
 * admin can edit it; the default below is used until then. Changing the text
 * means bumping the version, which sub-admins must accept again.
 */
const SystemConfig = require('../models/SystemConfig');

const DEFAULT_POLICY = {
    version: '2026-09-24',
    text: [
        'Tell the customer the price before activation.',
        'Record the real amount you charge for every activation and renewal.',
        'Do not charge for editing a customer\'s name, mobile number or password.',
        'Do not charge for a mouza change within the customer\'s allowance, beyond any upgrade difference.',
        'Do not collect payment for time you have not activated.',
        'Resolve customer complaints within 48 hours.',
        'Keep your payment details accurate; they are shown to your customers.',
        'Pay your daily bills within the payment window. Overdue bills of Rs 10,000 or more lead to a final warning and, if unpaid after 48 hours, suspension until payment.'
    ]
};

async function getPolicy() {
    const doc = await SystemConfig.findOne({ key: 'subadminPolicy' }).lean();
    return doc?.value?.version ? doc.value : DEFAULT_POLICY;
}

async function setPolicy({ version, text }) {
    return SystemConfig.findOneAndUpdate({ key: 'subadminPolicy' }, { $set: { value: { version, text } } }, { upsert: true, new: true });
}

/** The admin's "limits" switch (SystemConfig limitsEnabled, default on). When off, one
 *  email address may be shared by several accounts. */
async function limitsEnabled() {
    const cfg = await SystemConfig.findOne({ key: 'limitsEnabled' }).lean();
    return cfg ? cfg.value !== false : true;
}

/** True when `email` must be rejected because another account already uses it. */
async function emailTaken(User, email, excludeId) {
    if (!(await limitsEnabled())) return false;
    const filter = { email };
    if (excludeId) filter._id = { $ne: excludeId };
    return !!(await User.exists(filter));
}

module.exports = { getPolicy, setPolicy, DEFAULT_POLICY, limitsEnabled, emailTaken };
