/**
 * Everything a sub-admin can do (§10, §12–14, §20, §23). Every handler runs
 * after isAuthenticated → isSubAdmin, so req.subAdmin is the caller's
 * profile. Every customer lookup goes through findOwnedUser; every tehsil
 * through assertAssignmentAllowed; every price through services/pricing.
 * Fields are whitelisted per endpoint; anything else is rejected.
 */
const crypto = require('crypto');
const User = require('../models/User');
const AccountEvent = require('../models/AccountEvent');
const SubAdminBill = require('../models/SubAdminBill');
const SubAdminPayment = require('../models/SubAdminPayment');
const SubAdminRequest = require('../models/SubAdminRequest');
const Session = require('../models/Session');
const logger = require('../utils/logger');
const { sanitizeUser, applyTehsilAssignmentsToUser } = require('../utils/userUtils');
const { recordEvent, snapshotUser, findSameDaySubscription } = require('../services/accountEventService');
const pricing = require('../services/pricing');
const billing = require('../services/subAdminBilling');
const scope = require('../services/subAdminScope');
const emails = require('../services/subAdminEmails');
const provider = require('../services/providerService');

const ACTIVATION_HOURS = 72;
const MAX_RESENDS_PER_DAY = 3;
const DISPOSABLE_DOMAINS = ['mailinator.com', '10minutemail.com', 'tempmail.com', 'guerrillamail.com', 'sharklasers.com', 'dispostable.com', 'getairmail.com', 'yopmail.com'];
const USER_ID_RE = /^[a-zA-Z0-9_.-]{3,50}$/;
const EMAIL_RE = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/;

// ── helpers ──────────────────────────────────────────────────────────────
const fail = (res, err) => {
    if (err instanceof scope.ScopeError) return res.status(err.status).json({ message: err.message });
    if (err && err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'value';
        return res.status(400).json({ message: `That ${field === 'userId' || field === 'userIdLower' ? 'User ID' : field} is already in use.` });
    }
    if (err && err.name === 'ValidationError') {
        return res.status(400).json({ message: Object.values(err.errors).map(e => e.message).join(', ') });
    }
    logger.error('subAdminController error', { error: err?.message, stack: err?.stack });
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
};

/** Refuses any body field not in the list (§27.4). */
const onlyFields = (body, allowed) => {
    const extra = Object.keys(body || {}).filter(k => !allowed.includes(k));
    if (extra.length) throw new scope.ScopeError(`These fields can't be set: ${extra.join(', ')}`);
};

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Name + special character + phone digits + random mixed-case letters (shared generator).
const generatePassword = (name, mobile) => require('../utils/passwordGenerator').generateUserPassword(name, mobile);

const pkMonthStart = (now = new Date()) => {
    const pk = new Date(now.getTime() + 5 * 3600e3);
    return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), 1) - 5 * 3600e3);
};

// Trials this month: new trial customers + trials given to existing customers.
const trialsUsedThisMonth = (subAdminId) => AccountEvent.countDocuments({
    ownerAtEvent: subAdminId,
    $or: [{ type: 'USER_CREATED', plan: 'Trial24' }, { type: 'TRIAL_GIVEN' }],
    createdAt: { $gte: pkMonthStart() }
});

/**
 * 24-hour free trial for an EXISTING customer (POST …/renew with plan Trial24).
 * Once per customer, ever; not while a paid period is running; counts against the
 * monthly trial quota; mouza limit as for trial customers; free (no bill line).
 */
async function giveTrial(req, res) {
    try {
        if (!req.subAdmin.allowedPlans.includes('Trial24')) throw new scope.ScopeError('Trials are not enabled for your account.');
        const u = await scope.findOwnedUser(req, req.params.userId);
        if (u.status === 'AwaitingActivation') throw new scope.ScopeError('This customer hasn\'t activated yet.');
        if (u.status === 'Suspended') throw new scope.ScopeError('Reactivate this customer first.');
        const now = new Date();
        const isTrialNow = ['Trial24', 'Trial'].includes(u.subscriptionType);
        if (!isTrialNow && u.endDate && new Date(u.endDate) > now) throw new scope.ScopeError('This customer has a paid plan running. A trial can only be given when it has ended.');
        const hadTrial = isTrialNow || await AccountEvent.exists({
            userId: u.userId,
            $or: [{ type: 'TRIAL_GIVEN' }, { type: { $in: ['USER_CREATED', 'ACTIVATED', 'RENEWED'] }, plan: { $in: ['Trial', 'Trial24'] } }]
        });
        if (hadTrial) throw new scope.ScopeError('This customer has already had a free trial. Renew as Monthly or Yearly.');
        if (await trialsUsedThisMonth(req.subAdmin.userId) >= req.subAdmin.trialQuotaPerMonth) {
            throw new scope.ScopeError(`You've used all ${req.subAdmin.trialQuotaPerMonth} trials for this month.`);
        }
        const table = await pricing.getCurrentTable();
        const maxMouzas = Math.min(req.subAdmin.trialMaxMouzas || table.trialMaxMouzas, table.trialMaxMouzas);
        const mouzaCount = await scope.inScopeMouzaCount(req.subAdmin, u.tehsilAccess);
        if (mouzaCount > maxMouzas) throw new scope.ScopeError(`A trial allows up to ${maxMouzas} mouza(s); this customer has ${mouzaCount}. Remove some mouzas first.`);

        const previous = { plan: u.subscriptionType, start: u.startDate, end: u.endDate };
        u.subscriptionType = 'Trial24';
        u.startDate = now;
        u.fee = 0;
        await u.save();                                            // save hook sets endDate/status
        await recordEvent({
            userId: u.userId, ownerAtEvent: u.managedBy, type: 'TRIAL_GIVEN',
            plan: 'Trial24', previousPlan: previous.plan,
            periodStart: u.startDate, periodEnd: u.endDate, previousPeriodStart: previous.start, previousPeriodEnd: previous.end,
            customerFee: 0, platformPrice: 0, paymentAmount: 0, billable: false
        }, req);
        await tellAdmin(req, 'gave a free trial', `${u.userId} — 24 hours, ${mouzaCount} mouza(s).`);
        tellUser(u.userId, { type: 'subscription', title: 'Free trial activated', message: `Your free trial is active until ${new Date(u.endDate).toLocaleString('en-PK')}.` });
        res.json({ message: `Free trial given until ${new Date(u.endDate).toLocaleString('en-PK')}. Not billed.`, billed: 0, user: customerView(u.toObject()) });
    } catch (err) { fail(res, err); }
}

