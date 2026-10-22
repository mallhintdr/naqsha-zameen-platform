import polylabel from 'polylabel';
import { area as turfArea } from '@turf/turf';

export const getLayerType = (layer, LLib) => {
  const L = LLib || window.L;
  if (layer instanceof L.Polygon) {
    return 'polygon';
  } else if (layer instanceof L.Polyline) {
    return 'polyline';
  } else if (layer instanceof L.Rectangle) {
    return 'rectangle';
  } else if (layer instanceof L.Circle) {
    return 'circle';
  } else if (layer instanceof L.Marker) {
    return 'marker';
  }
  return null;
};

export const clearActiveKillaSelection = (map) => {
  if (!map) return;

  // 1. Remove highlight polygon(s)
  if (map._activeKillaHighlight) {
    const highlights = Array.isArray(map._activeKillaHighlight)
      ? map._activeKillaHighlight
      : [map._activeKillaHighlight];
    highlights.forEach(h => {
      try { if (map.hasLayer(h)) map.removeLayer(h); } catch (e) {}
    });
  }
  map._activeKillaHighlight = null;

  // 2. Remove all registered Karam length markers
  if (map._activeKillaKaramLabels && map._activeKillaKaramLabels.length > 0) {
    map._activeKillaKaramLabels.forEach(lbl => {
      try {
        if (lbl._isCustomControl && typeof lbl.remove === 'function') {
          lbl.remove();
        } else if (map.hasLayer(lbl)) {
          map.removeLayer(lbl);
        }
      } catch (e) {}
    });
    map._activeKillaKaramLabels = [];
  }

  // 3. Remove area info control box
  if (map._killaAreaBoxRef) {
    try { map._killaAreaBoxRef.remove(); } catch (e) {}
    map._killaAreaBoxRef = null;
  }

  // 4. Thorough sweep: find and remove any orphaned Karam dimension markers from the map
  try {
    map.eachLayer((l) => {
      if (l && l.options && l.options.icon && l.options.icon.options) {
        const cls = l.options.icon.options.className || '';
        const html = l.options.icon.options.html || '';
        if (cls.includes('karam-distance-label') || html.includes('karam-distance-label')) {
          try {
            map.removeLayer(l);
            if (typeof l.remove === 'function') l.remove();
          } catch (e) {}
        }
      }
    });
  } catch (e) {}

  // 5. DOM sweep for any detached .killa-area-info-box or .karam-distance-label
  try {
    const container = map.getContainer ? map.getContainer() : null;
    if (container) {
      container.querySelectorAll('.killa-area-info-box').forEach(el => el.remove());
    }
  } catch (e) {}
};


export const formatDistanceLabel = (distanceInMeters, unitMode = 'imperial') => {
  if (unitMode === 'metric') {
    if (distanceInMeters >= 1000) {
      return `${(distanceInMeters / 1000).toFixed(2)} km`;
    } else if (distanceInMeters >= 100) {
      return `${(distanceInMeters / 1000).toFixed(3)} km`;
    } else {
      return `${distanceInMeters.toFixed(1)} m`;
    }
  }
  if (unitMode === 'meters') {
    return `${distanceInMeters.toFixed(2)} m`;
  }
  const distanceInFeet = distanceInMeters * 3.28084;
  return `${distanceInFeet.toFixed(2)} Ft`;
};

export const formatAreaCustomUnits = (areaSqFeet, unitMode = 'imperial', rawAreaM2 = null) => {
  const areaM2 = rawAreaM2 !== null && rawAreaM2 !== undefined ? rawAreaM2 : (areaSqFeet / 10.7639);

  if (unitMode === 'metric') {
    const sqKm = areaM2 / 1000000;
    if (sqKm >= 0.01) {
      return `Area: ${sqKm.toFixed(3)} km²`;
    } else if (sqKm >= 0.0001) {
      return `Area: ${sqKm.toFixed(4)} km²`;
    } else {
      return `Area: ${areaM2.toFixed(1)} m²`;
    }
  }

  if (unitMode === 'meters') {
    return `Area: ${areaM2.toFixed(2)} m²`;
  }

  return `Area: ${formatAKMArea(areaSqFeet)}`;
};

