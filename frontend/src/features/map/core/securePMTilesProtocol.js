// Secure PMTiles Protocol - authenticates PMTiles requests via the session cookie.
// Auth is the httpOnly `authToken` cookie set by the backend at login; it is sent
// automatically with `credentials: 'include'`. There is intentionally no token in
// localStorage (XSS-safe), so no Authorization header is constructed here.
import { PMTiles } from 'pmtiles';

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
 * Alternative: wrap the global fetch so PMTiles requests always include the
 * session cookie via `credentials: 'include'`.
 */
export const setupSecurePMTilesFetch = () => {
  const originalFetch = window.fetch;

  window.fetch = function(...args) {
    let [url, options = {}] = args;

    // Check if this is a PMTiles request
    if (typeof url === 'string' && url.includes('.pmtiles')) {
      options = {
        ...options,
        credentials: 'include'
      };
    }

    return originalFetch.call(this, url, options);
  };
};
