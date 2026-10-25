import { killaInfoLocked } from '@/features/map/core/killaLock';
import L from 'leaflet';
import { showKaramSegmentLengths, clearActiveKillaSelection } from '../measurementUtils';

const getMurabbaTooltipOffset = () => {
  // Unselected murabbas must sit dead center [0, 0]
  return [0, 0];
};

// Global registry to manage active layers and tooltips centrally
let registeredLayers = new Set();
let activeTooltips = new Map(); // layer -> tooltipRef
let mapInstance = null;
let updateTimeoutId = null;

// Track active tooltips by Murabba_No globally so selection displacer can reach them
if (typeof window !== 'undefined' && !window._activeMurabbaTooltipsByNo) {
  window._activeMurabbaTooltipsByNo = new Map();
}

const MAX_VISIBLE_TOOLTIPS = 400;

// Central update coordinator to evaluate tooltip visibility for all registered layers
const updateVisibleTooltips = () => {
  if (!mapInstance) return;

  const map = mapInstance;
  const currentZoom = map.getZoom();
  const bounds = map.getBounds();

  // Hard zoom cap: always hide tooltips if zoom <= 14
  const isZoomOk = currentZoom >= 15;

  // Find all layers currently in the viewport
  const visibleLayers = [];
  for (const layer of registeredLayers) {
    if (!layer._map) continue; // Layer not currently added to map
    const layerBounds = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    const center = layerBounds?.getCenter() ?? null;

    if (isZoomOk && center && bounds.contains(center)) {
      visibleLayers.push({ layer, center });
    }
  }

  // Determine if total visible count is above limit
  const count = visibleLayers.length;
  const showTooltips = isZoomOk && count <= MAX_VISIBLE_TOOLTIPS;

  // Determine zoom-based class for font sizing to prevent overcrowding
  let zoomClass = '';
  if (currentZoom <= 14) {
    zoomClass = ' murabba-tooltip--zoom-low';
  } else if (currentZoom === 15) {
    zoomClass = ' murabba-tooltip--zoom-medium';
  } else if (currentZoom >= 18) {
    zoomClass = ' murabba-tooltip--zoom-high';
  }

  // Process visibility
  for (const layer of registeredLayers) {
    const isVisibleNow = showTooltips && visibleLayers.some(vl => vl.layer === layer);
    const hasTooltip = activeTooltips.has(layer);
    const tooltipContent = layer.feature?.properties?.Murabba_No;

    if (isVisibleNow) {
      if (!tooltipContent) continue;

      const dynamicOffset = getMurabbaTooltipOffset();
      const densityClass = layer._tooltipDensityClass || '';

      if (!hasTooltip) {
        layer.bindTooltip(String(tooltipContent), {
          permanent: true,
          direction: 'center',
          offset: dynamicOffset,
          className: `murabba-tooltip clickable-tooltip${zoomClass}${densityClass}`,
          interactive: true,
          pane: 'murabbaTooltipPane',
        }).openTooltip();

        const tooltip = layer.getTooltip();
        if (tooltip) {
          tooltip._murabbaNo = String(tooltipContent);
          tooltip._map = map;
          if (typeof window !== 'undefined' && window._activeMurabbaTooltipsByNo) {
            window._activeMurabbaTooltipsByNo.set(String(tooltipContent), tooltip);
          }

          // Attach click handler to tooltip
          const el = tooltip.getElement();
          if (el && !el.hasAttribute('data-click-handler')) {
            el.setAttribute('data-click-handler', 'true');
            L.DomEvent.on(el, 'click', (e) => {
              L.DomEvent.stopPropagation(e);
              const layerBounds = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
              const center = layerBounds?.getCenter() ?? null;
              if (center) {
                if (typeof layer.fire === 'function') {
                  layer.fire('click', { latlng: center });
                }
              }
            });
          }
        }
        activeTooltips.set(layer, tooltip || true);
      } else {
        // Keep offset as dead center unless currently selected
        const tooltip = layer.getTooltip();
        if (tooltip) {
          const el = tooltip.getElement();
          const isSelected = el && el.classList.contains('murabba-tooltip--selected-displaced');
          if (!isSelected) {
            tooltip.options.offset = dynamicOffset;
            tooltip.update();
          }
          
          // Dynamically adjust font size class
          if (el) {
            el.classList.remove('murabba-tooltip--zoom-low', 'murabba-tooltip--zoom-medium', 'murabba-tooltip--zoom-high');
            if (zoomClass) {
              el.classList.add(zoomClass.trim());
            }
          }
        }
      }
    } else {
      if (hasTooltip) {
        if (tooltipContent && typeof window !== 'undefined' && window._activeMurabbaTooltipsByNo) {
          window._activeMurabbaTooltipsByNo.delete(String(tooltipContent));
        }
        layer.unbindTooltip();
        activeTooltips.delete(layer);
      }
    }
  }
};