export const formatAKMArea = (areaSqFeet) => {
  const marlaInSqFeet = 272.25;
  const totalMarlas = Math.round(areaSqFeet / marlaInSqFeet);

  const acres = Math.floor(totalMarlas / 160); // 1 Acre = 8 Kanals * 20 Marlas = 160 Marlas
  const remMarlasAfterAcres = totalMarlas % 160;

  const kanals = Math.floor(remMarlasAfterAcres / 20); // 1 Kanal = 20 Marlas
  const marlas = remMarlasAfterAcres % 20;

  const parts = [];
  if (acres > 0) parts.push(`${acres}A`);
  if (kanals > 0 || acres > 0) parts.push(`${kanals}K`);
  parts.push(`${marlas}M`);

  return parts.join(' - ');
};

export const addLengthLabel = (latlngA, latlngB, map, LLib, unitMode = 'imperial') => {
  const L = LLib || window.L;
  if (!latlngA || !latlngB) return null;
  const distanceInMeters = latlngA.distanceTo(latlngB);
  const distanceText = formatDistanceLabel(distanceInMeters, unitMode);
  const midpoint = L.latLng((latlngA.lat + latlngB.lat) / 2, (latlngA.lng + latlngB.lng) / 2);
  const label = L.marker(midpoint, {
    icon: L.divIcon({
      className: 'distance-label-container',
      html: `<div class="distance-label">${distanceText}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    pmIgnore: true,
    snapIgnore: true,
  }).addTo(map);
  return label;
};

export const addKaramLengthLabel = (latlngA, latlngB, map, LLib) => {
  const L = LLib || window.L;
  if (!latlngA || !latlngB) return null;
  const distanceInMeters = latlngA.distanceTo(latlngB);
  const feet = distanceInMeters * 3.28084;
  const karams = Math.round(feet / 5.5);
  const midpoint = L.latLng((latlngA.lat + latlngB.lat) / 2, (latlngA.lng + latlngB.lng) / 2);
  const label = L.marker(midpoint, {
    icon: L.divIcon({
      className: 'distance-label-container',
      html: `<div class="distance-label karam-distance-label">${karams}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    pmIgnore: true,
    snapIgnore: true,
  }).addTo(map);
  return label;
};

export const showKaramSegmentLengths = (layer, map, featureLabels, LLib) => {
  const L = LLib || window.L;
  let latlngs = layer.getLatLngs();
  const labels = featureLabels.get(layer) || [];

  // Handle MultiPolygon ring arrays (e.g. [[ring1], [ring2]]) by selecting the largest outer ring
  if (Array.isArray(latlngs) && latlngs.length > 0 && Array.isArray(latlngs[0])) {
    let maxLen = 0;
    let bestRing = latlngs[0];
    latlngs.forEach(ring => {
      if (Array.isArray(ring) && ring.length > maxLen) {
        maxLen = ring.length;
        bestRing = ring;
      }
    });
    latlngs = bestRing;
  }

  // Unwrap 1-element nested wrappers if needed
  while (Array.isArray(latlngs) && latlngs.length === 1 && Array.isArray(latlngs[0])) {
    latlngs = latlngs[0];
  }

  if (!Array.isArray(latlngs) || latlngs.length < 3) return;

  // 1. Deduplicate consecutive identical points
  const pts = [];
  latlngs.forEach((pt) => {
    if (!pt) return;
    try {
      const latlng = (pt instanceof L.LatLng) ? pt : L.latLng(pt);
      if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number' && !isNaN(latlng.lat) && !isNaN(latlng.lng)) {
        if (pts.length === 0 || pts[pts.length - 1].distanceTo(latlng) > 0.05) {
          pts.push(latlng);
        }
      }
    } catch (e) {}
  });

  // Ensure closed ring does not repeat start point at end
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 0.05) {
    pts.pop();
  }

  if (pts.length < 3) return;

  // 2. Multi-pass simplification of collinear and tile-cut vertices
  // (Both standard Killas and irregular Kishtwar parcels)
  let currentPts = pts;

  for (let pass = 0; pass < 3; pass++) {
    const simplified = [];
    const count = currentPts.length;
    if (count < 3) break;

    for (let i = 0; i < count; i++) {
      const prev = currentPts[(i - 1 + count) % count];
      const curr = currentPts[i];
      const next = currentPts[(i + 1) % count];

      // Segment vector math
      const v1x = curr.lng - prev.lng;
      const v1y = curr.lat - prev.lat;
      const v2x = next.lng - curr.lng;
      const v2y = next.lat - curr.lat;

      const mag1 = Math.hypot(v1x, v1y);
      const mag2 = Math.hypot(v2x, v2y);

      if (mag1 === 0 || mag2 === 0) continue;

      const dot = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
      // dot > 0.96 means turning angle is < 16 degrees (i.e. straight continuous border)
      // Also eliminate tiny micro-segments (< 0.5 meters)
      const dMeters = curr.distanceTo(next);
      if (dot > 0.96 || dMeters < 0.5) {
        continue; // Drop collinear or micro-subvertex
      }

      simplified.push(curr);
    }

    if (simplified.length >= 3) {
      currentPts = simplified;
    } else {
      break;
    }
  }

  const finalPts = currentPts.length >= 3 ? currentPts : pts;

  // 3. Render edge labels for consolidated sides (skip 0 Karam micro-edges)
  finalPts.forEach((latlng, index) => {
    const nextLatLng = finalPts[(index + 1) % finalPts.length];
    const distMeters = latlng.distanceTo(nextLatLng);
    const karams = Math.round((distMeters * 3.28084) / 5.5);
    if (karams > 0) {
      const lbl = addKaramLengthLabel(latlng, nextLatLng, map, L);
      if (lbl) labels.push(lbl);
    }
  });

  // 4. Calculate Killa Area in A-K-M and render stylish info box over Layer Control
  try {
    // True area of the killa polygon (whole geometry, holes subtracted), not
    // side × side (only right for perfect rectangles) or the simplified outline.
    // formatAKMArea then does ÷ 272.25 sq ft = Marla, 20 Marla = Kanal, 8 Kanal = Acre.
    let areaInMeters = 0;
    try {
      areaInMeters = turfArea(layer.toGeoJSON());
    } catch (e) {
      areaInMeters = L.GeometryUtil.geodesicArea(pts);
    }
    const areaInSqFeet = areaInMeters * 10.7639;

    const akmText = formatAKMArea(areaInSqFeet);

    // Remove existing area box if present
    if (map._killaAreaBoxRef) {
      try { map._killaAreaBoxRef.remove(); } catch (err) {}
      map._killaAreaBoxRef = null;
    }

    const AreaControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'killa-area-info-box');
        container.innerHTML = `
          <button class="killa-area-close-btn" title="Close Measurements" aria-label="Close">&times;</button>
          <div class="killa-area-title">Killa Area</div>
          <div class="killa-area-value">${akmText}</div>
        `;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const closeBtn = container.querySelector('.killa-area-close-btn');
        if (closeBtn) {
          L.DomEvent.on(closeBtn, 'click', (e) => {
            L.DomEvent.stop(e);
            clearActiveKillaSelection(map);
          });
        }
        return container;
      }
    });

    const areaBox = new AreaControl();
    areaBox.addTo(map);
    map._killaAreaBoxRef = areaBox;

    // Track for cleanup
    labels.push({
      _isCustomControl: true,
      remove: () => {
        if (map._killaAreaBoxRef === areaBox) {
          try { areaBox.remove(); } catch (e) {}
          map._killaAreaBoxRef = null;
        }
      }
    });
  } catch (err) {
    console.warn('Error rendering Killa area box:', err);
  }

  featureLabels.set(layer, labels);
};