const planLabel = (plan, mouzaCount) =>
    plan === 'Trial24' ? `Free trial (24 hours), ${mouzaCount} mouza(s)` : `${plan}, ${mouzaCount} mouza(s)`;

const flatMouzas = (assignment) => (assignment || []).flatMap(a => (a.mouzas || []).map(m => `${a.tehsil} - ${m}`));

const subAdminName = async (req) => {
    const u = await User.findOne({ userId: req.subAdmin.userId }).select('userName').lean();
    return u?.userName || req.subAdmin.userId;
};

/** In-app notice to the admin for every sub-admin action (D16). */
const tellAdmin = async (req, title, message, type = 'info') => {
    const { notifyAdmins } = require('../utils/notificationUtils');
    const name = await subAdminName(req);
    notifyAdmins({ type, title: `[${name}] ${title}`, message }).catch(() => {});
};

const tellUser = (userId, payload) => {
    const { sendNotification } = require('../utils/notificationUtils');
    sendNotification(userId, payload).catch(() => {});
};

const customerView = (u) => {
    const s = sanitizeUser(u);
    delete s.activation;
    delete s.pendingEmail;
    delete s.verificationToken;
    delete s.otp;
    delete s.deviceId;
    delete s.warnings;
    delete s.pushSubscriptions;
    delete s.renewalHistory;
    return s;
};

const assignmentAllowance = (u, now = new Date()) => {
    if (u.status === 'AwaitingActivation') return { available: true, reason: 'Not activated yet — changes are free until activation.' };
    if (['Trial24', 'Trial'].includes(u.subscriptionType)) return { available: false, reason: 'Trial customers keep the mouzas chosen at creation.' };
    const pp = u.paidPeriod || {};
    if (!pp.end || new Date(pp.end) <= now) return { available: false, reason: 'Renew first; each paid period includes one change.' };
    if (pp.changeUsed) return { available: false, reason: `This period's change is used. Next change available after renewal on ${new Date(pp.end).toLocaleDateString('en-PK')}.` };
    return { available: true, reason: pp.plan === 'Yearly' ? 'One change available this year.' : 'One change available this month.' };
};

// ── me / pricing ─────────────────────────────────────────────────────────
exports.me = async (req, res) => {
    try {
        const [user, pos, prices] = await Promise.all([
            User.findOne({ userId: req.subAdmin.userId }).select('userId userName email mobileNumber').lean(),
            billing.computePosition(req.subAdmin),
            pricing.priceList(req.subAdmin)
        ]);
        const sa = req.subAdmin.toObject();
        res.json({
            profile: user,
            subAdmin: {
                status: sa.status,
                territory: sa.territory,
                allowedPlans: sa.allowedPlans,
                trialQuotaPerMonth: sa.trialQuotaPerMonth,
                trialMaxMouzas: prices.trialMaxMouzas,
                maxMouzas: prices.maxMouzas,
                finalWarning: sa.finalWarning,
                paymentDetails: sa.paymentDetails,
                unpaidThreshold: sa.unpaidThreshold,
                paymentWindowDays: sa.paymentWindowDays
            },
            money: {
                todayTotal: pos.today.total,
                todayLines: pos.today.count,
                balance: pos.balance,
                overdue: pos.overdue,
                advanceCredit: pos.advanceCredit,
                oldestUnpaid: pos.oldestUnpaid
            },
            prices
        });
    } catch (err) { fail(res, err); }
};

exports.quote = async (req, res) => {
    try {
        const mouzaCount = parseInt(req.query.mouzas, 10);
        const plan = String(req.query.plan || 'Monthly');
        if (plan === 'Trial24') return res.json({ ok: true, plan, price: 0 });
        const q = await pricing.quote({ mouzaCount, plan, subAdmin: req.subAdmin });
        res.status(q.ok ? 200 : 400).json(q);
    } catch (err) { fail(res, err); }
};

exports.updatePaymentDetails = async (req, res) => {
    try {
        onlyFields(req.body, ['jazzcash', 'easypaisa', 'phone', 'whatsapp', 'bank']);
        if (req.subAdmin.paymentDetails?.lockedByAdmin) {
            return res.status(403).json({ message: 'Your payment details are locked by the admin. Please contact the admin to change them.' });
        }
        const details = await validatePaymentDetails(req.body);
        const before = req.subAdmin.paymentDetails ? JSON.parse(JSON.stringify(req.subAdmin.paymentDetails)) : null;
        req.subAdmin.paymentDetails = { ...details, lockedByAdmin: false, updatedAt: new Date() };
        await req.subAdmin.save();
        await recordEvent({ userId: req.subAdmin.userId, ownerAtEvent: req.subAdmin.userId, type: 'PAYMENT_DETAILS_CHANGED', before, after: details }, req);
        await tellAdmin(req, 'changed their payment details', `JazzCash ${details.jazzcash.number}, EasyPaisa ${details.easypaisa.number}, WhatsApp ${details.whatsapp}.`, 'alert');
        res.json({ message: 'Payment details saved.', paymentDetails: req.subAdmin.paymentDetails });
    } catch (err) { fail(res, err); }
};

/** Shared by activation and edits: format checks and "not the admin's own numbers". */
async function validatePaymentDetails(body) {
    const jc = provider.normalisePkMobile(body?.jazzcash?.number);
    const ep = provider.normalisePkMobile(body?.easypaisa?.number);
    const phone = provider.normalisePkMobile(body?.phone);
    const wa = provider.toWhatsappIntl(body?.whatsapp || body?.phone);
    if (!jc) throw new scope.ScopeError('Enter a valid JazzCash number (03xxxxxxxxx).');
    if (!ep) throw new scope.ScopeError('Enter a valid EasyPaisa number (03xxxxxxxxx).');
    if (!phone) throw new scope.ScopeError('Enter a valid contact phone number (03xxxxxxxxx).');
    if (!wa) throw new scope.ScopeError('Enter a valid WhatsApp number (03xxxxxxxxx).');
    const admin = await provider.getAdminPaymentDetails();
    const adminNums = [admin.jazzcash?.number, admin.easypaisa?.number, admin.phone].map(provider.normalisePkMobile).filter(Boolean);
    if ([jc, ep].some(n => adminNums.includes(n))) {
        throw new scope.ScopeError('These are the admin\'s own payment numbers. Enter the numbers your customers should pay you on.');
    }
    const title = (v) => String(v || '').trim().slice(0, 80);
    const bank = body?.bank && (body.bank.iban || body.bank.name)
        ? { name: title(body.bank.name), title: title(body.bank.title), iban: String(body.bank.iban || '').replace(/\s/g, '').slice(0, 34) }
        : undefined;
    return {
        jazzcash: { title: title(body.jazzcash?.title), number: jc },
        easypaisa: { title: title(body.easypaisa?.title), number: ep },
        phone,
        whatsapp: wa,
        ...(bank ? { bank } : {})
    };
}
exports.validatePaymentDetails = validatePaymentDetails;

