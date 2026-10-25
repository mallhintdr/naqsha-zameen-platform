// Helper function to load individual murabba PMTiles
import L from 'leaflet';
import { apiBase as getApiBase } from '@/shared/api/base';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { setupSecurePMTilesFetch } from './securePMTilesProtocol';
import { showKaramSegmentLengths, clearActiveKillaSelection } from './measurementUtils';
import { getSignedPMTilesUrl, isTilesOnly } from '@/features/map/config/pmtiles';
import { focusBounds } from './utils/murabbaCamera';
import { isKillaBandiMouza } from '@/shared/lib/killaBandi';
import MustateelGeojson from './Map/MustateelGeojson';
import { bindKillaTooltip } from './Map/bindTooltips';
import { transformGeoJsonWithTurf } from './Map/geoJsonTransform';
import { vectorFetch } from '@/shared/lib/vectorFetch';

// Initialize secure PMTiles fetch
setupSecurePMTilesFetch();

// Track loading state to prevent duplicate murabba requests
const loadingMurabbas = new Set();

// ── Murabba GeoJSON cache + prefetch ─────────────────────────────────────────
// Murabba files are static, so each one is downloaded once per session and shared:
// a click, the selection that follows it, and a hover-prefetch all reuse the same
// request. Previously every load added ?t=<now>, so nothing was ever reused and the
// murabba only appeared after a full download following the click.
const murabbaGeoJsonCache = new Map(); // url -> Promise<data>
const MURABBA_CACHE_MAX = 300;

