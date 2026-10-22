// Ported from legacy src/components/Map/Core/utils/killaBandi.js
// Killa-bandi mouzas (e.g. Rojhan / Bolani): the land record numbers every plot by
// KILLA only — there are no murabbas. Their GeoJSON has `Killa` filled and
// `Murabba_No` empty on every feature, so the map showed only yellow killa labels
// and the murabba dropdown stayed empty.
//
// For these mouzas each killa is treated as the murabba unit (Kishtwar / KW style):
// the killa number is moved into `Murabba_No`, so every existing murabba feature
// (labels, dropdown, selection, zoom) works unchanged. Normal mouzas are untouched.

const blank = (v) => v == null || String(v).trim() === '';

// Mouzas detected as killa-bandi in this session: "tehsil/mouza" (lower-case).
const killaBandiMouzas = new Set();
const keyOf = (tehsil, mouza) => `${String(tehsil || '').trim().toLowerCase()}/${String(mouza || '').trim().toLowerCase()}`;

/** True when every feature has a Killa number and none has a Murabba_No. */
export function isKillaBandiCollection(geojson) {
  const features = geojson?.features;
  if (!Array.isArray(features) || features.length === 0) return false;
  let withKilla = 0;
  for (const f of features) {
    const p = f?.properties || {};
    if (!blank(p.Murabba_No)) return false;       // any real murabba -> normal mouza
    if (!blank(p.Killa)) withKilla++;
  }
  return withKilla > 0;
}

/**
 * Normalise a killa-bandi GeoJSON in place (no-op for normal mouzas):
 *   Murabba_No <- Killa, original kept in KillaBandi_No, Killa cleared (no duplicate
 *   yellow label), and _killaBandi = true so selection skips murabba sub-division.
 * Returns the same object for chaining.
 */
export function normalizeKillaBandi(geojson, tehsil, mouza) {
  if (!isKillaBandiCollection(geojson)) return geojson;
  for (const f of geojson.features) {
    const p = f.properties || (f.properties = {});
    if (blank(p.Killa)) continue;
    p.KillaBandi_No = String(p.Killa).trim();
    p.Murabba_No = p.KillaBandi_No;
    p.Killa = '';
    p._killaBandi = true;
  }
  if (tehsil && mouza) killaBandiMouzas.add(keyOf(tehsil, mouza));
  return geojson;
}

export function markKillaBandiMouza(tehsil, mouza) {
  if (tehsil && mouza) killaBandiMouzas.add(keyOf(tehsil, mouza));
}

export function isKillaBandiMouza(tehsil, mouza) {
  return killaBandiMouzas.has(keyOf(tehsil, mouza));
}

/** Natural sort for plot numbers ("2" before "10", "5/1" handled). */
export const byPlotNumber = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * Metadata fallback for PMTiles mode: when a mouza's -Murabba.json has no murabbas
 * but its -Killa.json has killas, build the murabba list from the killa numbers.
 * killaList: [{ Killa: "1", centroid: [lng, lat] }, ...]
 */
export function murabbaMetaFromKillas(killaList) {
  if (!Array.isArray(killaList) || killaList.length === 0) return null;
  const hasMurabba = killaList.some(k => !blank(k?.Murabba_No));
  if (hasMurabba) return null; // normal mouza: killas belong to real murabbas
  const centroids = {};
  killaList.forEach(k => { if (!blank(k?.Killa) && Array.isArray(k.centroid)) centroids[String(k.Killa).trim()] = k.centroid; });
  const list = Object.keys(centroids).sort(byPlotNumber);
  if (!list.length) return null;
  return { murabba_list: list, murabba_centroids: centroids, total_count: list.length, mode: 'killa_bandi' };
}