export const showSegmentLengths = (layer, map, featureLabels, LLib, unitMode = 'imperial') => {
  const L = LLib || window.L;
  const latlngs = layer.getLatLngs();
  const labels = featureLabels.get(layer) || [];

  if (Array.isArray(latlngs[0])) {
    latlngs[0].forEach((latlng, index) => {
      if (index < latlngs[0].length - 1) {
        const lbl = addLengthLabel(latlng, latlngs[0][index + 1], map, L, unitMode);
        if (lbl) labels.push(lbl);
      }
    });
    const closingLbl = addLengthLabel(latlngs[0][latlngs[0].length - 1], latlngs[0][0], map, L, unitMode);
    if (closingLbl) labels.push(closingLbl);
  } else {
    latlngs.forEach((latlng, index) => {
      if (index < latlngs.length - 1) {
        const lbl = addLengthLabel(latlng, latlngs[index + 1], map, L, unitMode);
        if (lbl) labels.push(lbl);
      }
    });
  }
  featureLabels.set(layer, labels);
};

export const showPolygonArea = (layer, map, featureLabels, LLib, unitMode = 'imperial') => {
  const L = LLib || window.L;
  let pts = layer.getLatLngs();
  while (Array.isArray(pts) && Array.isArray(pts[0])) {
    pts = pts[0];
  }
  if (!pts || pts.length < 3) return;

  const areaInMeters = L.GeometryUtil.geodesicArea(pts);
  const areaInSquareFeet = areaInMeters * 10.7639;
  const areaLabel = formatAreaCustomUnits(areaInSquareFeet, unitMode, areaInMeters);

  // Use polylabel to find the best position for the label
  let center;
  try {
    const polygonForPolylabel = pts.map(latlng => [latlng.lng, latlng.lat]);
    const visualCenter = polylabel([polygonForPolylabel], 0.00001);
    center = L.latLng(visualCenter[1], visualCenter[0]);
  } catch (e) {
    center = layer.getBounds ? layer.getBounds().getCenter() : pts[0];
  }

  const label = L.marker(center, {
    icon: L.divIcon({
      className: 'area-label-container',
      html: `<div class="area-label">${areaLabel}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    pmIgnore: true,
    snapIgnore: true,
  }).addTo(map);
  const labels = featureLabels.get(layer) || [];
  labels.push(label);
  featureLabels.set(layer, labels);
};

export const showCircleDetails = (layer, map, featureLabels, LLib, unitMode = 'imperial') => {
  const L = LLib || window.L;
  if (typeof layer.getRadius !== 'function' || typeof layer.getLatLng !== 'function') return;
  const radiusInMeters = layer.getRadius();
  const areaInMeters = Math.PI * Math.pow(radiusInMeters, 2);
  const areaInSquareFeet = areaInMeters * 10.7639;
  const areaLabel = formatAreaCustomUnits(areaInSquareFeet, unitMode, areaInMeters);
  const radiusText = formatDistanceLabel(radiusInMeters, unitMode);
  const center = layer.getLatLng();
  const label = L.marker(center, {
    icon: L.divIcon({
      className: 'circle-label-container',
      html: `<div class="circle-label">Radius: ${radiusText}<br>${areaLabel}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    pmIgnore: true,
    snapIgnore: true,
  }).addTo(map);
  const labels = featureLabels.get(layer) || [];
  labels.push(label);
  featureLabels.set(layer, labels);
};

export const showMarkerCoordinates = (layer, map, featureLabels, LLib) => {
  const L = LLib || window.L;
  const latlng = layer.getLatLng();
  const tooltipText = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  const label = L.marker(latlng, {
    icon: L.divIcon({
      className: 'marker-label-container',
      html: `<div class="marker-label" style="cursor:pointer;pointer-events:auto;text-align:center;">${tooltipText}</div>`,
      iconSize: [120, 20],
      iconAnchor: [60, -15],
    }),
    pmIgnore: true,
    snapIgnore: true,
  }).addTo(map);
  label.on('click', () => {
    navigator.clipboard.writeText(tooltipText).catch(() => {});
  });
  const labels = featureLabels.get(layer) || [];
  labels.push(label);
  featureLabels.set(layer, labels);
};

export const addMeasurementLabels = (layer, map, featureLabels, LLib, unitMode = 'imperial') => {
  const L = LLib || window.L;
  const type = getLayerType(layer, L);
  if (type === 'polyline') {
    showSegmentLengths(layer, map, featureLabels, L, unitMode);
  } else if (type === 'polygon' || type === 'rectangle') {
    showPolygonArea(layer, map, featureLabels, L, unitMode);
    showSegmentLengths(layer, map, featureLabels, L, unitMode);
  } else if (type === 'circle') {
    showCircleDetails(layer, map, featureLabels, L, unitMode);
  } else if (type === 'marker') {
    showMarkerCoordinates(layer, map, featureLabels, L);
  }
};