const scheduleCentralUpdate = () => {
  if (updateTimeoutId) clearTimeout(updateTimeoutId);
  updateTimeoutId = setTimeout(updateVisibleTooltips, 100);
};

// Global event hook manager
const setupMapEventListeners = (map) => {
  if (mapInstance === map) return;
  if (mapInstance) {
    mapInstance.off('moveend', scheduleCentralUpdate);
    mapInstance.off('zoomend', scheduleCentralUpdate);
  }
  mapInstance = map;
  map.on('moveend', scheduleCentralUpdate);
  map.on('zoomend', scheduleCentralUpdate);
};

// Helper to calculate the visual center (pole of inaccessibility) of a polygon/multipolygon
// to ensure the tooltip always renders inside the major regular area and ignores thin stems/roots.
const isPointInPolygon = (point, ring) => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const getSqSegDist = (p, p1, p2) => {
  let x = p1[0], y = p1[1],
      dx = p2[0] - x, dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
};

const pointToRingDistance = (p, ring) => {
  let minSqDist = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dist = getSqSegDist(p, ring[i], ring[j]);
    if (dist < minSqDist) minSqDist = dist;
  }
  return Math.sqrt(minSqDist);
};

const getPolygonRings = (layer) => {
  if (typeof layer.getLatLngs !== 'function') return [];
  const latlngs = layer.getLatLngs();
  const rings = [];
  
  const recurse = (arr) => {
    if (!arr || arr.length === 0) return;
    if (arr[0] instanceof L.LatLng) {
      rings.push(arr.map(ll => [ll.lng, ll.lat]));
    } else if (Array.isArray(arr[0])) {
      arr.forEach(recurse);
    }
  };
  
  recurse(latlngs);
  return rings;
};

const isPointInRings = (p, rings) => {
  for (const ring of rings) {
    if (isPointInPolygon(p, ring)) return true;
  }
  return false;
};

const getRingsBounds = (rings) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return { minX, minY, maxX, maxY };
};

const getRingArea = (ring) => {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
};

const getRingCentroid = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
};

const getVisualCenterOfLayer = (layer) => {
  const rings = getPolygonRings(layer);
  if (rings.length === 0) return null;
  
  // Find the largest ring by area (to ignore separate small branch rings)
  let largestRing = rings[0];
  let maxArea = -1;
  for (const ring of rings) {
    const area = getRingArea(ring);
    if (area > maxArea) {
      maxArea = area;
      largestRing = ring;
    }
  }
  
  const ringsToSearch = [largestRing]; // Only search inside the largest ring
  const { minX, minY, maxX, maxY } = getRingsBounds(ringsToSearch);
  
  // Start the search cell at the centroid of the largest ring
  const centroid = getRingCentroid(largestRing);
  let cellX = centroid[0];
  let cellY = centroid[1];
  let cellW = maxX - minX;
  let cellH = maxY - minY;
  
  let bestPoint = centroid;
  let levelMaxDistance = -1;
  
  // 3-level hierarchical search (20x20 grid)
  const levels = 3;
  const gridSize = 20;
  
  for (let level = 0; level < levels; level++) {
    const dx = cellW;
    const dy = cellH;
    const startX = cellX - dx / 2;
    const startY = cellY - dy / 2;
    
    let levelBestPoint = null;
    let levelMaxDistance = -1;
    
    for (let i = 0; i <= gridSize; i++) {
      for (let j = 0; j <= gridSize; j++) {
        const px = startX + (i / gridSize) * dx;
        const py = startY + (j / gridSize) * dy;
        const p = [px, py];
        
        if (isPointInRings(p, ringsToSearch)) {
          const dist = pointToRingDistance(p, largestRing);
          if (dist > levelMaxDistance) {
            levelMaxDistance = dist;
            levelBestPoint = p;
          }
        }
      }
    }
    
    if (levelBestPoint) {
      bestPoint = levelBestPoint;
      cellX = bestPoint[0];
      cellY = bestPoint[1];
      cellW /= 2;
      cellH /= 2;
    } else {
      break;
    }
  }
  
  return L.latLng(bestPoint[1], bestPoint[0]);
};