// ── customers: list / view ───────────────────────────────────────────────
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.listUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const filter = scope.ownedUsersFilter(req);
        const q = (req.query.search || '').trim();
        if (q) {
            const rx = { $regex: escapeRegex(q), $options: 'i' };
            filter.$or = [{ userId: rx }, { userName: rx }, { mobileNumber: rx }, { email: rx }];
        }
        const now = new Date();
        switch (req.query.tab) {
            case 'active': filter.status = { $nin: ['AwaitingActivation', 'Suspended'] }; filter.endDate = { $gt: now }; break;
            case 'expiring': filter.status = { $nin: ['AwaitingActivation', 'Suspended'] }; filter.endDate = { $gt: now, $lte: new Date(now.getTime() + 7 * 86400e3) }; break;
            case 'expired': filter.status = { $nin: ['AwaitingActivation'] }; filter.endDate = { $lte: now }; break;
            case 'awaiting': filter.status = 'AwaitingActivation'; break;
            case 'trial': filter.subscriptionType = { $in: ['Trial24', 'Trial'] }; break;
            case 'suspended': filter.status = 'Suspended'; break;
            default: break;
        }
        if (req.query.tehsil) filter['tehsilAccess.tehsil'] = { $regex: `^${escapeRegex(req.query.tehsil)}$`, $options: 'i' };
        // Same filters as the admin user list: user ID, then one of tehsil / phone / email.
        const rxOf = (v) => ({ $regex: escapeRegex(String(v).trim()), $options: 'i' });
        if ((req.query.searchId || '').trim()) filter.userId = rxOf(req.query.searchId);
        if ((req.query.searchTehsil || '').trim()) filter['tehsilAccess.tehsil'] = rxOf(req.query.searchTehsil);
        if ((req.query.searchPhone || '').trim()) filter.mobileNumber = rxOf(req.query.searchPhone);
        if ((req.query.searchEmail || '').trim()) filter.email = rxOf(req.query.searchEmail);
        const sortKey = ['userId', 'userName', 'endDate', 'createdAt', 'status'].includes(req.query.sortKey) ? req.query.sortKey : 'createdAt';
        const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

        const [rows, total] = await Promise.all([
            User.find(filter).sort({ [sortKey]: sortDir, _id: 1 }).skip((page - 1) * limit).limit(limit)
                .select('-password -notifications -pushSubscriptions -warnings -renewalHistory -otp -verificationToken -resetPasswordToken -activation.tokenHash -pendingEmail.tokenHash -deviceId')
                .lean(),
            User.countDocuments(filter)
        ]);
        res.json({
            users: rows.map(u => ({ ...customerView(u), allowance: assignmentAllowance(u) })),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (err) { fail(res, err); }
};

exports.getUser = async (req, res) => {
    try {
        const u = await scope.findOwnedUser(req, req.params.userId);
        const obj = u.toObject();
        res.json({
            user: { ...customerView(obj), allowance: assignmentAllowance(obj), awaitingActivationUntil: obj.activation?.expiresAt || null },
            outOfTerritory: await outOfTerritoryParts(req.subAdmin, obj.tehsilAccess)
        });
    } catch (err) { fail(res, err); }
};

async function outOfTerritoryParts(subAdmin, access) {
    const out = [];
    for (const a of access || []) if (!(await scope.tehsilInTerritory(a.tehsil, subAdmin.territory))) out.push({ tehsil: a.tehsil, mouzas: a.mouzas });
    return out;
}

exports.getUserHistory = async (req, res) => {
    try {
        const u = await scope.findOwnedUser(req, req.params.userId);
        const events = await AccountEvent.find({ userId: u.userId, type: { $nin: ['PAYMENT_DETAILS_CHANGED', 'PRICING_CHANGED'] } })
            .sort({ createdAt: -1 }).limit(200)
            .select('-ip -requestKey -estimatedAmount')
            .lean();
        // Sub-admins never see what the admin earns from customers they don't bill.
        res.json({ events: events.map(e => (e.billable ? e : { ...e, paymentAmount: undefined })) });
    } catch (err) { fail(res, err); }
};

// ── customers: create + activation ───────────────────────────────────────
const CREATE_FIELDS = ['userId', 'userName', 'mobileNumber', 'email', 'password', 'plan', 'assignment', 'activeTehsil', 'customerFee', 'requestKey'];

exports.createUser = async (req, res) => {
    try {
        onlyFields(req.body, CREATE_FIELDS);
        const b = req.body;
        const userId = String(b.userId || '').trim();
        const userName = String(b.userName || '').trim();
        const email = String(b.email || '').trim().toLowerCase();
        const mobileNumber = String(b.mobileNumber || '').trim();
        const plan = String(b.plan || '');

        if (!USER_ID_RE.test(userId)) throw new scope.ScopeError('User ID must be 3–50 letters, numbers, dots, underscores or hyphens.');
        if (!userName) throw new scope.ScopeError('Name is required.');
        if (!EMAIL_RE.test(email)) throw new scope.ScopeError('A valid email address is required; the customer activates from it.');
        if (DISPOSABLE_DOMAINS.includes(email.split('@')[1])) throw new scope.ScopeError('Throwaway email addresses are not allowed.');
        if (!req.subAdmin.allowedPlans.includes(plan)) throw new scope.ScopeError(`Plan must be one of: ${req.subAdmin.allowedPlans.join(', ')}.`);

        if (await require('../services/subAdminPolicy').emailTaken(User, email)) throw new scope.ScopeError('That email address is already used by another account.');

        const table = await pricing.getCurrentTable();
        const isTrial = plan === 'Trial24';
        const maxMouzas = isTrial ? Math.min(req.subAdmin.trialMaxMouzas || table.trialMaxMouzas, table.trialMaxMouzas) : table.maxMouzas;
        const { merged, mouzaCount } = await scope.assertAssignmentAllowed({ subAdmin: req.subAdmin, requested: b.assignment, maxMouzas });

        let customerFee = null;
        if (!isTrial) {
            customerFee = Number(b.customerFee);
            // Manual pricing for now: the price the sub-admin enters is what the platform bills on activation.
            if (!Number.isFinite(customerFee) || customerFee < 0) throw new scope.ScopeError('Enter the price for this customer (Rs).');
        }

        const mobileDigits = mobileNumber.replace(/\D/g, '').slice(-10);
        if (isTrial) {
            const since = pkMonthStart();
            const used = await trialsUsedThisMonth(req.subAdmin.userId);
            if (used >= req.subAdmin.trialQuotaPerMonth) throw new scope.ScopeError(`You've used all ${req.subAdmin.trialQuotaPerMonth} trials for this month.`);
            // One trial per customer, ever: any existing account with this email/mobile rules it out.
            const orMobile = mobileDigits.length >= 10 ? [{ mobileNumber: { $regex: `${mobileDigits}$` } }] : [];
            const seen = await User.exists({ $or: [{ email }, ...orMobile] })
                || await AccountEvent.exists({ type: 'USER_CREATED', plan: { $in: ['Trial', 'Trial24'] }, $or: [{ 'after.email': email }, ...(mobileDigits.length >= 10 ? [{ 'after.mobileNumber': { $regex: `${mobileDigits}$` } }] : [])] });
            if (seen) throw new scope.ScopeError('This customer has already had an account or a trial. Create a Monthly or Yearly plan instead.');
        }

        const password = b.password ? String(b.password) : generatePassword(userName, mobileNumber);
        const token = newToken();
        const expiresAt = new Date(Date.now() + ACTIVATION_HOURS * 3600e3);
        const { tehsilAccess, activeTehsil } = applyTehsilAssignmentsToUser({}, merged, b.activeTehsil);

        const user = new User({
            userId, userName, email, mobileNumber, password,
            userType: 'user',
            subscriptionType: plan,
            status: 'AwaitingActivation',
            startDate: null,
            fee: customerFee ?? 0,
            tehsilAccess, activeTehsil,
            managedBy: req.subAdmin.userId,
            createdBy: req.subAdmin.userId,
            registrationSource: 'admin',
            activation: { tokenHash: hashToken(token), expiresAt, resendDay: billing.pkDay(), resendCount: 0, plan, customerFee }
        });
        await user.save();

        await recordEvent({ userId, ownerAtEvent: req.subAdmin.userId, type: 'USER_CREATED', plan, customerFee, after: snapshotUser(user) }, req);
        await recordEvent({ userId, ownerAtEvent: req.subAdmin.userId, type: 'ACTIVATION_SENT', after: { email, expiresAt } }, req);

        const prov = await provider.getProviderForUser(user);
        const sent = await emails.sendCustomerActivation({
            to: email, userName, userId, token, planLabel: planLabel(plan, mouzaCount),
            mouzas: flatMouzas(merged), customerFee, provider: prov, expiresAt
        });

        // Poaching check: same mobile as someone else's customer.
        if (mobileDigits.length >= 10) {
            const dup = await User.findOne({ userId: { $ne: userId }, mobileNumber: { $regex: `${mobileDigits}$` } }).select('userId managedBy').lean();
            if (dup) await tellAdmin(req, 'possible duplicate customer', `${userId} has the same mobile as ${dup.userId} (${dup.managedBy ? 'managed by ' + dup.managedBy : 'your direct customer'}).`, 'alert');
        }
        await tellAdmin(req, 'created a customer', `${userId} (${userName}) — ${planLabel(plan, mouzaCount)}${customerFee ? `, price Rs ${customerFee}` : ''}. Awaiting email activation.`);

        res.status(201).json({
            message: sent ? `Customer created. An activation link was emailed to ${email}.` : 'Customer created, but the activation email could not be sent. Use "Resend activation".',
            user: customerView(user.toObject()),
            password: b.password ? undefined : password,
            emailSent: sent
        });
    } catch (err) { fail(res, err); }
};

exports.resendActivation = async (req, res) => {
    try {
        const u = await scope.findOwnedUser(req, req.params.userId);
        if (u.status !== 'AwaitingActivation') throw new scope.ScopeError('This customer is already activated.');
        const today = billing.pkDay();
        const count = u.activation?.resendDay === today ? (u.activation.resendCount || 0) : 0;
        if (count >= MAX_RESENDS_PER_DAY) throw new scope.ScopeError(`Activation links can be resent ${MAX_RESENDS_PER_DAY} times a day. Try again tomorrow.`);
        const token = newToken();
        const expiresAt = new Date(Date.now() + ACTIVATION_HOURS * 3600e3);
        u.activation.tokenHash = hashToken(token);   // the previous link stops working
        u.activation.expiresAt = expiresAt;
        u.activation.resendDay = today;
        u.activation.resendCount = count + 1;
        u.markModified('activation');
        await u.save();
        const mouzaCount = scope.countMouzas(u.tehsilAccess);
        const sent = await emails.sendCustomerActivation({
            to: u.email, userName: u.userName, userId: u.userId, token,
            planLabel: planLabel(u.activation.plan || u.subscriptionType, mouzaCount),
            mouzas: flatMouzas(u.tehsilAccess), customerFee: u.activation.customerFee,
            provider: await provider.getProviderForUser(u), expiresAt
        });
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'ACTIVATION_RESENT', after: { email: u.email, expiresAt } }, req);
        await tellAdmin(req, 'resent an activation link', `${u.userId} (${u.email}).`);
        res.json({ message: sent ? `Activation link resent to ${u.email}.` : 'The email could not be sent. Please try again later.', emailSent: sent });
    } catch (err) { fail(res, err); }
};

