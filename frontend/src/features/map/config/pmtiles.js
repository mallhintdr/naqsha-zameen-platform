// Ported from legacy src/config/pmtiles.js. Signed URLs always come from the backend
// (15-minute lifetime, re-signed 4 minutes before expiry); there is no unsigned fallback.
/**
 * PMTiles Configuration
 * 
 * Centralized configuration for PMTiles URL generation.
 * Supports two modes:
 * 1. 'local' - Serve PMTiles from backend Express server (development/fallback)
 * 2. 'cloudflare' - Serve PMTiles from Cloudflare Worker + R2 (production)
 * 
 * Mode is controlled by REACT_APP_PMTILES_MODE environment variable.
 * 
 * Usage:
 *   import { getSignedPMTilesUrl } from './config/pmtiles';
 *   const url = await getSignedPMTilesUrl('yazman', 'chak-1', '123-45');
 */

import { api } from '@/shared/api/client';
import { apiBase, CLOUDFLARE_WORKER_URL } from '@/shared/api/base';

// Cache for signed URLs to avoid repeated backend requests
// Key format: "tehsil/mouza/murabba" -> { url: string, expiresAt: timestamp }
const signedUrlCache = new Map();

// Signed URLs live 15 min (backend PMTILES_URL_TTL_SECONDS). A cached URL is
// reused until it is within this buffer of expiry, then re-signed.
// Expired / pending accounts get the map as PMTiles tiles only: the server refuses
// their GeoJSON requests (EXPIRED_TILES_ONLY), so the loaders skip GeoJSON entirely.
let tilesOnly = false;
export function setTilesOnly(on) { tilesOnly = Boolean(on); }
export function isTilesOnly() { return tilesOnly; }

export const SIGNED_URL_REFRESH_BUFFER_MS = 240000; // 4 min

// Worker pathname (as signed) -> file spec, so a long-lived PMTiles reader can
// swap an about-to-expire URL for a fresh one (see securePMTilesProtocol.js).
const issuedSpecs = new Map();

function specCacheKey({ tehsil, mouza, murabba, filename }) {
  return filename
    ? `${tehsil}/${filename}`
    : murabba
      ? `${tehsil}/${mouza}/${murabba}`
      : `${tehsil}/${mouza}`;
}

function rememberIssued(url, spec) {
  try {
    const u = new URL(url);
    issuedSpecs.set(u.pathname, spec);
    if (issuedSpecs.size > 500) issuedSpecs.delete(issuedSpecs.keys().next().value);
  } catch { /* relative or invalid URL: nothing to refresh later */ }
}