const murabbaGeoJsonUrl = (murabbaNo, tehsil, mouza) => {
  const safeMurabba = String(murabbaNo).replace(/\//g, "-").replace(/[\\:*?"<>|]/g, '_').trim();
  // On localhost use a relative URL so the CRA proxy forwards to localhost:5000 where
  // the auth cookie is valid (cross-origin requests from localhost drop the cookie).
  const apiBase = getApiBase();
  return `${apiBase}/JSON Murabba/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}/${encodeURIComponent(safeMurabba)}.geojson`;
};

/** Download (once) and return a murabba's GeoJSON. Shared by clicks and prefetch. */
export function getMurabbaGeoJson(murabbaNo, tehsil, mouza) {
  const url = murabbaGeoJsonUrl(murabbaNo, tehsil, mouza);
  if (!murabbaGeoJsonCache.has(url)) {
    const p = vectorFetch(url, { credentials: 'include' }).then(async (res) => {
      if (!res.ok) throw new Error(`GeoJSON not found: ${res.status}`);
      return res.json();
    });
    p.catch(() => murabbaGeoJsonCache.delete(url)); // failed downloads can be retried
    murabbaGeoJsonCache.set(url, p);
    if (murabbaGeoJsonCache.size > MURABBA_CACHE_MAX) {
      murabbaGeoJsonCache.delete(murabbaGeoJsonCache.keys().next().value); // drop oldest
    }
  }
  return murabbaGeoJsonCache.get(url);
}

/** Start downloading a murabba in the background (e.g. on hover) so a click is instant. */
export function prefetchMurabbaGeoJson(murabbaNo, tehsil, mouza) {
  if (murabbaNo == null || murabbaNo === '' || !tehsil || !mouza) return;
  getMurabbaGeoJson(murabbaNo, tehsil, mouza).catch(() => {});
}

const loadGeoJSONFallback = async (murabbaNo, tehsil, mouza, map, mustateelLayers, skipZoom = false, testMode = false) => {
  console.log('🔄 Loading individual GeoJSON (cached/shared):', murabbaNo);
  // Deep copy: callers may add properties to features; the cached copy must stay clean.
  const data = JSON.parse(JSON.stringify(await getMurabbaGeoJson(murabbaNo, tehsil, mouza)));

  // Redundancy optimization: In measurement systems where parcels have no internal subdivisions
  // (e.g. "killa no only" or irregular parcels where child GeoJSON is identical to the dissolved murabba),
  // skip creating and mounting duplicate SVG layers onto murabbaPane.
  const features = data.features || (data.type === 'Feature' ? [data] : []);
  const hasMultipleFeatures = features.length > 1;
  const hasKillas = features.some(f => f.properties && (f.properties.Killa !== undefined && f.properties.Killa !== null && f.properties.Killa !== ''));

  if (!hasMultipleFeatures && !hasKillas) {
    console.log(`ℹ️ Murabba ${murabbaNo} GeoJSON has identical/single geometry with no internal killas. Skipping duplicate layer.`);
    if (!skipZoom) {
      const tempLayer = L.geoJSON(data);
      const bounds = tempLayer.getBounds();
      if (bounds && bounds.isValid()) {
        if (testMode) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18, animate: false });
        else focusBounds(map, bounds, { padding: [30, 30], maxZoom: 18 });
      }
    }
    return;
  }

  // Create dedicated pane for murabba layers if it doesn't exist
  if (!map.getPane('murabbaPane')) {
    map.createPane('murabbaPane');
  }
  map.getPane('murabbaPane').style.zIndex = 630; // Above fallbackGeoJsonPane (550) and completePMTilesPane (550), below murabbaTooltipPane (640)

  // Create a dedicated renderer for this specific GeoJSON layer to avoid state leakage
  const murabbaRenderer = L.svg({ pane: 'murabbaPane' });

  const geoJsonLayer = L.geoJSON(data, {
    pmIgnore: true,
    pane: 'murabbaPane', // Ensure it's on the correct pane
    renderer: murabbaRenderer, // Use the dedicated renderer
    style: () => {
      const currentZoom = map.getZoom();
      
      // Scale Killa boundaries to be exactly 50% of Murabba border width at each zoom:
      // Z15: 1.5px * 0.5 = 0.75px
      // Z16: 2.0px * 0.5 = 1.0px
      // Z17: 2.5px * 0.5 = 1.25px
      // Z18+: 3.5px * 0.5 = 1.75px
      let scaledLineWidth;
      if (currentZoom <= 15) {
        scaledLineWidth = 0.75;
      } else if (currentZoom === 16) {
        scaledLineWidth = 1.0;
      } else if (currentZoom === 17) {
        scaledLineWidth = 1.25;
      } else { // Z18+
        scaledLineWidth = 1.75;
      }

      // Dynamic dotted styling for Killa boundaries based on zoom (matching PMTiles)
      let dashArray = '2, 3';
      if (currentZoom <= 15) dashArray = '2, 8';
      else if (currentZoom === 16) dashArray = '2, 6';
      else if (currentZoom === 17) dashArray = '2, 4';

      return {
        color: '#FFD700',       // Bright gold - matching Killa PMTiles
        weight: scaledLineWidth,
        dashArray: dashArray,   // Dotted line style
        opacity: 1,
        fill: true,
        fillColor: '#FFD700',
        fillOpacity: 0.001
      };
    },
    onEachFeature: (feature, layer) => {
      // Add Killa tooltips
      if (feature.properties && feature.properties.Killa) {
        const killaValue = feature.properties.Killa;

        // Check if killa value contains slash for fraction detection
        const hasFraction = String(killaValue).includes('/');
        const fractionClass = hasFraction ? ' killa-tooltip-fraction' : '';

        // Calculate polygon size to dynamically set compact class for standard Killa Bandi (220x220 / 220x198)
        let killaDensityClass = ' killa-tooltip--compact';
        try {
          if (typeof layer.getBounds === 'function') {
            const b = layer.getBounds();
            const latDiff = Math.abs(b.getNorth() - b.getSouth()) * 110800;
            const lngDiff = Math.abs(b.getEast() - b.getWest()) * 96500;
            const approxArea = latDiff * lngDiff;
            if (approxArea > 0 && approxArea < 2500) {
              killaDensityClass = ' killa-tooltip--very-compact';
            } else if (approxArea > 5500) {
              killaDensityClass = '';
            }
          }
        } catch (e) {}

        const tooltip = L.tooltip({
          permanent: true,
          direction: 'center',
          className: `killa-tooltip killa-tooltip--zoom-medium${fractionClass}${killaDensityClass}`,
          offset: [0, 0],
          pane: 'killaTooltipPane'
        }).setContent(String(killaValue));

        layer.bindTooltip(tooltip);
        layer._killaTooltip = tooltip;

        const updateTooltipSize = () => {
          const zoom = map.getZoom();
          const el = tooltip.getElement();

          if (zoom >= 16) {
            if (el) {
              el.style.display = '';
              el.classList.remove('killa-tooltip--zoom-low', 'killa-tooltip--zoom-medium', 'killa-tooltip--zoom-high');
              if (zoom <= 16) el.classList.add('killa-tooltip--zoom-low');
              else if (zoom === 17) el.classList.add('killa-tooltip--zoom-medium');
              else if (zoom >= 18) el.classList.add('killa-tooltip--zoom-high');
              if (killaDensityClass && !el.classList.contains(killaDensityClass.trim())) {
                el.classList.add(killaDensityClass.trim());
              }
            }
          } else {
            if (el) el.style.display = 'none';
          }
        };

        // Click event to highlight Killa and display Karam side measurements
        layer.on('click', (e) => {
          if (map._isDrawing) return;
          if (e.originalEvent) e.originalEvent._killaHandled = true;
          L.DomEvent.stopPropagation(e);
          
          clearActiveKillaSelection(map);

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
        });

        layer._updateTooltipSize = updateTooltipSize;
        setTimeout(updateTooltipSize, 200);

        map.on('zoomend', updateTooltipSize);
        layer.on('remove', () => {
          map.off('zoomend', updateTooltipSize);
        });
      }
    }
  });

  geoJsonLayer._renderer = murabbaRenderer;
  geoJsonLayer.murabbaNo = murabbaNo;
  geoJsonLayer._murabbaBounds = geoJsonLayer.getBounds();

  // Always add the layer immediately (visibility managed by zoom handler)
  geoJsonLayer.addTo(map);

  const updateLayerVisibility = () => {
    const currentZoom = map.getZoom();
    if (currentZoom >= 16) {
      if (!map.hasLayer(geoJsonLayer)) {
        geoJsonLayer.addTo(map);
      }
      geoJsonLayer.eachLayer((featureLayer) => {
        if (featureLayer.setStyle) {
          featureLayer.setStyle(geoJsonLayer.options.style(featureLayer.feature));
        }
        if (featureLayer._updateTooltipSize) {
          setTimeout(() => featureLayer._updateTooltipSize(), 50);
        }
      });
    } else {
      if (map.hasLayer(geoJsonLayer)) {
        map.removeLayer(geoJsonLayer);
      }
    }
  };

  updateLayerVisibility();
  map.on('zoomend', updateLayerVisibility);
  geoJsonLayer._zoomHandler = updateLayerVisibility;

  if (mustateelLayers && mustateelLayers.current) {
    mustateelLayers.current.push(geoJsonLayer);
  }

  // Always fly to the actual layer bounds so we zoom to the full geometry,
  // not just the center point. skipZoom only suppresses the animation when
  // the caller already manages navigation (e.g. dropdown selection).
  const bounds = geoJsonLayer.getBounds();
  if (!skipZoom && bounds && bounds.isValid()) {
    if (testMode) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18, animate: false });
    else focusBounds(map, bounds, { padding: [30, 30], maxZoom: 18 });
  }
};