// ── customers: profile ───────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
    try {
        onlyFields(req.body, ['userName', 'mobileNumber', 'email', 'resetPassword']);
        const u = await scope.findOwnedUser(req, req.params.userId);
        const before = snapshotUser(u);
        const changed = [];
        let tempPassword;
        let emailMessage = '';

        if (req.body.userName !== undefined) {
            const v = String(req.body.userName).trim();
            if (!v) throw new scope.ScopeError('Name cannot be empty.');
            if (v !== u.userName) { u.userName = v; changed.push('userName'); }
        }
        if (req.body.mobileNumber !== undefined) {
            const v = String(req.body.mobileNumber).trim();
            if (!/^(\+|00|0)?[0-9\-\s]{5,20}$/.test(v)) throw new scope.ScopeError('Invalid mobile number.');
            if (v !== u.mobileNumber) { u.mobileNumber = v; changed.push('mobileNumber'); }
        }
        if (req.body.resetPassword === true) {
            tempPassword = generatePassword(u.userName, u.mobileNumber);
            u.password = tempPassword;
            u.tokenVersion = (u.tokenVersion || 0) + 1;       // log the customer out everywhere
            changed.push('password');
        }
        if (req.body.email !== undefined) {
            const v = String(req.body.email).trim().toLowerCase();
            if (v !== u.email) {
                if (!EMAIL_RE.test(v)) throw new scope.ScopeError('Enter a valid email address.');
                if (DISPOSABLE_DOMAINS.includes(v.split('@')[1])) throw new scope.ScopeError('Throwaway email addresses are not allowed.');
                if (await require('../services/subAdminPolicy').emailTaken(User, v, u._id)) throw new scope.ScopeError('That email address is already used by another account.');
                if (u.status === 'AwaitingActivation') {
                    // Not activated yet: fix the address and resend the link straight away.
                    u.email = v;
                    changed.push('email');
                    emailMessage = ' Use "Resend activation" to send the link to the new address.';
                } else {
                    const token = newToken();
                    u.pendingEmail = { email: v, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ACTIVATION_HOURS * 3600e3) };
                    await emails.sendEmailChangeConfirmation({ to: v, oldEmail: u.email, userName: u.userName, token });
                    await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'EMAIL_CHANGE_REQUESTED', before: { email: u.email }, after: { email: v } }, req);
                    emailMessage = ` A confirmation link was sent to ${v}; the change applies once it's confirmed.`;
                }
            }
        }

        if (!changed.length && !emailMessage) return res.json({ message: 'Nothing changed.' });
        await u.save();
        if (changed.length) {
            const after = snapshotUser(u);
            const pick = (s) => Object.fromEntries(changed.filter(f => f !== 'password').map(f => [f, s[f]]));
            await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'PROFILE_EDITED', before: pick(before), after: { ...pick(after), changedFields: changed } }, req);
            await tellAdmin(req, 'edited a customer', `${u.userId}: ${changed.join(', ')}.`);
        }
        res.json({ message: `Saved.${emailMessage}`, user: customerView(u.toObject()), password: tempPassword });
    } catch (err) { fail(res, err); }
};

