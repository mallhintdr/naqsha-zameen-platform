// Plans measured in exact hours from the moment they start (activation), not
// in whole Pakistan calendar days. A trial activated at 23:00 ends at 23:00.
const HOUR_BASED_PLANS = {
  Trial: 48,     // public sign-ups and trials you create
  Trial24: 24    // trials created by sub-admins
};

const DAY_BASED_PLANS = {
  Weekly: 7,
  Monthly: 30,
  Quarterly: 90,
  Biannual: 180,
  'Half-Yearly': 180,
  Annual: 365,
  Yearly: 365
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = 5 * HOUR_MS; // GMT+5

const isHourBasedPlan = (subscriptionType) => Object.prototype.hasOwnProperty.call(HOUR_BASED_PLANS, subscriptionType);

const calculateDatesAndStatus = (startDate, subscriptionType) => {
  const startInput = new Date(startDate);
  if (!startDate || Number.isNaN(startInput.getTime())) {
    return { endDate: null, daysRemaining: 0, hoursRemaining: 0, status: 'Expired' };
  }

  if (subscriptionType === 'Permanent') {
    return {
      endDate: new Date('2099-12-31'),
      daysRemaining: 99999, // large finite number instead of Infinity for JSON serialization
      hoursRemaining: 99999 * 24,
      status: 'Active'
    };
  }

  if (isHourBasedPlan(subscriptionType)) {
    const endDate = new Date(startInput.getTime() + HOUR_BASED_PLANS[subscriptionType] * HOUR_MS);
    const msLeft = endDate.getTime() - Date.now();
    return {
      endDate,
      daysRemaining: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
      hoursRemaining: msLeft > 0 ? Math.ceil(msLeft / HOUR_MS) : 0,
      status: msLeft > 0 ? 'Active' : 'Expired'
    };
  }

  const start = new Date(startInput.getTime() + OFFSET_MS);
  start.setUTCHours(0, 0, 0, 0);

  const days = DAY_BASED_PLANS[subscriptionType] || 0;
  const endLocal = new Date(start);
  endLocal.setUTCDate(endLocal.getUTCDate() + days);
  const endDate = new Date(endLocal.getTime() - OFFSET_MS);

  const today = new Date(Date.now() + OFFSET_MS);
  today.setUTCHours(0, 0, 0, 0);

  const diff = endLocal - today;
  const daysRemaining = diff >= 0 ? Math.ceil(diff / DAY_MS) : 0;
  const status = daysRemaining > 0 ? 'Active' : 'Expired';
  const msLeft = endDate.getTime() - Date.now();

  return { endDate, daysRemaining, hoursRemaining: msLeft > 0 ? Math.ceil(msLeft / HOUR_MS) : 0, status };
};

module.exports = { calculateDatesAndStatus, isHourBasedPlan, HOUR_BASED_PLANS, DAY_BASED_PLANS };
