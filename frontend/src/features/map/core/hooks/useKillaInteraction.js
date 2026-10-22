import { useCallback } from 'react';
import L from 'leaflet';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { showKaramSegmentLengths, clearActiveKillaSelection } from '../measurementUtils';

import * as turf from '@turf/turf';

// ─── Coordinate utilities ────────────────────────────────────────────────────

function tilePixelToLatLng(px, py, extent, tileX, tileY, zoom) {
  const n = Math.pow(2, zoom);
  const lon = (tileX + px / extent) / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + py / extent) / n)));
  return [latRad * 180 / Math.PI, lon];
}

function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const nx = Math.floor((lng + 180) / 360 * n);
  const ny = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return [nx, ny];
}

// ─── Robust Polygon Merging using Turf.js ────────────────────────────────────
// Handles rectangular killas, kishtwar (irregular parcels), and split tile boundaries
function mergeTileFragments(rings, clickLatLng) {
  if (!rings || rings.length === 0) return null;
  
  if (rings.length === 1) {
    return rings[0];
  }

  try {
    const turfPolys = [];
    rings.forEach(ring => {
      if (!ring || ring.length < 3) return;
      // Convert [lat, lng] to Turf [lng, lat]
      const coords = ring.map(([lat, lng]) => [lng, lat]);
      // Ensure ring is closed for GeoJSON
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
      if (coords.length >= 4) {
        try {
          const poly = turf.polygon([coords]);
          // Clean/buffer zero to fix minor self-intersections or slivers
          const cleaned = turf.buffer(poly, 0.000001, { units: 'kilometers' }) || poly;
          turfPolys.push(cleaned);
        } catch (e) {
          turfPolys.push(turf.polygon([coords]));
        }
      }
    });

    if (turfPolys.length === 0) return rings[0];
    if (turfPolys.length === 1) return rings[0];

    // Union all fragments together
    let merged = turfPolys[0];
    for (let i = 1; i < turfPolys.length; i++) {
      try {
        const unionRes = turf.union(turf.featureCollection([merged, turfPolys[i]]));
        if (unionRes) {
          merged = unionRes;
        }
      } catch (err) {
        console.warn('Turf union iteration failed, trying next:', err);
      }
    }

    if (!merged || !merged.geometry) return rings[0];

    // Simplify slightly to eliminate seam vertices along straight edges while preserving real angles
    try {
      merged = turf.simplify(merged, { tolerance: 0.000005, highQuality: true }) || merged;
    } catch (e) {}

    // Extract outer polygon ring containing or nearest to the clicked point
    if (merged.geometry.type === 'Polygon') {
      const outerLngLat = merged.geometry.coordinates[0];
      return outerLngLat.map(([lng, lat]) => [lat, lng]);
    } else if (merged.geometry.type === 'MultiPolygon') {
      // Find the sub-polygon that contains the click point (or largest area)
      const clickPt = turf.point([clickLatLng.lng, clickLatLng.lat]);
      let bestCoords = merged.geometry.coordinates[0][0];
      let maxArea = 0;

      for (const polyCoords of merged.geometry.coordinates) {
        const polyFeature = turf.polygon(polyCoords);
        try {
          if (turf.booleanPointInPolygon(clickPt, polyFeature)) {
            return polyCoords[0].map(([lng, lat]) => [lat, lng]);
          }
        } catch (e) {}

        const polyArea = turf.area(polyFeature);
        if (polyArea > maxArea) {
          maxArea = polyArea;
          bestCoords = polyCoords[0];
        }
      }
      return bestCoords.map(([lng, lat]) => [lat, lng]);
    }

    return rings[0];
  } catch (err) {
    console.error('Error merging tile fragments with Turf:', err);
    return rings[0];
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useKillaInteraction({
  map,
  completePMTilesRef,
  completeLayerLoadedRef,
  activeKillaHighlightRef,
  killaMeasurementLabelsRef,
}) {
  const clearKillaHighlights = useCallback(() => {
    clearActiveKillaSelection(map);
    activeKillaHighlightRef.current = null;
    killaMeasurementLabelsRef.current = [];
  }, [map, activeKillaHighlightRef, killaMeasurementLabelsRef]);

  const handleKillaClick = useCallback(async (e) => {
    if (!completePMTilesRef.current || !completeLayerLoadedRef.current) return;
    if (map._isDrawing) return;

    try {
      const { lat, lng } = e.latlng;
      const zoom = 16;
      const [nx, ny] = latLngToTile(lat, lng, zoom);

      // ── 1. Fetch the clicked tile and hit-test to find Killa + Murabba ──
      const clickedTileRaw = await completePMTilesRef.current.getZxy(zoom, nx, ny);
      if (!clickedTileRaw) return;

      const clickedVT = new VectorTile(new Pbf(clickedTileRaw.data));
      let targetKillaNo   = null;
      let targetMurabbaNo = null;

      hitTest:
      for (const layerName of Object.keys(clickedVT.layers)) {
        const layer = clickedVT.layers[layerName];
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const geom = feature.loadGeometry();
          if (!geom[0] || geom[0].length < 3) continue;

          const outerRing = geom[0].map(pt =>
            tilePixelToLatLng(pt.x, pt.y, layer.extent, nx, ny, zoom)
          );

          // Ray-cast hit test
          let inside = false;
          for (let j = 0, k = outerRing.length - 1; j < outerRing.length; k = j++) {
            const [xj, yj] = outerRing[j];
            const [xk, yk] = outerRing[k];
            const hit = ((yj > lng) !== (yk > lng)) &&
                        (lat < (xk - xj) * (lng - yj) / (yk - yj) + xj);
            if (hit) inside = !inside;
          }

          if (inside) {
            const p = feature.properties;
            targetKillaNo   = p?.Killa   ?? p?.Killa_No ?? p?.killa ?? p?.KILLA;
            targetMurabbaNo = p?.Murabba_No ?? p?.murabba_no;
            break hitTest;
          }
        }
      }

      if (targetKillaNo == null) return; // empty space
      if (e.originalEvent) e.originalEvent._killaHandled = true;

      const killaKey = `${targetMurabbaNo || ''}_${targetKillaNo}`;

      // TOGGLE logic: If the exact same killa is clicked while its dimensions are visible, clear it and return
      if (map._activeKillaKey === killaKey) {
        console.log(`🔄 Toggling off dimensions for Killa=${targetKillaNo}`);
        clearKillaHighlights();
        map._activeKillaKey = null;
        return;
      }

      // Always clear previous killa highlight/dimensions when selecting a new/different killa
      clearKillaHighlights();
      map._activeKillaKey = killaKey;

      console.log(`✅ Killa=${targetKillaNo}  Murabba=${targetMurabbaNo}`);

      // ── 2. Fetch 3×3 surrounding tiles in parallel (reuse the centre tile) ──
      const tilePromises = [
        Promise.resolve({ tData: clickedTileRaw, tileX: nx, tileY: ny }),
      ];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue; // already have it
          tilePromises.push(
            completePMTilesRef.current
              .getZxy(zoom, nx + dx, ny + dy)
              .then(tData => ({ tData, tileX: nx + dx, tileY: ny + dy }))
              .catch(() => null)
          );
        }
      }

      const tiles = await Promise.all(tilePromises);

      // ── 3. Collect outer-ring arrays for every matching fragment ──
      const allRings = [];

      for (const tile of tiles) {
        if (!tile?.tData) continue;
        const { tData, tileX, tileY } = tile;
        const vt = new VectorTile(new Pbf(tData.data));

        for (const layerName of Object.keys(vt.layers)) {
          const vLayer = vt.layers[layerName];
          for (let i = 0; i < vLayer.length; i++) {
            const feat  = vLayer.feature(i);
            const props = feat.properties;
            const kVal  = props?.Killa ?? props?.Killa_No ?? props?.killa ?? props?.KILLA;
            const mVal  = props?.Murabba_No ?? props?.murabba_no;

            if (String(kVal) !== String(targetKillaNo)) continue;
            if (targetMurabbaNo && mVal && String(mVal) !== String(targetMurabbaNo)) continue;

            const geom = feat.loadGeometry();
            // Only the outer ring (index 0); inner rings are holes and not needed
            const outerPx = geom[0];
            if (!outerPx || outerPx.length < 3) continue;

            allRings.push(
              outerPx.map(pt =>
                tilePixelToLatLng(pt.x, pt.y, vLayer.extent, tileX, tileY, zoom)
              )
            );
          }
        }
      }

      if (allRings.length === 0) return;

      // ── 4. Rebuild true polygon via Turf.js union ──
      //    Works for standard rectangular killas, kishtwar (irregular parcels), and split tile boundaries.
      const trueRing = mergeTileFragments(allRings, e.latlng);
      if (!trueRing || trueRing.length < 3) return;

      // ── 5. Render single clean polygon + measurements ──
      const highlight = L.polygon(trueRing, {
        color:       '#10B981',
        weight:      3,
        dashArray:   '5, 5',
        fillColor:   '#10B981',
        fillOpacity: 0.25,
        pane:        'murabbaPane',
      }).addTo(map);

      activeKillaHighlightRef.current = highlight;
      map._activeKillaHighlight       = highlight;

      const featureLabelsMap = new Map();
      showKaramSegmentLengths(highlight, map, featureLabelsMap, L);
      const labels = featureLabelsMap.get(highlight) || [];
      killaMeasurementLabelsRef.current = labels;
      map._activeKillaKaramLabels       = labels;

    } catch (err) {
      console.error('Error handling Killa click:', err);
    }
  }, [map, completePMTilesRef, completeLayerLoadedRef, activeKillaHighlightRef, killaMeasurementLabelsRef, clearKillaHighlights]);

  return { clearKillaHighlights, handleKillaClick };
}