// ── customers: tehsil / mouza assignment (§13) ───────────────────────────
exports.updateAssignment = async (req, res) => {
    try {
        onlyFields(req.body, ['assignment', 'activeTehsil', 'requestKey']);
        const u = await scope.findOwnedUser(req, req.params.userId);
        const now = new Date();
        const allowance = assignmentAllowance(u, now);
        if (!allowance.available) throw new scope.ScopeError(allowance.reason, 409);

        const table = await pricing.getCurrentTable();
        const isTrial = ['Trial24', 'Trial'].includes(u.subscriptionType);
        const maxMouzas = isTrial ? table.trialMaxMouzas : (u.customMouzaLimit || table.maxMouzas);
        const { merged, mouzaCount } = await scope.assertAssignmentAllowed({ subAdmin: req.subAdmin, requested: req.body.assignment, existing: u.tehsilAccess, maxMouzas });
        const { tehsilAccess, activeTehsil } = applyTehsilAssignmentsToUser(u, merged, req.body.activeTehsil ?? u.activeTehsil);

        const beforeFlat = flatMouzas(u.tehsilAccess);
        const afterFlat = flatMouzas(tehsilAccess);
        const added = afterFlat.filter(m => !beforeFlat.includes(m));
        const removed = beforeFlat.filter(m => !afterFlat.includes(m));
        if (!added.length && !removed.length && activeTehsil === u.activeTehsil) return res.json({ message: 'Nothing changed.' });

        // Before activation: free, no allowance used, nothing billed.
        if (u.status === 'AwaitingActivation') {
            u.tehsilAccess = tehsilAccess;
            u.activeTehsil = activeTehsil;
            u.markModified('tehsilAccess');
            await u.save();
            await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'ASSIGNMENT_CHANGED', after: { tehsilAccess, added, removed, beforeActivation: true } }, req);
            await tellAdmin(req, 'changed a customer\'s mouzas (before activation)', `${u.userId}: +${added.join(', ') || '—'} / −${removed.join(', ') || '—'}.`);
            return res.json({ message: 'Saved.', user: customerView(u.toObject()) });
        }

        // Paid period. Manual pricing for now: no automatic upgrade charge.
        const pp = u.paidPeriod || {};
        const q = { tierKey: u.planTier, pricingVersion: pp.pricingVersion };
        const charge = 0;

        // Atomic: only one change can ever succeed per paid period.
        const set = { tehsilAccess, activeTehsil, 'paidPeriod.changeUsed': true };
        const updated = await User.findOneAndUpdate(
            { _id: u._id, managedBy: req.subAdmin.userId, 'paidPeriod.changeUsed': { $ne: true } },
            { $set: set },
            { new: true }
        );
        if (!updated) throw new scope.ScopeError('This period\'s change was just used. Next change available after renewal.', 409);

        await recordEvent({
            userId: u.userId, ownerAtEvent: u.managedBy, type: 'ASSIGNMENT_CHANGED',
            before: { tehsilAccess: u.tehsilAccess }, after: { tehsilAccess, added, removed, allowanceUsed: true }, tier: q.tierKey
        }, req);
        if (charge > 0) {
            await recordEvent({
                userId: u.userId, ownerAtEvent: u.managedBy, type: 'TIER_UPGRADED',
                plan: pp.plan, tier: q.tierKey, periodStart: pp.start, periodEnd: pp.end,
                platformPrice: charge, paymentAmount: charge, billable: true, billDay: billing.pkDay(now),
                pricingVersion: q.pricingVersion,
                note: `${pp.tierPricePaid} → ${q.price} for ${Math.ceil((new Date(pp.end) - now) / 86400e3)} day(s) left`,
                requestKey: req.body.requestKey ? `upgrade:${req.subAdmin.userId}:${req.body.requestKey}` : undefined
            }, req);
            await billing.announceLine(req.subAdmin.userId, { amount: charge, userId: u.userId, label: `upgrade to ${mouzaCount} mouzas` });
            billing.checkCredit(req.subAdmin).catch(() => {});
        }
        await tellAdmin(req, 'changed a customer\'s mouzas', `${u.userId}: +${added.join(', ') || '—'} / −${removed.join(', ') || '—'}${charge > 0 ? `; upgrade billed Rs ${charge}` : ''}.`);
        tellUser(u.userId, { type: 'profile', title: 'Access updated', message: `Your mouzas were updated.${added.length ? ' Added: ' + added.join(', ') + '.' : ''}${removed.length ? ' Removed: ' + removed.join(', ') + '.' : ''}` });
        res.json({ message: charge > 0 ? `Saved. Upgrade charge Rs ${charge} added to today's bill.` : 'Saved.', upgradeCharge: charge, user: customerView(updated.toObject()) });
    } catch (err) { fail(res, err); }
};