// Calculate approximate geodesic / planar area in square meters for dynamic sizing
const calculateLayerArea = (layer) => {
  try {
    const rings = getPolygonRings(layer);
    if (!rings || rings.length === 0) return 0;
    // rings are [[lng, lat], ...]
    let totalArea = 0;
    for (const ring of rings) {
      if (ring.length < 3) continue;
      // Convert degrees to meters approx at Punjab latitude (~30 deg N)
      // 1 deg lat ~ 110,800 m, 1 deg lng ~ 96,500 m
      const latM = 110800;
      const lngM = 96500;
      let ringArea = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const x1 = ring[j][0] * lngM;
        const y1 = ring[j][1] * latM;
        const x2 = ring[i][0] * lngM;
        const y2 = ring[i][1] * latM;
        ringArea += (x1 * y2) - (x2 * y1);
      }
      totalArea += Math.abs(ringArea / 2);
    }
    return totalArea;
  } catch (e) {
    return 0;
  }
};

export const bindMurabbaTooltip = (feature, layer, map, options = {}) => {
  const tooltipContent = feature?.properties?.Murabba_No;
  if (!tooltipContent) return;

  // Compute parcel area to detect smaller / irregular parcels vs standard Murabba Bandi (~100,000 m²)
  const parcelAreaM2 = calculateLayerArea(layer);
  if (parcelAreaM2 > 0 && parcelAreaM2 < 30000) {
    // Smaller than standard 25 killas (~100,000 m²), dynamically compact
    layer._tooltipDensityClass = ' murabba-tooltip--compact';
  } else {
    layer._tooltipDensityClass = '';
  }

  // Visual Center override to ignore thin stems/roots and ensure placement inside largest area
  if (typeof layer.getBounds === 'function') {
    const visualCenter = getVisualCenterOfLayer(layer);
    if (visualCenter) {
      // Override Leaflet's layer-level getCenter() to bypass centroid calculation
      layer.getCenter = () => visualCenter;
      
      const originalGetBounds = layer.getBounds;
      layer.getBounds = function() {
        const bounds = originalGetBounds.call(this);
        bounds.getCenter = () => visualCenter;
        return bounds;
      };
    }
  }

  setupMapEventListeners(map);
  registeredLayers.add(layer);

  const cleanup = () => {
    registeredLayers.delete(layer);
    if (activeTooltips.has(layer)) {
      layer.unbindTooltip();
      activeTooltips.delete(layer);
    }
    layer.off('remove', cleanup);
    scheduleCentralUpdate();
  };

  layer.once('remove', cleanup);
  scheduleCentralUpdate();
};

// Centralized registry for Killa tooltips
let registeredKillaLayers = new Set();
let activeKillaTooltips = new Map();
let killaUpdateTimeoutId = null;

const updateVisibleKillaTooltips = () => {
  if (!mapInstance) return;

  const map = mapInstance;
  const currentZoom = map.getZoom();
  const bounds = map.getBounds();

  // Killa labels should only show at high zoom levels (>= 16)
  const isZoomOk = currentZoom >= 16;

  for (const layer of registeredKillaLayers) {
    if (!layer._map) continue;
    const layerBounds = typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    const center = layerBounds?.getCenter() ?? null;

    const isVisibleNow = isZoomOk && center && bounds.contains(center);
    const hasTooltip = activeKillaTooltips.has(layer);

    if (isVisibleNow) {
      if (!hasTooltip) {
        const tooltipContent = layer.feature?.properties?.Killa;
        if (tooltipContent) {
          const densityClass = layer._killaDensityClass || '';
          const t = layer.bindTooltip(String(tooltipContent), {
            permanent: true,
            direction: 'center',
            className: `killa-tooltip${densityClass}`,
            pane: 'killaTooltipPane'
          }).openTooltip();
          const el = t.getTooltip()?.getElement();
          if (el && !el.hasAttribute('data-killa-click')) {
            el.setAttribute('data-killa-click', 'true');
            el.addEventListener('click', (e) => {
              if (layer._karamKillaClickHandler) {
                layer._karamKillaClickHandler(e);
              }
            });
          }
          activeKillaTooltips.set(layer, true);
        }
      }
    } else {
      if (hasTooltip) {
        layer.unbindTooltip();
        activeKillaTooltips.delete(layer);
      }
    }
  }
};

const scheduleKillaUpdate = () => {
  if (killaUpdateTimeoutId) clearTimeout(killaUpdateTimeoutId);
  killaUpdateTimeoutId = setTimeout(updateVisibleKillaTooltips, 120);
};

// Hook killa updates to central map listener setup
const setupKillaMapEventListeners = (map) => {
  setupMapEventListeners(map);
  map.on('moveend', scheduleKillaUpdate);
  map.on('zoomend', scheduleKillaUpdate);
};