export const loadMurabbaPMTiles = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson = false, testMode = false, skipZoom = false) => {
  const loadKey = `${tehsil}/${mouza}/${murabbaNo}`;

  const adminMapMode = typeof window !== 'undefined' ? localStorage.getItem('admin_map_mode') : null;
  
  let isMobile = (L.Browser && L.Browser.mobile) || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator?.userAgent || '');
  if (adminMapMode === 'geojson') {
    isMobile = true;
  } else if (adminMapMode === 'pmtiles') {
    isMobile = false;
  }
  // Expired accounts: tiles only (server refuses their GeoJSON).
  const shouldPreferGeoJson = !isTilesOnly() && Boolean(preferGeoJson || isMobile);

  console.log('📍 loadMurabbaPMTiles called with:');
  console.log('   murabbaNo:', murabbaNo);
  console.log('   tehsil:', tehsil);
  console.log('   mouza:', mouza);
  console.log('   preferGeoJson:', preferGeoJson);
  console.log('   shouldPreferGeoJson:', shouldPreferGeoJson);
  console.log('   loadKey:', loadKey);
  console.log('   testMode:', testMode);

  // Killa-bandi mouza (killas used as murabbas): there are no murabba sub-division
  // files, and the 25-killa template grid would be wrong. Just zoom to the plot.
  if (isKillaBandiMouza(tehsil, mouza)) {
    let plot = null;
    const find = (layer) => {
      if (plot) return;
      if (layer.feature?.properties && String(layer.feature.properties.Murabba_No) === String(murabbaNo) && typeof layer.getBounds === 'function') {
        plot = layer;
        return;
      }
      if (typeof layer.eachLayer === 'function') layer.eachLayer(find);
    };
    map.eachLayer(find);
    if (plot && !skipZoom) {
      const b = plot.getBounds();
      if (b.isValid()) {
        if (testMode) map.fitBounds(b, { padding: [40, 40], maxZoom: 19, animate: false });
        else focusBounds(map, b, { padding: [40, 40], maxZoom: 19 });
      }
    }
    console.log('📍 Killa-bandi mouza: plot', murabbaNo, 'selected without murabba sub-division');
    return;
  }

  try {
    // Prevent duplicate loading requests
    if (loadingMurabbas.has(loadKey)) {
      console.log('🔄 Murabba already loading, skipping duplicate:', murabbaNo);
      return;
    }

    // Check if this murabba is already loaded
    const existing = mustateelLayers.current?.find((layer) => layer.murabbaNo === murabbaNo);
    if (existing) {
      console.log('🔄 Murabba already loaded:', murabbaNo);
      // Only zoom to existing layer if it's a true GeoJSON layer with valid bounds and skipZoom is false
      if (existing.getBounds && !skipZoom && !existing.pmtilesInstance) {
        const bounds = existing.getBounds();
        if (bounds && bounds.isValid()) {
          if (testMode) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18, animate: false });
          else focusBounds(map, bounds, { padding: [30, 30], maxZoom: 18 });
        }
      }
      return;
    }

    // Mark as loading to prevent duplicates
    loadingMurabbas.add(loadKey);

    if (shouldPreferGeoJson) {
      console.log('ℹ️ Fallback GeoJSON mode active. Loading GeoJSON murabba...');
      try {
        await loadGeoJSONFallback(murabbaNo, tehsil, mouza, map, mustateelLayers, skipZoom, testMode);
        console.log('✅ GeoJSON loaded successfully as primary source');
        return; // Exit early if GeoJSON loads successfully
      } catch (geoJsonError) {
        // If GeoJSON was explicitly forced via admin mode, do NOT fall through to PMTiles.
        // Re-throw so the outer catch skips PMTiles and uses the template fallback instead.
        if (adminMapMode === 'geojson') {
          console.warn('⚠️ GeoJSON forced but unavailable for murabba', murabbaNo, '— using template fallback instead of PMTiles.');
          throw geoJsonError;
        }
        console.warn('⚠️ GeoJSON load failed, falling back to PMTiles:', geoJsonError.message);
      }
    }

    // Construct URL for Mouza PMTiles (contains all murabbas)
    // We use the 'complete' file if the simple one lacks data, but let's try the standard mouza file first.
    // Assuming backend serves `tehsil/mouza.pmtiles` when no murabba is specified.
    const murabbaPMTilesUrl = await getSignedPMTilesUrl(tehsil, mouza);

    console.log('🔍 Loading murabba PMTiles:', murabbaPMTilesUrl);

    // Test PMTiles availability (caching is handled in pmtiles.js)
    const pmtilesInstance = new PMTiles(murabbaPMTilesUrl);

    let header;
    try {
      header = await pmtilesInstance.getHeader();
    } catch (headerError) {
      console.warn('⚠️ PMTiles header fetch failed (will fall back to GeoJSON):', headerError.message);
      throw new Error('PMTiles header fetch failed', { cause: headerError });
    }

    if (!header) {
      console.warn('⚠️ Murabba PMTiles header missing (will fall back to GeoJSON):', murabbaPMTilesUrl);
      throw new Error('PMTiles header missing');
    }

    console.log('✅ Murabba PMTiles header loaded:', {
      murabbaNo,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      zoom: `${header.minZoom}-${header.maxZoom}`
    });

    // Dedicated pane for murabba layers is initialized in MapComponent
    const murabbaPane = map.getPane('murabbaPane');
    if (murabbaPane) {
      murabbaPane.style.pointerEvents = 'auto'; // Ensure interaction works
    }

    // Create Leaflet GridLayer for murabba PMTiles
    const layer = L.gridLayer({
      pane: 'murabbaPane',
      attribution: '',
      tileSize: 256,
      minZoom: 10, // Show mouza tiles from zoom 10
      maxZoom: 22, // Overzoom beyond native tiles
      maxNativeZoom: Math.min(header.maxZoom || 20, 22), // Use tiles up to Z22 if available
      bounds: L.latLngBounds(
        [header.minLat, header.minLon],
        [header.maxLat, header.maxLon]
      )
    });

    // Store features for interaction
    const allFeatures = [];

    // Override createTile to render vector tiles
    layer.createTile = function (coords) {
      const tile = document.createElement('canvas');
      tile.width = 256;
      tile.height = 256;
      const tileContext = tile.getContext('2d');

      // Load and render the tile
      (async () => {
        try {
          // Cap request zoom at maxNativeZoom (20) to enable overzooming
          const maxNativeZoom = this.options.maxNativeZoom || 20;
          const requestZ = Math.min(coords.z, maxNativeZoom);

          // Calculate tile coordinates for the capped zoom level
          const zoomDiff = coords.z - requestZ;
          const requestX = Math.floor(coords.x / Math.pow(2, zoomDiff));
          const requestY = Math.floor(coords.y / Math.pow(2, zoomDiff));

          const tileData = await pmtilesInstance.getZxy(requestZ, requestX, requestY);
          if (tileData) {
            const vectorTile = new VectorTile(new Pbf(tileData.data));

            // Render each layer in the tile
            Object.keys(vectorTile.layers).forEach(layerName => {
              const vectorLayer = vectorTile.layers[layerName];

              for (let i = 0; i < vectorLayer.length; i++) {
                const feature = vectorLayer.feature(i);
                const geom = feature.loadGeometry();
                const properties = feature.properties;

                // FILTER: Only render features belonging to the requested Murabba
                // Normalize comparision (handle string/number differences and potential formatting)
                const featureMurabba = properties?.Murabba || properties?.Murabba_No || properties?.murabba;
                // Loose comparison because one might be string, other number
                // strict check might fail if data is "1" vs 1
                if (featureMurabba != murabbaNo) {
                  continue;
                }
                // No highlight outline – tooltip data only

                // Store feature data for tooltips
                if (feature.properties) {
                  allFeatures.push({
                    properties: feature.properties,
                    geometry: geom,
                    coords: coords,
                    extent: vectorLayer.extent
                  });
                }
              }
            });
          }
        } catch (err) {
          console.warn('Error rendering murabba tile:', err);
        }
      })();

      return tile;
    };

    // Add to map and track
    layer.addTo(map);
    layer.murabbaNo = murabbaNo;
    layer.pmtilesInstance = pmtilesInstance; // Store for cleanup

    // Store bounds for later reference
    const bounds = L.latLngBounds(
      [header.minLat, header.minLon],
      [header.maxLat, header.maxLon]
    );
    layer._murabbaBounds = bounds;

    // Store Killa tooltip markers for this layer
    layer._killaTooltips = [];

    // Add zoom event listener to redraw tiles when crossing zoom 15 threshold
    // This ensures line width updates dynamically (2.5px <-> 5px)
    let previousZoomAbove15 = map.getZoom() >= 15;
    const zoomHandler = () => {
      const currentZoomAbove15 = map.getZoom() >= 15;
      if (previousZoomAbove15 !== currentZoomAbove15) {
        // Zoom crossed the threshold, redraw tiles
        layer.redraw();
        previousZoomAbove15 = currentZoomAbove15;
      }
    };
    map.on('zoomend', zoomHandler);

    // Store zoom handler for cleanup
    layer._zoomHandler = zoomHandler;


    if (mustateelLayers.current) {
      mustateelLayers.current.push(layer);
    }

    // Create permanent tooltips for all Killas only if complete PMTiles tooltips aren't already active
    setTimeout(async () => {
      try {
        // If the complete PMTiles layer is loaded or killaTooltipsRef has items, skip creating duplicate tooltips
        if (map._completePMTilesLoaded || map._hasKillaTooltips) {
          console.log('ℹ️ Complete PMTiles Killa tooltips already active on map, skipping murabba-specific tooltips');
          return;
        }

        console.log('🏷️ Creating Killa tooltips for murabba:', murabbaNo);

        // OPTIMIZATION: Try to fetch consolidated metadata file with local caching
        let killaData = null;
        const cacheKey = `metadata_${tehsil}_${mouza}`;

        // Check localStorage cache first
        const cachedData = localStorage.getItem(cacheKey);
        const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
        const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

        if (cachedData && cacheTimestamp) {
          const age = Date.now() - parseInt(cacheTimestamp);
          if (age < CACHE_DURATION) {
            try {
              const consolidatedData = JSON.parse(cachedData);
              killaData = consolidatedData.murabbas?.[murabbaNo];
              console.log('✅ Loaded from LOCAL CACHE:', killaData?.killa_list?.length, 'killas');
            } catch (e) {
              console.warn('Failed to parse cached data:', e);
            }
          }
        }

        // If not in cache, try fetching from Metadata folder (dev/prod split)
        if (!killaData) {
          try {
            const apiBase = getApiBase();
            const metaBase = import.meta.env.VITE_METADATA_BASE_URL || `${apiBase}/Metadata`;
            const jsonUrl = `${metaBase}/${tehsil}/${mouza}-Metadata.json`;

            console.log(`🔍 Fetching metadata:`, jsonUrl);

            const response = await vectorFetch(jsonUrl, { credentials: 'include' });
            if (response.ok) {
              const consolidatedData = await response.json();

              // Cache the entire consolidated file
              try {
                localStorage.setItem(cacheKey, JSON.stringify(consolidatedData));
                localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
                console.log('💾 Cached consolidated metadata for mouza:', mouza);
              } catch (cacheError) {
                console.warn('Failed to cache metadata (localStorage full?):', cacheError);
              }

              // Extract this murabba's data
              killaData = consolidatedData.murabbas?.[murabbaNo];
              if (killaData) {
                console.log('✅ Loaded from Metadata folder:', killaData.killa_list?.length, 'killas');
              }
            }
          } catch (jsonError) {
            console.log('📋 Metadata not available, skipping murabba tooltips');
          }
        }

        // If we have killa data with centroids, create tooltips instantly
        if (killaData && killaData.killa_centroids) {
          console.log('🚀 Creating instant tooltips from metadata');

          Object.entries(killaData.killa_centroids).forEach(([killa, coords]) => {
            if (coords && coords.length === 2) {
              const [lng, lat] = coords;
              const killaMarker = L.circleMarker([lat, lng], {
                radius: 0,
                opacity: 0,
                fillOpacity: 0,
                interactive: false,
                pane: 'murabbaPane'
              });

              const permanentTooltip = L.tooltip({
                permanent: true,
                direction: 'center',
                className: 'killa-label',
                opacity: 0.9,
                interactive: false
              });

              permanentTooltip.setContent(String(killa));
              killaMarker.bindTooltip(permanentTooltip);
              killaMarker.addTo(map);

              layer._killaTooltips.push(killaMarker);
            }
          });

          console.log(`✅ Created ${layer._killaTooltips.length} instant Killa tooltips`);
        }
      } catch (err) {
        console.warn('Error creating murabba tooltips:', err);
      }
    }, 100);

    // Zoom to PMTiles bounds (reuse stored bounds)
    if (layer._murabbaBounds && layer._murabbaBounds.isValid() && !skipZoom) {
      if (testMode) {
        map.fitBounds(layer._murabbaBounds, {
          padding: [30, 30],
          maxZoom: 18,
          animate: false,
          duration: 0
        });
      } else {
        focusBounds(map, layer._murabbaBounds, { padding: [30, 30], maxZoom: 18 });
      }
    }

    console.log('✅ Murabba PMTiles layer added successfully:', murabbaNo);

  } catch (error) {
    console.error('❌ Error loading murabba PMTiles:', error.message);

    // Only load individual GeoJSON if the app is in fallback mode or configured to prefer GeoJSON
    if (shouldPreferGeoJson || preferGeoJson) {
      console.log('⚠️ Attempting fallback to individual Murabba GeoJSON...');
      try {
        await loadGeoJSONFallback(murabbaNo, tehsil, mouza, map, mustateelLayers, skipZoom, testMode);
        console.log('✅ Fallback Murabba GeoJSON loaded successfully');
      } catch (fallbackError) {
        console.error('❌ Fallback GeoJSON also failed:', fallbackError.message);

        // Secondary Fallback: Turf Template Grid Transformation
        console.log('⚠️ Falling back to template grid transformation in loadMurabbaPMTiles...');
        try {
          // 1. Find the murabba feature in the map's loaded layers recursively
          let murabbaFeature = null;
          const findFeature = (layer) => {
            if (layer.feature && layer.feature.properties && String(layer.feature.properties.Murabba_No) === String(murabbaNo)) {
              murabbaFeature = layer.feature;
              return;
            }
            if (typeof layer.eachLayer === 'function') {
              layer.eachLayer(findFeature);
            }
          };
          map.eachLayer(findFeature);

          if (!murabbaFeature) {
            throw new Error(`Could not find feature geometry on map for Murabba ${murabbaNo}`, { cause: fallbackError });
          }

          // 2. Import Turf and transform the template

          const coords = murabbaFeature.geometry.coordinates[0];
          const topLeft = coords[0];
          const topRight = coords[1];
          const bottomRight = coords[2];
          const bottomLeft = coords[3];

          const transformedGeojson = transformGeoJsonWithTurf(
            { ...MustateelGeojson },
            topLeft,
            topRight,
            bottomRight,
            bottomLeft
          );

          // Ensure murabbaPane exists so template killa SVG renders above the complete
          // PMTiles canvas layer (z-index ~620) and click events reach the polygons.
          if (!map.getPane('murabbaPane')) {
            map.createPane('murabbaPane');
            map.getPane('murabbaPane').style.zIndex = 700;
            map.getPane('murabbaPane').style.pointerEvents = 'auto';
          }

          const mustateelLayer = L.geoJSON(transformedGeojson, {
            pane: 'murabbaPane',
            style: { color: "#FFFF00", weight: 2, fillOpacity: 0.01, dashArray: '5, 5', fill: true, fillColor: "#FFFF00" },
            onEachFeature: (feature, layer) => {
              bindKillaTooltip(feature, layer, map);
            },
          });

          mustateelLayer.addTo(map);
          mustateelLayer.murabbaNo = murabbaNo;
          mustateelLayer._murabbaBounds = mustateelLayer.getBounds();

          if (mustateelLayers && mustateelLayers.current) {
            mustateelLayers.current.push(mustateelLayer);
          }

          // Zoom to layer
          if (!skipZoom) {
            if (testMode) map.fitBounds(mustateelLayer.getBounds(), { padding: [30, 30], maxZoom: 18, animate: false });
            else focusBounds(map, mustateelLayer.getBounds(), { padding: [30, 30], maxZoom: 18 });
          }
          console.log('✅ Template Grid transformed successfully as fallback');
        } catch (templateError) {
          console.error('❌ Template grid transformation fallback also failed:', templateError.message);
        }
      }
    }
  } finally {
    // Remove from loading set
    loadingMurabbas.delete(loadKey);
  }
};