// ── customers: renew (§15) ───────────────────────────────────────────────
exports.renew = async (req, res) => {
    try {
        onlyFields(req.body, ['plan', 'customerFee', 'requestKey']);
        const plan = String(req.body.plan || '');
        if (plan === 'Trial24') return giveTrial(req, res);
        if (!['Monthly', 'Yearly'].includes(plan) || !req.subAdmin.allowedPlans.includes(plan)) throw new scope.ScopeError('Renew as Monthly or Yearly.');
        const customerFee = Number(req.body.customerFee);
        if (!Number.isFinite(customerFee) || customerFee < 0) throw new scope.ScopeError('Enter the fee you are charging this customer (Rs).');
        const requestKey = String(req.body.requestKey || '').trim();
        if (!requestKey) throw new scope.ScopeError('Missing request key; please reload and try again.');
        const eventKey = `renew:${req.subAdmin.userId}:${requestKey}`;

        const u = await scope.findOwnedUser(req, req.params.userId);
        const repeat = await AccountEvent.findOne({ requestKey: eventKey }).lean();
        if (repeat) return res.json({ message: 'Already renewed.', repeated: true, user: customerView(u.toObject()) });
        if (u.status === 'AwaitingActivation') throw new scope.ScopeError('This customer hasn\'t activated yet. The plan starts and is billed when they click the activation link.');
        // Same plan already given today (by you or the admin) → don't subscribe/bill twice.
        if (await findSameDaySubscription(u, plan)) {
            return res.json({ message: `Already subscribed today (${plan} until ${new Date(u.endDate).toLocaleDateString('en-PK')}). Not subscribed or billed again.`, repeated: true, duplicate: true, user: customerView(u.toObject()) });
        }

        const mouzaCount = await scope.inScopeMouzaCount(req.subAdmin, u.tehsilAccess);
        // Manual pricing for now: the price the sub-admin enters is what the platform bills.
        const q = { price: customerFee, tierKey: u.planTier, pricingVersion: undefined };

        const now = new Date();
        // An early renewal continues from the current paid end; otherwise it starts now.
        const stillPaid = !['Trial24', 'Trial'].includes(u.subscriptionType) && u.status !== 'Suspended' && u.endDate && new Date(u.endDate) > now;
        const previous = { plan: u.subscriptionType, start: u.startDate, end: u.endDate };
        u.subscriptionType = plan;
        u.startDate = stillPaid ? new Date(u.endDate) : now;
        u.fee = customerFee;
        u.planTier = q.tierKey;
        await u.save();                                            // save hook sets endDate/status
        u.paidPeriod = { start: u.startDate, end: u.endDate, plan, tierPricePaid: q.price, pricingVersion: q.pricingVersion, changeUsed: false };
        await u.save();

        try {
            await recordEvent({
                userId: u.userId, ownerAtEvent: u.managedBy, type: 'RENEWED',
                plan, previousPlan: previous.plan, tier: q.tierKey,
                periodStart: u.startDate, periodEnd: u.endDate, previousPeriodStart: previous.start, previousPeriodEnd: previous.end,
                customerFee, platformPrice: q.price, paymentAmount: q.price,
                billable: true, billDay: billing.pkDay(now), pricingVersion: q.pricingVersion, requestKey: eventKey
            }, req, { throwOnDuplicate: true });
        } catch (dup) {
            return res.json({ message: 'Already renewed.', repeated: true, user: customerView(u.toObject()) });
        }

        await billing.announceLine(req.subAdmin.userId, { amount: q.price, userId: u.userId, label: `${plan}, ${mouzaCount} mouza(s)` });
        billing.checkCredit(req.subAdmin).catch(() => {});
        await tellAdmin(req, 'renewed a customer', `${u.userId} — ${plan}, ${mouzaCount} mouza(s), billed Rs ${q.price}.`);
        tellUser(u.userId, { type: 'subscription', title: 'Subscription renewed', message: `Your ${plan} subscription is valid until ${new Date(u.endDate).toLocaleDateString('en-PK')}.` });
        if (u.email) {
            emails.sendCustomerRenewal({ to: u.email, userName: u.userName, planLabel: planLabel(plan, mouzaCount), periodEnd: u.endDate, customerFee, provider: await provider.getProviderForUser(u) });
        }
        res.json({ message: `Renewed until ${new Date(u.endDate).toLocaleDateString('en-PK')}. Rs ${q.price} added to today's bill.`, billed: q.price, user: customerView(u.toObject()) });
    } catch (err) { fail(res, err); }
};

// ── customers: suspend / reactivate ──────────────────────────────────────
exports.suspend = async (req, res) => {
    try {
        onlyFields(req.body, ['reason']);
        const u = await scope.findOwnedUser(req, req.params.userId);
        if (u.status === 'Suspended') return res.json({ message: 'Already suspended.' });
        if (u.status === 'AwaitingActivation') throw new scope.ScopeError('This customer hasn\'t activated yet.');
        u.status = 'Suspended';
        u.tokenVersion = (u.tokenVersion || 0) + 1;
        await u.save();
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'SUSPENDED', note: String(req.body.reason || '').slice(0, 300) }, req);
        await tellAdmin(req, 'suspended a customer', `${u.userId}${req.body.reason ? ': ' + req.body.reason : ''}.`);
        res.json({ message: 'Customer suspended. Their paid time keeps running.', user: customerView(u.toObject()) });
    } catch (err) { fail(res, err); }
};

