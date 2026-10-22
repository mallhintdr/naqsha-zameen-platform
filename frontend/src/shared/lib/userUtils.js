// Ported from legacy src/utils/userUtils.js
// userUtils.js
import { api } from '@/shared/api/client';
import { apiBase } from '@/shared/api/base';

export const fetchMauzasByTehsil = async (tehsil) => {
  if (!tehsil) return [];
  try {
    const apiBaseUrl = apiBase();
    const { data } = await api.get(`${apiBaseUrl}/api/mauza-list/${encodeURIComponent(tehsil)}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    // console.error('Failed to fetch mauzas:', err.message);
    return [];
  }
};

export const subscriptionOptions = [
  { value: 'Trial', days: 2 },
  { value: 'Weekly', days: 7 },
  { value: 'Monthly', days: 30 },
  { value: 'Quarterly', days: 90 },
  { value: 'Half-Yearly', days: 180 },
  { value: 'Yearly', days: 365 },
  { value: 'Permanent', days: -1 }, // -1 indicates never expires
];

// Helper function to get GMT+5 time
const getGMTPlus5Date = (date = new Date()) => {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  return new Date(utc + (5 * 60 * 60 * 1000)); // GMT+5
};

export const calculateEndDate = (startDate, subscriptionType) => {
  if (!startDate || isNaN(new Date(startDate).getTime())) {
    // console.error("Invalid startDate provided:", startDate);
    return null;
  }

  const option = subscriptionOptions.find(opt => opt.value === subscriptionType);
  const days = option ? option.days : 0;

  // Handle permanent subscription
  if (days === -1) {
    return new Date('2099-12-31'); // Far future date for permanent
  }

  // Convert start date to GMT+5
  const start = getGMTPlus5Date(new Date(startDate));

  // Set the end date as a Date object in GMT+5
  const endDate = new Date(start);
  endDate.setDate(start.getDate() + days);
  return endDate; // Returns a Date object
};

export const calculateDaysRemaining = (startDate, subscriptionType) => {
  const endDate = calculateEndDate(startDate, subscriptionType);
  if (!endDate) return 0;

  // Handle permanent subscription
  if (subscriptionType === 'Permanent') {
    return 99999; // Never expires (using a large finite number instead of Infinity)
  }

  // Use GMT+5 for current date calculation
  const today = getGMTPlus5Date();
  today.setHours(0, 0, 0, 0);

  // endDate is already in GMT+5 from calculateEndDate
  // Ensure we compare apples to apples (both GMT+5 'fake' dates)
  const endDateGMT5 = new Date(endDate);
  endDateGMT5.setHours(0, 0, 0, 0);

  return Math.max(Math.ceil((endDateGMT5 - today) / (1000 * 60 * 60 * 24)), 0);
};

export const calculateStatus = (endDate, subscriptionType) => {
  // Handle permanent subscription
  if (subscriptionType === 'Permanent') {
    return 'Active';
  }

  // Use GMT+5 for status calculation
  const today = getGMTPlus5Date();
  today.setHours(0, 0, 0, 0);

  // endDate is already GMT+5
  const endDateGMT5 = endDate ? new Date(endDate) : null;
  if (endDateGMT5) {
    endDateGMT5.setHours(0, 0, 0, 0);
  }

  return endDateGMT5 && endDateGMT5 >= today ? 'Active' : 'Expired';
};

export const getCurrentDate = () => {
  // Return current date in GMT+5
  const today = getGMTPlus5Date();
  return today.toISOString().split('T')[0];
};

// Export the GMT+5 helper function for use in other components
export const getGMTPlus5Time = getGMTPlus5Date;

