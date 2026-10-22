// Ported from legacy src/lib/mouzaApi.js
import { apiBase } from '@/shared/api/base';
// src/lib/mouzaApi.js
// Utilities to fetch tehsil/mouza lists with frontend-first priority
// Priority: Local /public/Metadata/ → Remote CDN → Backend API → R2 Worker

import { getCloudflareListingUrl, getPMTilesMode } from '@/features/map/config/pmtiles';
import { murabbaMetaFromKillas, markKillaBandiMouza } from './killaBandi';

// ========== HELPER FUNCTIONS ==========

/**
 * Fetch from local /public/ folder (served by frontend)
 */
async function fetchFromLocal(path, silent = false) {
  try {
    const base = apiBase();
    const res = await fetch(`${base}${path}`, { cache: 'no-store', credentials: 'include' });
    if (!res.ok) return null;

    // Check if response is actually JSON to avoid "Unexpected token <" errors from HTML 404 pages
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      if (!silent) console.log(`[Local] ✓ Loaded from ${path}`);
      return data;
    }
    return null;
  } catch (e) {
    if (!silent) console.log(`[Local] Failed: ${path}`, e.message);
    return null;
  }
}

/**
 * Fetch from remote Metadata host (CORS may apply)
 */
async function fetchFromMetadataHost(path, silent = false) {
  const base = '';
  if (!base) return null;

  try {
    const url = `${base}${path}`;
    const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      if (!silent) console.log(`[Remote CDN] ✓ Loaded from ${url}`);
      return data;
    }
    return null;
  } catch (e) {
    // Suppress noise for remote CDN failures as they are common due to CORS
    if (!silent) console.log(`[Remote CDN] Failed: ${path}`, e.message);
    return null;
  }
}

/**
 * Fetch from backend API
 */