exports.reactivate = async (req, res) => {
    try {
        const u = await scope.findOwnedUser(req, req.params.userId);
        if (u.status !== 'Suspended') return res.json({ message: 'This customer is not suspended.' });
        u.status = 'Active';                        // save hook recomputes Active/Expired from the dates
        await u.save();
        await recordEvent({ userId: u.userId, ownerAtEvent: u.managedBy, type: 'REACTIVATED' }, req);
        await tellAdmin(req, 'reactivated a customer', `${u.userId}.`);
        res.json({ message: 'Customer reactivated.', user: customerView(u.toObject()) });
    } catch (err) { fail(res, err); }
};

// ── requests to the admin (§14, §20) ─────────────────────────────────────
exports.createRequest = async (req, res) => {
    try {
        onlyFields(req.body, ['kind', 'userId', 'eventId', 'assignment', 'reason']);
        const kind = req.body.kind;
        if (!['correction', 'more_mouzas', 'extra_change'].includes(kind)) throw new scope.ScopeError('Unknown request type.');
        const reason = String(req.body.reason || '').trim();
        if (reason.length < 5) throw new scope.ScopeError('Please explain the reason.');
        const u = await scope.findOwnedUser(req, req.body.userId);

        const doc = { kind, subAdminId: req.subAdmin.userId, userId: u.userId, reason: reason.slice(0, 1000) };
        if (kind === 'correction') {
            const ev = await AccountEvent.findOne({ _id: req.body.eventId, userId: u.userId, ownerAtEvent: req.subAdmin.userId, billable: true, platformPrice: { $gt: 0 } }).lean();
            if (!ev) throw new scope.ScopeError('Choose one of this customer\'s billed actions to correct.');
            if (await SubAdminRequest.exists({ kind: 'correction', eventId: ev._id, status: { $in: ['pending', 'approved'] } })) throw new scope.ScopeError('A correction for this action was already requested.');
            doc.eventId = ev._id;
        } else {
            const requested = scope.normaliseAssignment(req.body.assignment || []);
            for (const a of requested) {
                if (!(await scope.tehsilInTerritory(a.tehsil, req.subAdmin.territory))) throw new scope.ScopeError(`${a.tehsil} is outside your territory.`, 403);
                if (!a.mouzas.length) throw new scope.ScopeError(`Choose the mouzas you need in ${a.tehsil}.`);
            }
            doc.requestedAssignment = requested;
        }
        const created = await SubAdminRequest.create(doc);
        const label = { correction: 'requested a correction', more_mouzas: 'requested more mouzas', extra_change: 'requested an extra mouza change' }[kind];
        await tellAdmin(req, label, `${u.userId}: ${reason}`, 'alert');
        res.status(201).json({ message: 'Request sent to the admin.', request: created });
    } catch (err) { fail(res, err); }
};

exports.listRequests = async (req, res) => {
    try {
        const rows = await SubAdminRequest.find({ subAdminId: req.subAdmin.userId }).sort({ createdAt: -1 }).limit(200).lean();
        res.json({ requests: rows });
    } catch (err) { fail(res, err); }
};

// ── money ────────────────────────────────────────────────────────────────
exports.today = async (req, res) => {
    try {
        const t = await billing.todayTotal(req.subAdmin.userId);
        const lines = await billing.billLines(req.subAdmin.userId, t.day);
        res.json({ ...t, lines });
    } catch (err) { fail(res, err); }
};

exports.listBills = async (req, res) => {
    try {
        const pos = await billing.computePosition(req.subAdmin);
        const bills = pos.allocations.map(a => ({ ...a.bill, paidAmount: a.paid, unpaid: a.unpaid, overdue: a.unpaid > 0 && a.bill.dueAt && new Date(a.bill.dueAt) <= new Date() })).reverse();
        res.json({ bills, position: { balance: pos.balance, overdue: pos.overdue, advanceCredit: pos.advanceCredit, today: pos.today } });
    } catch (err) { fail(res, err); }
};

exports.getBill = async (req, res) => {
    try {
        const bill = await SubAdminBill.findOne({ _id: req.params.id, subAdminId: req.subAdmin.userId }).lean();
        if (!bill) return res.status(404).json({ message: 'Bill not found' });
        res.json({ bill, lines: await billing.billLines(req.subAdmin.userId, bill.day) });
    } catch (err) { fail(res, err); }
};

exports.listPayments = async (req, res) => {
    try {
        const rows = await SubAdminPayment.find({ subAdminId: req.subAdmin.userId }).sort({ createdAt: -1 }).limit(500).select('-recordedBy').lean();
        res.json({ payments: rows });
    } catch (err) { fail(res, err); }
};

