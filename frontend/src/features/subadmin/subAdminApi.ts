// Shared helpers for the sub-admin program screens (legacy components/Admin/subAdminApi.js).
import { api as http, errText as baseErrText } from '@/shared/api/client';
import { fmtDate as fmtD, fmtDateTime as fmtDT, rs as fmtRs } from '@/shared/lib/format';

/** Thin wrapper that resolves to response.data (legacy contract). */
export const api = {
  get: (path: string, params?: Record<string, any>) => http.get(path, { params }).then((r) => r.data),
  post: (path: string, body?: any) => http.post(path, body).then((r) => r.data),
  put: (path: string, body?: any) => http.put(path, body).then((r) => r.data),
  patch: (path: string, body?: any) => http.patch(path, body).then((r) => r.data),
};

export const errText = (err: any, fallback = 'Something went wrong.') => baseErrText(err, fallback);

/** Unique key per submit, so a double click or retry is never billed twice. */
export const newRequestKey = () =>
  window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// D6: Rs {en-PK}, dd-mm-yyyy
export const rs = (n: any) => fmtRs(n);
export const fmtDate = (d: any) => fmtD(d);
export const fmtDateTime = (d: any) => fmtDT(d);

export type BadgeBg = 'success' | 'primary' | 'danger' | 'warning' | 'info' | 'secondary' | 'dark' | 'light';

export const STATUS_VARIANT: Record<string, BadgeBg> = {
  Active: 'success', Trial: 'info', Expired: 'secondary', Suspended: 'danger',
  AwaitingActivation: 'warning', Pending: 'warning', PendingVerification: 'warning',
};
export const STATUS_LABEL: Record<string, string> = { AwaitingActivation: 'Awaiting activation', PendingVerification: 'Pending verification' };

export const SUBADMIN_STATUS: Record<string, [string, BadgeBg]> = {
  awaiting_activation: ['Awaiting activation', 'warning'],
  active: ['Active', 'success'],
  final_warning: ['Final warning', 'danger'],
  suspended_unpaid: ['Suspended (unpaid)', 'danger'],
  disabled: ['Disabled', 'dark'],
};

export const PLAN_LABEL: Record<string, string> = { Trial24: '24-hour trial', Monthly: 'Monthly', Yearly: 'Yearly' };
