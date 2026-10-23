// Secure PMTiles Protocol - authenticates PMTiles requests via the session cookie.
// Auth is the httpOnly `authToken` cookie set by the backend at login; it is sent
// automatically with `credentials: 'include'`. There is intentionally no token in
// localStorage (XSS-safe), so no Authorization header is constructed here.
import { PMTiles } from 'pmtiles';
import { isWorkerUrl, refreshSignedWorkerUrl } from '@/features/map/config/pmtiles';

/**
 * Creates a secure PMTiles instance that authenticates via the session cookie.
 * @param {string} url - The PMTiles URL (relative or absolute)
 * @returns {PMTiles} - Configured PMTiles instance with auth
 */
export const createSecurePMTiles = (url) => {
  const fetchRange = async (offset, length) => {
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=${offset}-${offset + length - 1}`
      },
      credentials: 'include' // Send the httpOnly auth cookie
    });

    if (!response.ok) {
      throw new Error(`PMTiles fetch failed: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  };

  const source = {
    getKey: (offset, length) => fetchRange(offset, length),
    getBytes: (offset, length) => fetchRange(offset, length)
  };

  return new PMTiles(source);
};

/**
 * Wrap the global fetch so PMTiles requests always include the session cookie
 * via `credentials: 'include'`, and so requests to the tile worker never go out
 * with an expired signed URL.
 *
 * A PMTiles reader keeps the URL it was created with for the whole session,
 * but signed worker URLs only live 15 minutes. Here an about-to-expire worker
 * URL is swapped for a freshly signed one for the same file, and a 403
 * (expired/invalid token) is retried once with a new signature. The reader's
 * own cache key (the original URL) and the file's ETag do not change.
 */
let fetchPatched = false;
export const setupSecurePMTilesFetch = () => {
  if (fetchPatched || typeof window === 'undefined') return;
  fetchPatched = true;
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    let [url, options = {}] = args;

    if (typeof url !== 'string' || !url.includes('.pmtiles')) {
      return originalFetch.call(this, url, options);
    }

    options = { ...options, credentials: 'include' };

    if (!isWorkerUrl(url)) return originalFetch.call(this, url, options);

    let signed = url;
    try { signed = await refreshSignedWorkerUrl(url); } catch { /* use the URL we have */ }
    let response = await originalFetch.call(this, signed, options);

    if (response.status === 403 && !(options.signal && options.signal.aborted)) {
      let fresh = signed;
      try { fresh = await refreshSignedWorkerUrl(url, { force: true }); } catch { /* keep 403 */ }
      if (fresh !== signed) response = await originalFetch.call(this, fresh, options);
    }
    return response;
  };
};
