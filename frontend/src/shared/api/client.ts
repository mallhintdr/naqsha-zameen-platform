/**
 * Fetch-based HTTP client with an axios-like surface so legacy call sites port mechanically:
 *   const { data } = await api.get('/api/x', { params });
 *   catch (e) { e.response?.status; e.response?.data }
 * Handles cookie credentials, the CSRF header on mutating requests (the token is bound to
 * the authToken cookie, so it is dropped after login/logout and on any 403), JSON bodies,
 * query params, timeouts, AbortSignal and blob responses.
 */
import { apiUrl } from './base';

export interface RequestOptions {
  params?: Record<string, any>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'blob' | 'text';
}
export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Headers;
}
export class ApiError extends Error {
  response?: { status: number; data: any };
  code?: string;
  constructor(message: string, response?: { status: number; data: any }, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.response = response;
    this.code = code;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfToken: string | null = null;
let csrfInflight: Promise<string | null> | null = null;

export const resetCsrfToken = () => {
  csrfToken = null;
};

export async function fetchCsrfToken(): Promise<string | null> {
  if (csrfInflight) return csrfInflight;
  csrfInflight = (async () => {
    try {
      const r = await fetch(apiUrl('/api/csrf-token'), { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      csrfToken = j.csrfToken || null;
      return csrfToken;
    } catch {
      return null;
    } finally {
      csrfInflight = null;
    }
  })();
  return csrfInflight;
}

const resolveUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : apiUrl(url.startsWith('/') ? url : `/${url}`));

function withParams(url: string, params?: Record<string, any>) {
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes('?') ? '&' : '?'}${s}` : url;
}

async function request<T = any>(method: string, url: string, body?: any, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) };
  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || body instanceof Blob) payload = body;
    else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  if (MUTATING.has(method)) {
    if (!csrfToken) await fetchCsrfToken();
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
  }

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = opts.timeout ? setTimeout(() => ctrl.abort(), opts.timeout) : null;

  let res: Response;
  try {
    res = await fetch(withParams(resolveUrl(url), opts.params), {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e: any) {
    const canceled = !!opts.signal?.aborted;
    throw new ApiError(canceled ? 'canceled' : e?.message || 'Network Error', undefined, canceled ? 'ERR_CANCELED' : 'ERR_NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  let data: any;
  const type = res.headers.get('content-type') || '';
  if (opts.responseType === 'blob' && res.ok) data = await res.blob();
  else if (opts.responseType === 'text') data = await res.text();
  else if (type.includes('application/json')) data = await res.json().catch(() => null);
  else {
    const t = await res.text();
    try {
      data = JSON.parse(t);
    } catch {
      data = t;
    }
  }

  if (!res.ok) {
    if (res.status === 403) csrfToken = null;
    const msg = (data && typeof data === 'object' && (data.message || data.error)) || `Request failed with status ${res.status}`;
    throw new ApiError(msg, { status: res.status, data });
  }
  return { data, status: res.status, headers: res.headers };
}

export const api = {
  get: <T = any>(url: string, opts?: RequestOptions) => request<T>('GET', url, undefined, opts),
  delete: <T = any>(url: string, opts?: RequestOptions & { data?: any }) => request<T>('DELETE', url, opts?.data, opts),
  post: <T = any>(url: string, body?: any, opts?: RequestOptions) => request<T>('POST', url, body ?? {}, opts),
  put: <T = any>(url: string, body?: any, opts?: RequestOptions) => request<T>('PUT', url, body ?? {}, opts),
  patch: <T = any>(url: string, body?: any, opts?: RequestOptions) => request<T>('PATCH', url, body ?? {}, opts),
};

export const isCancel = (e: any) => e?.code === 'ERR_CANCELED';

/** Same as legacy subAdminApi.errText */
export const errText = (err: any, fallback = 'Something went wrong') =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

if (typeof window !== 'undefined') fetchCsrfToken();