async function fetchFromBackend(endpoint, silent = false) {
  try {
    const base = apiBase();
    const res = await fetch(`${base}${endpoint}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      if (!silent) console.log(`[Backend API] ✓ Loaded from ${endpoint}`);
      return data;
    }
    return null;
  } catch (e) {
    if (!silent) console.log(`[Backend API] Failed: ${endpoint}`, e.message);
    return null;
  }
}

/**
 * Fetch from R2 Worker
 */
async function fetchFromR2Worker(endpoint, silent = false) {
  try {
    const workerUrl = getCloudflareListingUrl();
    if (!workerUrl) return null;

    const res = await fetch(`${workerUrl}${endpoint}`, {
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      if (!silent) console.log(`[R2 Worker] ✓ Loaded from ${endpoint}`);
      return data;
    }
    return null;
  } catch (e) {
    if (!silent) console.log(`[R2 Worker] Failed: ${endpoint}`, e.message);
    return null;
  }
}

/**
 * Scan remote Metadata CDN for tehsil list
 */
async function fetchTehsilsFromMetadataHost() {
  const base = '';
  if (!base) return null;

  try {
    // If CDN has directory listing endpoint
    try {
      const res = await fetch(`${base}/list-tehsils.json`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log(`[Remote CDN] ✓ Found ${data.length} tehsils from listing`);
          return data;
        }
      }
    } catch { }

    // Fallback: Try common tehsils on remote
    const commonTehsils = [
      'Gujrat', 'Kharian', 'Bahawalnagar', 'Chishtian', 'Fort Abbas',
      'Haroonabad', 'Minchinabad', 'Sarai Alamgir', 'Yazman',
      'Ahmadpur Sharqia', 'Lodhran', 'Dunyapur', 'Kahror Pacca'
    ];

    const checks = await Promise.all(
      commonTehsils.map(async (tehsil) => {
        try {
          const url = `${base}/${encodeURIComponent(tehsil)}/${encodeURIComponent(tehsil)}-Mouza-Index.json`;
          const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          return res.ok ? tehsil : null;
        } catch {
          return null;
        }
      })
    );

    const foundTehsils = checks.filter(t => t !== null);
    if (foundTehsils.length > 0) {
      console.log(`[Remote CDN] ✓ Found ${foundTehsils.length} tehsils by probing`);
      return foundTehsils.sort();
    }

    return null;
  } catch (e) {
    console.log('[Remote CDN] Could not scan:', e.message);
    return null;
  }
}

/**
 * Scan local /Metadata/ folder structure to get tehsil list
 * Scans by checking which tehsil folders exist (tries common tehsils or uses directory listing)
 */
async function fetchTehsilsFromMetadataFolder() {
  // Legacy probed list-metadata-folders.php, which never existed on the API host (dead, see inv-06 §6).
  // The backend /api/tehsil-list route already scans the filesystem directly.
  return [];
}

// Old helper functions removed - replaced by unified fetchFromLocal() and fetchFromMetadataHost()

/**
 * Fetch Murabba JSON metadata from local Metadata folder (development only)
 */
async function fetchMurabbaJsonFromLocalMetadata(tehsil, mouza) {
  try {
    const base = apiBase();
    const url = `/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Murabba.json`;
    console.log(`[Local Metadata] Attempting to fetch Murabba JSON: ${url}`);
    const res = await fetch(`${base}${url}`, { cache: 'no-store', credentials: 'include' });
    if (!res.ok) {
      console.log(`[Local Metadata] Murabba JSON failed: HTTP ${res.status} for ${mouza}`);
      return null;
    }
    const data = await res.json();
    console.log(`[Local Metadata] ✓ Loaded Murabba JSON for ${mouza}`);
    return data;
  } catch (e) {
    console.log(`[Local Metadata] Error fetching Murabba JSON for ${mouza}:`, e.message);
  }
  return null;
}

/**
 * Fetch Murabba JSON metadata from remote Metadata host (production)
 */
async function fetchMurabbaJsonFromMetadataHost(tehsil, mouza) {
  const metadataBase = '';
  if (!metadataBase) return null;

  try {
    const url = `${metadataBase}/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Murabba.json`;
    console.log(`[Metadata Host] Attempting to fetch Murabba JSON: ${url}`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.log(`[Metadata Host] Murabba JSON failed: HTTP ${res.status} for ${mouza}`);
      return null;
    }
    const data = await res.json();
    console.log(`[Metadata Host] ✓ Loaded Murabba JSON for ${mouza}`);
    return data;
  } catch (e) {
    console.log(`[Metadata Host] Error fetching Murabba JSON for ${mouza}:`, e.message);
  }
  return null;
}

/**
 * Fetch list of tehsils
 * Strategy: Fetch from ALL sources and merge (deduplicate) to ensure complete coverage
 */
export async function fetchTehsils() {
  console.log('\n🔍 Fetching Tehsil list...');

  const allTehsils = new Set();

  // Strategy: Try sources that are likely to work and be comprehensive first
  // to avoid doing 130+ probe requests if possible.

  // 1. Try Backend API (usually most comprehensive of local files)
  const backendTehsils = await fetchFromBackend('/api/tehsil-list');
  if (backendTehsils) backendTehsils.forEach(t => allTehsils.add(t));

  // 2. Try R2 Worker
  const r2Tehsils = await fetchFromR2Worker('/list-tehsils');
  if (r2Tehsils) r2Tehsils.forEach(t => allTehsils.add(t));

  // If we already have a significant number of tehsils, we can skip/be very quiet about others
  const alreadyHaveData = allTehsils.size > 100;

  // 3. Try folders (Probing and noisy) - skip completely if we already have API data
  const [localTehsils, remoteTehsils] = await Promise.all([
    alreadyHaveData ? Promise.resolve(null) : fetchTehsilsFromMetadataFolder(),
    alreadyHaveData ? Promise.resolve(null) : fetchTehsilsFromMetadataHost()
  ]);

  if (localTehsils) localTehsils.forEach(t => allTehsils.add(t));
  if (remoteTehsils) remoteTehsils.forEach(t => allTehsils.add(t));

  if (allTehsils.size > 0) {
    const merged = [...allTehsils].sort((a, b) => a.localeCompare(b));
    console.log(`✓ Total unique tehsils: ${merged.length} (Metadata: ${localTehsils?.length || 0}, Backend: ${backendTehsils?.length || 0}, R2: ${r2Tehsils?.length || 0})`);
    return merged;
  }

  console.warn('⚠️  Could not load tehsil list from any source');
  return [];
}

/**
 * Fetch active Tehsil Alias Groups
 */
export async function fetchTehsilGroups() {
  try {
    const data = await fetchFromBackend('/api/tehsil-groups', true);
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Fetch consolidated Tehsil list where grouped tehsils replace individual aliases
 * and are marked with isGroup: true, canonicalName, and rawAliases.
 */
export async function fetchConsolidatedTehsils() {
  const [rawTehsils, groups] = await Promise.all([
    fetchTehsils(),
    fetchTehsilGroups()
  ]);

  const aliasToGroupMap = new Map();
  if (Array.isArray(groups)) {
    groups.forEach(g => {
      if (Array.isArray(g.aliases)) {
        g.aliases.forEach(a => {
          aliasToGroupMap.set(a.toLowerCase(), g);
        });
      }
    });
  }

  const consolidatedMap = new Map();

  // First, add all active groups as canonical entries
  if (Array.isArray(groups)) {
    groups.forEach(g => {
      const canonicalKey = g.canonicalName.toLowerCase();
      consolidatedMap.set(canonicalKey, {
        name: g.canonicalName,
        isGroup: true,
        groupId: g._id,
        rawAliases: g.aliases || []
      });
    });
  }

  // Next, add standalone tehsils that are NOT part of any group
  if (Array.isArray(rawTehsils)) {
    rawTehsils.forEach(t => {
      const lower = t.toLowerCase();
      if (!aliasToGroupMap.has(lower) && !consolidatedMap.has(lower)) {
        consolidatedMap.set(lower, {
          name: t,
          isGroup: false,
          rawAliases: [t]
        });
      }
    });
  }

  const result = Array.from(consolidatedMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return result;
}

/**
 * Fetch list of mouzas for a given tehsil
 * Priority: 1) Local /Metadata/{tehsil}/{tehsil}-Mouza-Index.json → 2) Remote CDN → 3) Backend API → 4) R2 Worker
 */
export async function fetchMauzas(tehsil) {
  if (!tehsil) return [];

  console.log(`\n🔍 Fetching Mouza list for: ${tehsil} (Merged)`);

  const allMouzas = new Set();

  // 1. Try Backend API first (most comprehensive and secure)
  const backendList = await fetchFromBackend(`/api/mauza-list/${encodeURIComponent(tehsil)}`, true);
  if (Array.isArray(backendList) && backendList.length > 0) {
    backendList.forEach(m => {
      if (typeof m === 'string' && !m.toLowerCase().includes('-complete')) {
        allMouzas.add(m);
      }
    });
  }

  // The backend is the source of truth. If it returns no mouzas, there are no mouzas.
  if (allMouzas.size > 0) {
    const merged = [...allMouzas].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
    );
    console.log(`✓ Total unique mouzas for ${tehsil}: ${merged.length}`);
    return merged;
  }

  // console.warn(`⚠️  No mouzas found for ${tehsil}`);
  return [];
}

const killaCache = new Map();
const murabbaCache = new Map();

/**
 * Fetch Murabba JSON metadata (list of murabbas for mouza)
 * Priority: 1) Local Metadata → 2) Remote CDN → 3) Consolidated {mouza}-Metadata.json
 */
export async function fetchMurabbaJson(tehsil, mouza) {
  if (!tehsil || !mouza) return null;
  const cacheKey = `${tehsil}/${mouza}`;
  if (murabbaCache.has(cacheKey)) {
    return murabbaCache.get(cacheKey);
  }

  const result = await (async () => {
    // PRIORITY 1: Local /Metadata/{tehsil}/{mouza}-Murabba.json
    const localData = await fetchMurabbaJsonFromLocalMetadata(tehsil, mouza);
    if (localData) return localData;

    // PRIORITY 2: Remote Metadata CDN
    const remoteData = await fetchMurabbaJsonFromMetadataHost(tehsil, mouza);
    if (remoteData) return remoteData;

    // PRIORITY 3: Check consolidated {mouza}-Metadata.json
    try {
      const base = apiBase();
      const metadataBase = `${base}/Metadata`;
      const urls = [
        `${base}/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Metadata.json`,
        `${metadataBase}/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Metadata.json`
      ];
      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: 'no-store', credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.murabbas) {
              const murabbaList = Object.keys(data.murabbas).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
              const murabbaCentroids = {};
              Object.entries(data.murabbas).forEach(([mNo, mObj]) => {
                if (mObj && mObj.centroid) {
                  murabbaCentroids[mNo] = mObj.centroid;
                }
              });
              return {
                murabba_list: murabbaList,
                murabba_centroids: murabbaCentroids
              };
            }
          }
        } catch {}
      }
    } catch (e) {}

    // PRIORITY 4: Return null (let caller use R2/backend for PMTiles-embedded metadata)
    console.log(`[Fallback] Murabba JSON not in Metadata, will use R2/backend for: ${mouza}`);
    return null;
  })();

  // Killa-bandi mouza (e.g. Rojhan / Bolani): no murabbas, only killas. Use the
  // killa numbers as the murabba list so the dropdown works in PMTiles mode too.
  let finalResult = result;
  if (!result || !Array.isArray(result.murabba_list) || result.murabba_list.length === 0) {
    try {
      const killas = await fetchKillaJson(tehsil, mouza);
      const derived = murabbaMetaFromKillas(killas);
      if (derived) {
        markKillaBandiMouza(tehsil, mouza);
        console.log(`[mouzaApi] Killa-bandi mouza ${mouza}: ${derived.murabba_list.length} killas used as murabbas`);
        finalResult = { ...(result || {}), ...derived };
      }
    } catch {}
  }

  murabbaCache.set(cacheKey, finalResult);
  return finalResult;
}

/**
 * Fetch Killa JSON metadata (centroids for tooltips)
 * Priority: 1) Local Metadata → 2) Remote CDN → 3) None (optional data)
 */
export async function fetchKillaJson(tehsil, mouza) {
  if (!tehsil || !mouza) return null;
  const cacheKey = `${tehsil}/${mouza}`;
  if (killaCache.has(cacheKey)) {
    return killaCache.get(cacheKey);
  }

  const result = await (async () => {
    const base = apiBase();
    const metadataBase = `${base}/Metadata`;

    // Helper to transform consolidated { murabbas: { [murabba]: { killa_centroids: { "1": [lng, lat] } } } } into [{ Killa: "1", centroid: [lng, lat] }]
    const parseConsolidatedMetadata = (data) => {
      if (!data) return null;
      if (Array.isArray(data) && data.length > 0) return data;
      if (data.murabbas && typeof data.murabbas === 'object') {
        const list = [];
        Object.entries(data.murabbas).forEach(([mNo, mObj]) => {
          if (mObj && mObj.killa_centroids && typeof mObj.killa_centroids === 'object') {
            Object.entries(mObj.killa_centroids).forEach(([killaNo, coords]) => {
              if (Array.isArray(coords) && coords.length === 2) {
                list.push({
                  Killa: killaNo,
                  Murabba_No: mNo,
                  centroid: coords
                });
              }
            });
          }
        });
        if (list.length > 0) {
          console.log(`[mouzaApi] ✓ Extracted ${list.length} Killa centroids from consolidated metadata for ${mouza}`);
          return list;
        }
      }
      return null;
    };

    // PRIORITY 1: Local /Metadata/{tehsil}/{mouza}-Killa.json
    try {
      const url = `${base}/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Killa.json`;
      const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseConsolidatedMetadata(data);
        if (parsed) return parsed;
      }
    } catch (e) {}

    // PRIORITY 2: Remote /Metadata/{tehsil}/{mouza}-Killa.json
    if (metadataBase) {
      try {
        const url = `${metadataBase}/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Killa.json`;
        const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const parsed = parseConsolidatedMetadata(data);
          if (parsed) return parsed;
        }
      } catch (e) {}
    }

    // PRIORITY 3: Fallback to consolidated {mouza}-Metadata.json or {mouza}.json
    try {
      const urls = [
        `${base}/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Metadata.json`,
        `${base}/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}.json`,
        `${metadataBase}/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}-Metadata.json`,
        `${metadataBase}/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}.json`
      ];

      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: 'no-store', credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            const parsed = parseConsolidatedMetadata(data);
            if (parsed) return parsed;
          }
        } catch {}
      }
    } catch (e) {}

    return null;
  })();

  killaCache.set(cacheKey, result);
  return result;
}