/** True for a URL that points at the PMTiles worker. */
export function isWorkerUrl(url) {
  const base = getCloudflareWorkerUrl();
  if (!base || typeof url !== 'string') return false;
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

/**
 * Returns a usable signed worker URL for `url`: the same one while it has more
 * than `minRemainingMs` left, otherwise a freshly signed URL for the same file.
 * URLs that are not worker URLs (or were not issued here) come back unchanged.
 */
export async function refreshSignedWorkerUrl(url, { force = false, minRemainingMs = 60000 } = {}) {
  if (!isWorkerUrl(url)) return url;
  let u;
  try { u = new URL(url); } catch { return url; }
  const exp = Number(u.searchParams.get('exp'));
  if (!force && exp && exp * 1000 - Date.now() > minRemainingMs) return url;
  const spec = issuedSpecs.get(u.pathname);
  if (!spec) return url;
  const key = specCacheKey(spec);
  const cached = signedUrlCache.get(key);
  if (force || (cached && cached.url === url)) signedUrlCache.delete(key);
  return getSignedUrlFromBackend(spec.tehsil, spec.mouza, spec.murabba, spec.filename);
}

/**
 * Get current PMTiles serving mode
 * @returns {'local' | 'cloudflare'}
 */
export function getPMTilesMode() {
  const mode = 'cloudflare';
  return mode.toLowerCase();
}

/**
 * Get base URL for local PMTiles serving
 * @returns {string}
 */
export function getLocalPMTilesBaseUrl() {
  // For local mode, PMTiles are served from backend Express server
  const apiUrl = apiBase();
  return `${apiUrl}/pmtiles`;
}

/**
 * Get Cloudflare Worker URL
 * @returns {string}
 */
export function getCloudflareWorkerUrl() {
  const workerUrl = CLOUDFLARE_WORKER_URL;
  if (!workerUrl) {
    console.warn('REACT_APP_CLOUDFLARE_WORKER_URL not configured. Using local mode.');
    return '';
  }
  // Remove trailing slash if present
  return workerUrl.endsWith('/') ? workerUrl.slice(0, -1) : workerUrl;
}

/**
 * Get Cloudflare Worker URL for listing endpoints (tehsils/mouzas)
 * Falls back to workers.dev subdomain if custom domain not configured
 * @returns {string}
 */
export function getCloudflareListingUrl() {
  const workerUrl = CLOUDFLARE_WORKER_URL;
  if (workerUrl) {
    return workerUrl.endsWith('/') ? workerUrl.slice(0, -1) : workerUrl;
  }
  // Fallback to workers.dev URL (adjust subdomain if needed)
  return CLOUDFLARE_WORKER_URL;
}

/**
 * Generate signed PMTiles URL via backend API
 * 
 * @param {string} tehsil - Tehsil name (e.g., 'yazman')
 * @param {string} mouza - Mouza name (e.g., 'chak-1')
 * @param {string} [murabba] - Optional murabba number (e.g., '123-45')
 * @param {string} [filename] - Optional custom filename (e.g., 'Mouza-complete.pmtiles')
 * @returns {Promise<string>} Signed URL from Cloudflare Worker
 */
async function getSignedUrlFromBackend(tehsil, mouza, murabba, filename) {
  const apiUrl = apiBase();

  // Check cache first (re-sign once within SIGNED_URL_REFRESH_BUFFER_MS of expiry)
  const cacheKey = specCacheKey({ tehsil, mouza, murabba, filename });
  const cached = signedUrlCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
    console.log(`[PMTiles Cache] Using cached signed URL for ${cacheKey} (expires in ${Math.floor((cached.expiresAt - Date.now()) / 1000)}s)`);
    return cached.url;
  }

  const response = await api.post(`${apiUrl}/api/pmtiles/signed-url`, {
    tehsil, mouza, murabba, filename
  });

  const data = response.data;
  if (!data || !data.url) throw new Error('Signed URL missing in response');

  // Backend signs for 15 minutes; never assume longer than that.
  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 900000;
  signedUrlCache.set(cacheKey, {
    url: data.url,
    expiresAt
  });
  rememberIssued(data.url, { tehsil, mouza, murabba, filename });

  console.log(`[PMTiles Cache] Cached new signed URL for ${cacheKey} (expires in ${Math.floor((expiresAt - Date.now()) / 1000)}s)`);

  return data.url;
}

/**
 * Generate multiple signed PMTiles URLs in batch
 * Optimizes performance by reducing network round-trips from N to 1
 * 
 * @param {Array<{tehsil: string, mouza: string, murabba?: string, filename?: string}>} files - Array of file specifications
 * @returns {Promise<Map<string, string>>} Map of cache keys to signed URLs
 * 
 * @example
 * const urls = await getBatchSignedUrls([
 *   { tehsil: 'Gujrat', mouza: 'Bazgarh' },
 *   { tehsil: 'Gujrat', mouza: 'Bazgarh', filename: 'Bazgarh-complete.pmtiles' }
 * ]);
 * const mouzaUrl = urls.get('Gujrat/Bazgarh');
 * const completeUrl = urls.get('Gujrat/Bazgarh-complete.pmtiles');
 */
export async function getBatchSignedUrls(files) {
  const apiUrl = apiBase();
  const urlMap = new Map();
  const uncachedFiles = [];

  // Check cache first
  for (const fileSpec of files) {
    const cacheKey = specCacheKey(fileSpec);

    const cached = signedUrlCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
      console.log(`[PMTiles Batch Cache] Using cached URL for ${cacheKey}`);
      urlMap.set(cacheKey, cached.url);
    } else {
      uncachedFiles.push({ ...fileSpec, cacheKey });
    }
  }

  // Fetch uncached URLs in batch
  if (uncachedFiles.length > 0) {
    try {
      const response = await api.post(`${apiUrl}/api/pmtiles/signed-urls`, {
        files: uncachedFiles
      });

      const data = response.data;

      if (!data.success || !data.urls) {
        throw new Error('Invalid batch response from server');
      }

      // Cache and add to result map
      // Results come back in request order; match by position (the returned path
      // can name the real linked tehsil instead of the one asked for).
      for (const [i, result] of data.urls.entries()) {
        if (result.error) {
          console.error(`[PMTiles Batch] Error for file:`, result.error);
          continue;
        }

        const { path, url, expiresAt } = result;
        const expiresAtMs = new Date(expiresAt).getTime();

        // Find matching cache key from uncached files
        const matchingFile = uncachedFiles[i];
        const cacheKey = matchingFile ? matchingFile.cacheKey : path;

        signedUrlCache.set(cacheKey, {
          url,
          expiresAt: expiresAtMs
        });
        if (matchingFile) {
          const { tehsil, mouza, murabba, filename } = matchingFile;
          rememberIssued(url, { tehsil, mouza, murabba, filename });
        }

        urlMap.set(cacheKey, url);
      }

      console.log(`[PMTiles Batch] Fetched ${data.urls.length} signed URLs`);

    } catch (error) {
      console.error('Error fetching batch signed URLs:', error);

      // Fall back to individual signed requests; files that cannot be signed are left out.
      console.warn('[PMTiles Batch] Falling back to individual URL requests');
      for (const fileSpec of uncachedFiles) {
        try {
          const url = await getSignedPMTilesUrl(
            fileSpec.tehsil,
            fileSpec.mouza,
            fileSpec.murabba,
            fileSpec.filename
          );
          urlMap.set(fileSpec.cacheKey, url);
        } catch (err) {
          console.error(`[PMTiles] Failed to get URL for ${fileSpec.cacheKey}:`, err);
        }
      }
    }
  }

  return urlMap;
}