// ── insights (§23.3) — own customers only ───────────────────────────────
exports.stats = async (req, res) => {
    try {
        const me = req.subAdmin.userId;
        const now = new Date();
        const own = { managedBy: me, userType: 'user' };
        const in7 = new Date(now.getTime() + 7 * 86400e3);
        const since = new Date(now.getTime() - 365 * 86400e3);
        const tzMonth = { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:00' } };
        const tzDay = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:00' } };
        // Same "sale" definition as the admin's sub-admin list.
        const salesSvc = require('../services/subAdminSales');
        const saleQ = await salesSvc.saleMatch(me);

        const [counts, tierMix, byTehsil, registrations, renewalsByMonth, feesByMonth, renewalsList, online] = await Promise.all([
            User.aggregate([{ $match: own }, { $group: {
                _id: null,
                total: { $sum: 1 },
                awaiting: { $sum: { $cond: [{ $eq: ['$status', 'AwaitingActivation'] }, 1, 0] } },
                suspended: { $sum: { $cond: [{ $eq: ['$status', 'Suspended'] }, 1, 0] } },
                trial: { $sum: { $cond: [{ $and: [{ $in: ['$subscriptionType', ['Trial24', 'Trial']] }, { $gt: ['$endDate', now] }] }, 1, 0] } },
                active: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['AwaitingActivation', 'Suspended']] }] }, { $gt: ['$endDate', now] }] }, 1, 0] } },
                expiring: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['AwaitingActivation', 'Suspended']] }] }, { $gt: ['$endDate', now] }, { $lte: ['$endDate', in7] }] }, 1, 0] } },
                expired: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'AwaitingActivation'] }, { $lte: ['$endDate', now] }] }, 1, 0] } },
                monthly: { $sum: { $cond: [{ $eq: ['$subscriptionType', 'Monthly'] }, 1, 0] } },
                yearly: { $sum: { $cond: [{ $eq: ['$subscriptionType', 'Yearly'] }, 1, 0] } },
                // Mouza counts (basis for mouza-based billing)
                mouzas: { $sum: { $reduce: { input: { $ifNull: ['$tehsilAccess', []] }, initialValue: 0, in: { $add: ['$$value', { $size: { $ifNull: ['$$this.mouzas', []] } }] } } } },
                activeMouzas: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['AwaitingActivation', 'Suspended']] }] }, { $gt: ['$endDate', now] }] }, { $reduce: { input: { $ifNull: ['$tehsilAccess', []] }, initialValue: 0, in: { $add: ['$$value', { $size: { $ifNull: ['$$this.mouzas', []] } }] } } }, 0] } }
            } }]),
            User.aggregate([{ $match: { ...own, planTier: { $ne: null } } }, { $group: { _id: '$planTier', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
            User.aggregate([{ $match: own }, { $unwind: '$tehsilAccess' }, { $group: { _id: '$tehsilAccess.tehsil', users: { $sum: 1 } } }, { $sort: { users: -1 } }, { $limit: 20 }]),
            AccountEvent.aggregate([{ $match: { ownerAtEvent: me, type: 'USER_CREATED', createdAt: { $gte: since } } }, { $group: { _id: tzDay, count: { $sum: 1 }, trials: { $sum: { $cond: [{ $eq: ['$plan', 'Trial24'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
            AccountEvent.aggregate([{ $match: { ...saleQ, createdAt: { $gte: since } } }, { $group: { _id: tzMonth, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
            AccountEvent.aggregate([{ $match: { ownerAtEvent: me, billable: true, type: { $ne: 'BALANCE_ADJUSTED' }, createdAt: { $gte: since } } }, { $group: {
                _id: tzMonth,
                platformCharges: { $sum: '$platformPrice' },
                customerFees: { $sum: { $ifNull: ['$customerFee', 0] } }
            } }, { $sort: { _id: 1 } }]),
            AccountEvent.aggregate([
                { $match: { ...saleQ, createdAt: { $gte: new Date(now.getTime() - 730 * 86400e3) } } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: 'userId', pipeline: [{ $project: { _id: 0, userName: 1 } }], as: 'u' } },
                { $project: { _id: 0, userId: 1, userName: { $ifNull: [{ $first: '$u.userName' }, '$userId'] }, subscriptionType: '$plan', type: 1, date: '$createdAt', fee: { $ifNull: ['$customerFee', 0] }, platformPrice: { $ifNull: ['$platformPrice', 0] } } },
                { $sort: { date: -1 } }
            ]),
            User.find({ ...own, lastActive: { $gte: new Date(now.getTime() - 5 * 60 * 1000) } }).select('userId userName lastActive activeTehsil subscriptionType endDate mobileNumber').sort({ lastActive: -1 }).lean()
        ]);

        const created = await AccountEvent.countDocuments({ ownerAtEvent: me, type: 'USER_CREATED', createdAt: { $gte: since } });
        const activated = await AccountEvent.countDocuments({ ownerAtEvent: me, type: 'ACTIVATED', createdAt: { $gte: since } });
        const trialsStarted = await AccountEvent.countDocuments({ ownerAtEvent: me, type: 'ACTIVATED', plan: 'Trial24', createdAt: { $gte: since } });
        const trialConversions = await AccountEvent.countDocuments({ ownerAtEvent: me, type: 'RENEWED', previousPlan: 'Trial24', createdAt: { $gte: since } });
        const renewalsDue = await AccountEvent.countDocuments({ ownerAtEvent: me, type: { $in: ['RENEWED', 'ACTIVATED'] }, billable: true, periodEnd: { $gte: since, $lte: now } });
        const renewedAgain = await AccountEvent.countDocuments({ ownerAtEvent: me, type: 'RENEWED', billable: true, previousPlan: { $in: ['Monthly', 'Yearly'] }, createdAt: { $gte: since } });

        const c = counts[0] || { total: 0, awaiting: 0, suspended: 0, trial: 0, active: 0, expiring: 0, expired: 0, monthly: 0, yearly: 0, mouzas: 0, activeMouzas: 0 };
        delete c._id;
        // Rolling 30 days (a calendar month read 0 on the 1st); same window as the 30-day Performance view.
        c.salesThisMonth = await AccountEvent.countDocuments({ ...saleQ, createdAt: { $gte: new Date(now.getTime() - 30 * 86400e3) } });
        const months = feesByMonth.map(m => ({ month: m._id, customerFees: m.customerFees, platformCharges: m.platformCharges, margin: m.customerFees - m.platformCharges }));
        const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

        res.json({
            overview: c,
            tierMix: tierMix.map(t => ({ tier: t._id, count: t.count })),
            byTehsil: byTehsil.map(t => ({ tehsil: t._id, users: t.users })),
            registrationsDaily: registrations.map(r => ({ date: r._id, count: r.count, trials: r.trials })),
            renewalsByMonth: renewalsByMonth.map(r => ({ month: r._id, count: r.count })),
            recentRenewals: renewalsList,
            business: {
                months,
                totals: months.reduce((a, m) => ({ customerFees: a.customerFees + m.customerFees, platformCharges: a.platformCharges + m.platformCharges, margin: a.margin + m.margin }), { customerFees: 0, platformCharges: 0, margin: 0 })
            },
            health: {
                activationRate: pct(activated, created),
                trialConversionRate: pct(trialConversions, trialsStarted),
                renewalRate: pct(renewedAgain, renewalsDue),
                createdLast12Months: created
            },
            online: online.map(o => ({ userId: o.userId, userName: o.userName, lastActive: o.lastActive, activeTehsil: o.activeTehsil, subscriptionType: o.subscriptionType, endDate: o.endDate, mobileNumber: o.mobileNumber }))
        });
    } catch (err) { fail(res, err); }
};

module.exports.helpers = { hashToken, newToken, generatePassword, assignmentAllowance, planLabel, flatMouzas, customerView, ACTIVATION_HOURS };
