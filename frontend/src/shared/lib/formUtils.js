// Ported from legacy src/utils/formUtils.js
// src/utils/formUtils.js
export const formatEndDateToDMY = (dateStr) => {
  if (!dateStr) return '';
  if (dateStr.toLowerCase().includes('permanent') || dateStr === 'Permanent') {
    return dateStr;
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

export const formatPhoneNumber = (value) => {
  if (!value) return '+92 ';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0092')) {
    digits = digits.substring(4);
  } else if (digits.startsWith('92')) {
    digits = digits.substring(2);
  } else if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  digits = digits.substring(0, 10);
  if (digits.length === 0) {
    return '+92 ';
  }
  if (digits.length <= 3) {
    return `+92 ${digits}`;
  }
  return `+92 ${digits.substring(0, 3)} ${digits.substring(3)}`;
};

export const uniqSort = (arr) =>
  Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));

export const normalizeMauzas = (list = []) =>
  uniqSort(
    list
      .map((m) => (typeof m === 'string' ? m.trim() : String(m)))
      .filter((m) => m && !m.toLowerCase().includes('-complete'))
  );

export const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((val, idx) => val === b[idx]);
