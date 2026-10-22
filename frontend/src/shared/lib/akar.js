// Ported from legacy src/utils/akar.js
// AKAR (Cholistan state-land) chaks are assigned by the admin only.
// Same rule as backend/utils/akarGuard.js: the tehsil named exactly "AKAR-Cholistan".
export const AKAR_MESSAGE = 'AKAR chaks can only be assigned by the admin. Please contact the admin for access.';

export const isAkarTehsil = (name) => {
  const n = typeof name === 'object' && name !== null ? (name.name || name.tehsil || name.label || '') : name;
  return String(n || '').trim().toLowerCase() === 'akar-cholistan';
};

/** Remove AKAR tehsils from a list of names or {name} / {tehsil} objects. */
export const withoutAkar = (list) => (Array.isArray(list) ? list.filter(t => !isAkarTehsil(t)) : list);
