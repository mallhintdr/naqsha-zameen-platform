// fetch() for land-record vector data (GeoJSON / metadata JSON) from our backend.
// - sends X-NZ-Client: dashboard (the backend refuses vector data without it)
// - asks for the obfuscated envelope (Accept: application/x-nz-vector) and decodes it,
//   so DevTools "Save response" yields nothing directly reusable
// - returns a Response-like object: callers keep using res.ok / res.status / res.json()
// Requests to other hosts (CDN, R2 worker) are passed through untouched.
// See docs/security/GEOJSON.md.
import { apiBase } from '@/shared/api/base';
import { ENVELOPE_TYPE, envelopeSupported, importEnvelopeKey, openEnvelope, decodePlain } from './vectorEnvelope';

export const VECTOR_CLIENT_HEADER = 'X-NZ-Client';
export const VECTOR_CLIENT_VALUE = 'dashboard';

const WANT_ENVELOPE = import.meta.env.VITE_VECTOR_ENVELOPE !== 'false';

function isOwnBackend(url) {
  const u = String(url);
  if (u.startsWith('/') && !u.startsWith('//')) return true;
  const base = apiBase();
  if (base && u.startsWith(base)) return true;
  try {
    return typeof window !== 'undefined' && new URL(u, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Headers to add to our own vector requests made with other clients (e.g. axios). */
export const vectorHeaders = () => ({ [VECTOR_CLIENT_HEADER]: VECTOR_CLIENT_VALUE });

const keys = new Map(); // kid -> Promise<CryptoKey>

function getKey(kid, refresh = false) {
  if (refresh) keys.delete(kid);
  if (!keys.has(kid)) {
    const p = fetch(`${apiBase()}/api/vector-key?kid=${encodeURIComponent(kid)}`, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`vector key ${r.status}`);
        const j = await r.json();
        if (!j.enabled || !j.key) throw new Error('vector key unavailable');
        return importEnvelopeKey(j.key);
      });
    p.catch(() => keys.delete(kid));
    keys.set(kid, p);
    if (keys.size > 4) keys.delete(keys.keys().next().value);
  }
  return keys.get(kid);
}

async function decodeEnvelope(buffer, kid) {
  try {
    return decodePlain(await openEnvelope(buffer, await getKey(kid)));
  } catch {
    // Key rotated or session changed: fetch the key again once.
    return decodePlain(await openEnvelope(buffer, await getKey(kid, true)));
  }
}

function decodedResponse(res, data) {
  const headers = new Headers(res.headers);
  headers.set('content-type', 'application/json');
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    headers,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

/**
 * Drop-in replacement for fetch() on vector data URLs.
 * @param {string} url
 * @param {RequestInit} [init]
 */
export async function vectorFetch(url, init = {}) {
  if (!isOwnBackend(url)) return fetch(url, init);
  const headers = new Headers(init.headers || {});
  headers.set(VECTOR_CLIENT_HEADER, VECTOR_CLIENT_VALUE);
  if (WANT_ENVELOPE && envelopeSupported()) headers.set('Accept', `${ENVELOPE_TYPE}, application/json;q=0.9`);
  const res = await fetch(url, { credentials: 'include', ...init, headers });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes(ENVELOPE_TYPE)) return res;
  const data = await decodeEnvelope(await res.arrayBuffer(), res.headers.get('X-NZ-Kid') || '0');
  return decodedResponse(res, data);
}