export const bindKillaTooltip = (feature, layer, map) => {
  const tooltipContent = feature.properties?.Killa;
  if (!tooltipContent) return;

  // Visual Center override for irregular killas
  if (typeof layer.getBounds === 'function') {
    const visualCenter = getVisualCenterOfLayer(layer);
    if (visualCenter) {
      layer.getCenter = () => visualCenter;
      const originalGetBounds = layer.getBounds;
      layer.getBounds = function() {
        const bounds = originalGetBounds.call(this);
        bounds.getCenter = () => visualCenter;
        return bounds;
      };
    }
  }

  // Dynamic Killa Bandi sizing: Standard killa is ~220x220 ft (~4,046 m²)
  const areaM2 = calculateLayerArea(layer);
  if (areaM2 > 0 && areaM2 < 2500) {
    // Fragmented or small irregular killa
    layer._killaDensityClass = ' killa-tooltip--very-compact';
  } else if (areaM2 > 0 && areaM2 <= 5500) {
    // Standard killa bandi parcel (~220x220 or 220x198)
    layer._killaDensityClass = ' killa-tooltip--compact';
  } else {
    layer._killaDensityClass = '';
  }

  setupKillaMapEventListeners(map);
  registeredKillaLayers.add(layer);

  // Click event handler on Killa polygon layer / tooltip
  layer.off('click', layer._karamKillaClickHandler);
  layer._karamKillaClickHandler = (e) => {
    if (map._isDrawing) return;
    if (killaInfoLocked(e)) { L.DomEvent.stopPropagation(e); return; }
    if (e.originalEvent) e.originalEvent._killaHandled = true;
    L.DomEvent.stopPropagation(e);

    const killaNo = feature.properties?.Killa || feature.properties?.Killa_No;
    const murabbaNo = feature.properties?.Murabba_No || feature.properties?.murabba;
    const killaKey = `${murabbaNo || ''}_${killaNo || ''}_geojson`;

    // TOGGLE logic: If the exact same killa is clicked while its dimensions are visible, clear it and return
    if (map._activeKillaKey === killaKey) {
      console.log(`🔄 Toggling off dimensions for GeoJSON Killa=${killaNo}`);
      clearActiveKillaSelection(map);
      map._activeKillaKey = null;
      return;
    }

    // Always clear previous killa highlight/dimensions when selecting a new/different killa
    clearActiveKillaSelection(map);
    map._activeKillaKey = killaKey;

    const highlight = L.polygon(layer.getLatLngs(), {
      color: '#10B981',
      weight: 3,
      dashArray: '5, 5',
      fillColor: '#10B981',
      fillOpacity: 0.25,
      pane: 'murabbaPane'
    }).addTo(map);
    map._activeKillaHighlight = highlight;

    const featureLabelsMap = new Map();
    showKaramSegmentLengths(highlight, map, featureLabelsMap, L);
    map._activeKillaKaramLabels = featureLabelsMap.get(highlight) || [];
  };
  layer.on('click', layer._karamKillaClickHandler);

  const cleanup = () => {
    registeredKillaLayers.delete(layer);
    if (activeKillaTooltips.has(layer)) {
      layer.unbindTooltip();
      activeKillaTooltips.delete(layer);
    }
    layer.off('remove', cleanup);
    scheduleKillaUpdate();
  };

  layer.once('remove', cleanup);
  scheduleKillaUpdate();
};

export const clearRegisteredTooltips = () => {
  registeredLayers.forEach(layer => {
    try {
      layer.unbindTooltip();
    } catch (e) {}
  });
  registeredLayers.clear();
  activeTooltips.clear();

  registeredKillaLayers.forEach(layer => {
    try {
      layer.unbindTooltip();
    } catch (e) {}
  });
  registeredKillaLayers.clear();
  activeKillaTooltips.clear();

  if (updateTimeoutId) clearTimeout(updateTimeoutId);
  if (killaUpdateTimeoutId) clearTimeout(killaUpdateTimeoutId);

  // Reset mapInstance so setupMapEventListeners re-attaches listeners for the next mouza
  // Without this, after clearRegisteredTooltips() the check `if (mapInstance === map) return`
  // in setupMapEventListeners will prevent re-registration of zoomend/moveend handlers.
  if (mapInstance) {
    try {
      mapInstance.off('moveend', scheduleCentralUpdate);
      mapInstance.off('zoomend', scheduleCentralUpdate);
    } catch (e) {}
    mapInstance = null;
  }
};
