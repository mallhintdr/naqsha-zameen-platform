/**
 * Who a customer pays for renewals (§18.2). Customers managed by a sub-admin
 * see that sub-admin's payment details; everyone else sees the admin's,
 * which now live in SystemConfig instead of being hard-coded in the frontend.
 * Decided on the server from managedBy, never from anything the browser sends.
 */
const SystemConfig = require('../models/SystemConfig');
const SubAdmin = require('../models/SubAdmin');
const User = require('../models/User');

// The values that were hard-coded in SubscriptionWarningModal.js / the
// REACT_APP_WHATSAPP_NUMBER default, used until the admin saves their own.
const DEFAULT_ADMIN_DETAILS = {
    name: 'GeoMatrix Technologies',
    jazzcash: { title: 'Muhammad Masoom', number: '03146796144' },
    easypaisa: { title: 'Muhammad Masoom', number: '03146796144' },
    phone: '03146796144',
    whatsapp: '923048840264'
};

async function getAdminPaymentDetails() {
    const doc = await SystemConfig.findOne({ key: 'adminPaymentDetails' }).lean();
    return { ...DEFAULT_ADMIN_DETAILS, ...(doc?.value || {}) };
}

async function setAdminPaymentDetails(details) {
    return SystemConfig.findOneAndUpdate(
        { key: 'adminPaymentDetails' },
        { $set: { value: details } },
        { upsert: true, new: true }
    );
}

/** Pakistani mobile number, e.g. 03001234567 (spaces/dashes allowed). */
const normalisePkMobile = (v) => {
    const digits = String(v || '').replace(/[\s-]/g, '');
    if (/^03\d{9}$/.test(digits)) return digits;
    if (/^923\d{9}$/.test(digits)) return '0' + digits.slice(2);
    if (/^\+923\d{9}$/.test(digits)) return '0' + digits.slice(3);
    return null;
};

/** WhatsApp numbers are stored in international form without '+': 923001234567. */
const toWhatsappIntl = (v) => {
    const local = normalisePkMobile(v);
    return local ? '92' + local.slice(1) : null;
};

/** Provider block for one customer. */
async function getProviderForUser(user) {
    if (user && user.managedBy) {
        const [subAdmin, subUser] = await Promise.all([
            SubAdmin.findOne({ userId: user.managedBy }).lean(),
            User.findOne({ userId: user.managedBy }).select('userName').lean()
        ]);
        const pd = subAdmin?.paymentDetails;
        if (pd && (pd.jazzcash?.number || pd.easypaisa?.number)) {
            return {
                isAdmin: false,
                name: subUser?.userName || user.managedBy,
                subAdminId: user.managedBy,
                jazzcash: pd.jazzcash?.number ? pd.jazzcash : null,
                easypaisa: pd.easypaisa?.number ? pd.easypaisa : null,
                phone: pd.phone || null,
                whatsapp: pd.whatsapp || null
            };
        }
    }
    const admin = await getAdminPaymentDetails();
    return { isAdmin: true, ...admin };
}

module.exports = { getProviderForUser, getAdminPaymentDetails, setAdminPaymentDetails, normalisePkMobile, toWhatsappIntl, DEFAULT_ADMIN_DETAILS };
