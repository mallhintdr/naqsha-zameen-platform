// Ported from legacy src/config/pmtiles.js. Signed URLs always come from the backend.
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

  // Check cache first (with 4-minute buffer before expiration)
  const cacheKey = filename
    ? `${tehsil}/${filename}`
    : murabba
      ? `${tehsil}/${mouza}/${murabba}`
      : `${tehsil}/${mouza}`;
  const cached = signedUrlCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 240000) { // 240s (4 min) buffer for aggressive caching
    console.log(`[PMTiles Cache] Using cached signed URL for ${cacheKey} (expires in ${Math.floor((cached.expiresAt - Date.now()) / 1000)}s)`);
    return cached.url;
  }

  try {
    const response = await api.post(`${apiUrl}/api/pmtiles/signed-url`, {
      tehsil, mouza, murabba, filename
    });

    const data = response.data;

    // Cache the signed URL (expires in 15 minutes = 900 seconds)
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 900000;
    signedUrlCache.set(cacheKey, {
      url: data.url,
      expiresAt
    });

    console.log(`[PMTiles Cache] Cached new signed URL for ${cacheKey} (expires in ${Math.floor((expiresAt - Date.now()) / 1000)}s)`);

    return data.url;

  } catch (error) {
    console.error('Error fetching signed PMTiles URL:', error);

    // If we have an expired cached URL, return it anyway (better than nothing)
    if (cached) {
      console.warn('[PMTiles Cache] Returning expired cached URL as fallback');
      return cached.url;
    }

    throw error;
  }
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
    const { tehsil, mouza, murabba, filename } = fileSpec;
    const cacheKey = filename
      ? `${tehsil}/${filename}`
      : murabba
        ? `${tehsil}/${mouza}/${murabba}`
        : `${tehsil}/${mouza}`;

    const cached = signedUrlCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 240000) {
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

        urlMap.set(cacheKey, url);
      }

      console.log(`[PMTiles Batch] Fetched ${data.urls.length} signed URLs`);

    } catch (error) {
      console.error('Error fetching batch signed URLs:', error);

      // Fallback to individual requests with frontend fallback support
      console.warn('[PMTiles Batch] Falling back to individual URL requests');
      for (const fileSpec of uncachedFiles) {
        try {
          // Try to get signed URL with built-in frontend fallback
          const url = await getSignedPMTilesUrl(
            fileSpec.tehsil,
            fileSpec.mouza,
            fileSpec.murabba,
            fileSpec.filename
          );
          urlMap.set(fileSpec.cacheKey, url);
        } catch (err) {
          console.error(`[PMTiles] Failed to get URL for ${fileSpec.cacheKey}:`, err);
          // Last resort: use frontend URL
          const frontendUrl = getFrontendPMTilesUrl(
            fileSpec.tehsil,
            fileSpec.mouza,
            fileSpec.murabba,
            fileSpec.filename
          );
          urlMap.set(fileSpec.cacheKey, frontendUrl);
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
 * Generate frontend static PMTiles URL (served from public folder)
 * 
 * @param {string} tehsil - Tehsil name
 * @param {string} mouza - Mouza name
 * @param {string} [murabba] - Optional murabba number
 * @param {string} [filename] - Optional filename (e.g., 'Mouza-complete.pmtiles')
 * @returns {string} Frontend static URL
 */
function getFrontendPMTilesUrl(tehsil, mouza, murabba, filename) {
  if (filename) {
    // Custom filename: /pmtiles/tehsil/filename
    return `/pmtiles/${tehsil}/${filename}`;
  } else if (murabba) {
    // Individual murabba: /pmtiles/tehsil/mouza/murabba.pmtiles
    return `/pmtiles/${tehsil}/${mouza}/${murabba}.pmtiles`;
  } else {
    // Mouza-level: /pmtiles/tehsil/mouza.pmtiles
    return `/pmtiles/${tehsil}/${mouza}.pmtiles`;
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
  const frontendUrl = getFrontendPMTilesUrl(tehsil, mouza, murabba, filename);

  try {
    const signedUrl = await getSignedUrlFromBackend(tehsil, mouza, murabba, filename);
    if (signedUrl) return signedUrl;
  } catch (e) {
    console.warn(`[PMTiles] Backend signed URL request failed:`, e.message);
  }

  // Fallback to Frontend Static (Served from public folder) if backend fails to give a URL
  return frontendUrl;
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