/**
 * Generate local PMTiles URL (served by Express backend)
 * 
 * @param {string} tehsil - Tehsil name
 * @param {string} mouza - Mouza name
 * @param {string} [murabba] - Optional murabba number
 * @returns {string} Local URL
 */
function getLocalPMTilesUrl(tehsil, mouza, murabba) {
  const baseUrl = getLocalPMTilesBaseUrl();

  if (murabba) {
    // Individual murabba: /pmtiles/tehsil/mouza/murabba.pmtiles
    return `${baseUrl}/${tehsil}/${mouza}/${murabba}.pmtiles`;
  } else {
    // Mouza-level: /pmtiles/tehsil/mouza.pmtiles
    return `${baseUrl}/${tehsil}/${mouza}.pmtiles`;
  }
}

/**
 * Get PMTiles URL - automatically handles local vs Cloudflare mode
 * 
 * @param {string} tehsil - Tehsil name (e.g., 'yazman')
 * @param {string} mouza - Mouza name (e.g., 'chak-1')
 * @param {string} [murabba] - Optional murabba number (e.g., '123-45')
 * @param {string} [filename] - Optional custom filename (e.g., 'Mouza-complete.pmtiles')
 * @returns {Promise<string>} PMTiles URL (signed if Cloudflare mode, local otherwise)
 * 
 * @example
 * // Get mouza-level PMTiles
 * const url = await getSignedPMTilesUrl('yazman', 'chak-1');
 * 
 * @example
 * // Get individual murabba PMTiles
 * const url = await getSignedPMTilesUrl('yazman', 'chak-1', '123-45');
 */
export async function getSignedPMTilesUrl(tehsil, mouza, murabba, filename) {
  // No unsigned fallback: if the backend will not sign (not logged in, not
  // entitled to the mouza, rate limited) the caller gets an error.
  try {
    return await getSignedUrlFromBackend(tehsil, mouza, murabba, filename);
  } catch (e) {
    console.warn(`[PMTiles] Backend signed URL request failed:`, e.message);
    throw e;
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use getSignedPMTilesUrl instead
 */
export function getPMTilesUrl(tehsil, mouza, murabba) {
  console.warn('[PMTiles] getPMTilesUrl is deprecated. Use getSignedPMTilesUrl instead.');
  return getSignedPMTilesUrl(tehsil, mouza, murabba);
}

/**
 * Check if PMTiles mode is configured correctly
 * @returns {boolean}
 */
export function isPMTilesConfigured() {
  const mode = getPMTilesMode();

  if (mode === 'cloudflare') {
    const workerUrl = getCloudflareWorkerUrl();
    const apiUrl = apiBase();

    if (!workerUrl) {
      console.warn('[PMTiles] Cloudflare mode enabled but REACT_APP_CLOUDFLARE_WORKER_URL not set');
      return false;
    }

    if (!apiUrl) {
      console.warn('[PMTiles] API URL not configured');
      return false;
    }

    return true;
  }

  // Local mode always works if backend is running
  return true;
}

// Log current configuration on import (development only)
if (import.meta.env.DEV) {
  console.log('[PMTiles Config]', {
    mode: getPMTilesMode(),
    localBaseUrl: getLocalPMTilesBaseUrl(),
    cloudflareWorkerUrl: getCloudflareWorkerUrl() || 'Not configured',
    configured: isPMTilesConfigured()
  });
}
