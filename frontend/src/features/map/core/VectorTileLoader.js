// src/Map Component/VectorTileLoader.js
import { useEffect, useRef, useCallback } from 'react';
import { apiBase as getApiBase } from '@/shared/api/base';
import { useMap } from './mapContext';
import L from 'leaflet';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { MAP_STYLES } from './tileStyles';
import { bindMurabbaTooltip, bindKillaTooltip, clearRegisteredTooltips } from './Map/bindTooltips';
import { loadMurabbaPMTiles, prefetchMurabbaGeoJson } from './loadMurabbaPMTiles';
import { setupSecurePMTilesFetch } from './securePMTilesProtocol';
import { getSignedPMTilesUrl } from '@/features/map/config/pmtiles';
import { fetchMurabbaJson, fetchKillaJson } from '@/shared/lib/mouzaApi';
import LRUCache from '@/shared/lib/lruCache';
import { showSegmentLengths } from './measurementUtils';
import {
  extractMurabbaNumbersFromPMTiles,
  extractMurabbaBoundsFromPMTiles,
  getMurabbaCentroidsFromMetadata
} from './utils/tileDecoder';

import { useTooltipHighlight } from './hooks/useTooltipHighlight';
import { useKillaInteraction } from './hooks/useKillaInteraction';
import { useFallbackGeoJSON } from './hooks/useFallbackGeoJSON';
import { usePMTilesLoader } from './hooks/usePMTilesLoader';
import { useGeoJsonLayer } from './hooks/useGeoJsonLayer';
import { buildMurabbaBoundsMap, applyMurabbaSelection } from './utils/tooltipBuilder';
import { focusPoint, afterMove } from './utils/murabbaCamera';
import { vectorFetch } from '@/shared/lib/vectorFetch';

// Initialize secure PMTiles fetch (runs once)
setupSecurePMTilesFetch();

// Persistent cache for mouza-level data (survives component cleanup)
// Using LRU Cache to prevent memory leaks (limit 15 active mouzas)
const mouzaCache = new LRUCache(15);
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to load individual murabba PMTiles (delegates to external module)
const loadMurabbaGeoJSON = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, skipZoom = false) => {
  return loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, false, skipZoom);
};

// Unselected murabba tooltips should always sit in the true center [0, 0].
// Only selected murabba tooltips displace to upper center to avoid obscuring mustateel / killa polygons.
const getMurabbaTooltipOffset = () => {
  return L.point(0, 0);
};

export const getSelectedMurabbaTooltipOffset = (zoom) => {
  if (zoom >= 16) {
    const yOffset = -Math.min(15, Math.round(7.5 * Math.pow(1.5, zoom - 16))); // halved
    return L.point(0, yOffset);
  }
  return L.point(0, -12);
};

const VectorTileLoader = ({
  tehsil,
  mouza,
  onLayerReady,
  onError,
  onSelect, // Renamed from onMurabbaSelect (callback)
  selectedMurabba, // New prop for controlled value
  setMurabbaOptions,
  mustateelLayers,
  geoJsonLayerRef,
  style = {},
  fallbackToGeoJson = true,
  resetFlag,
  onLoadingChange, // Callback to notify parent of loading state
  onExtractionProgress, // Callback to report murabba extraction progress

  onFallbackMode, // Callback to notify parent if fallback mode is active
  isFallbackMode, // Prop to receive fallback state from parent
  testMode, // Prop for Admin Test Mode
  killaMeasurement, // Prop for Killa Measurement toggle
  user, // User object for role-based restrictions
  adminMapMode, // Admin Dev Mode override ('auto' | 'pmtiles' | 'geojson')
}) => {
  const map = useMap();
  const vectorLayerRef = useRef(null);
  const mouzaClickHandlerRef = useRef(null);
  const murabbaLayerRef = useRef(null);
  const completePMTilesLayerRef = useRef(null); // Track complete PMTiles layer
  const pmtilesBoundsRef = useRef(null);
  const murabbaBoundsMapRef = useRef(new Map()); // Store bounds for each murabba
  const pmtilesRef = useRef(null); // Store PMTiles instance
  const completePMTilesRef = useRef(null); // Store complete PMTiles instance
  const headerRef = useRef(null); // Store PMTiles header
  const murabbaTooltipsRef = useRef([]); // Store permanent tooltip markers
  const killaTooltipsRef = useRef([]); // Store permanent Killa tooltip markers
  const selectedMurabbaTooltipRef = useRef(null); // Track currently highlighted murabba tooltip (Marker) - DEPRECATED
  const lastHighlightedTooltipRef = useRef(null); // Track currently highlighted tooltip element (DOM Node)
  const highlightTimeoutRef = useRef(null); // Track timeout for removing highlight
  const fallbackRendererRef = useRef(null); // Dedicated renderer for fallback GeoJSON
  const isLoadingRef = useRef(false); // Prevent duplicate loads
  const currentMouzaRef = useRef(null); // Track current mouza to detect actual changes
  const completeLayerLoadedRef = useRef(false); // Track if complete layer is loaded
  const fallbackLayerRef = useRef(null); // Track fallback GeoJSON layer group
  const isMounted = useRef(true); // Track component mount state
  const timeoutIds = useRef(new Set()); // Track active timeouts
  const activeKillaHighlightRef = useRef(null); // Track the current highlight polygon
  const killaMeasurementLabelsRef = useRef([]); // Track measurement labels
  const killaMeasurementRef = useRef(killaMeasurement);

  useEffect(() => {
    killaMeasurementRef.current = killaMeasurement;
  }, [killaMeasurement]);

  // Helper to safely set timeouts that are cleared on unmount
  const safeSetTimeout = useCallback((callback, delay) => {
    if (!isMounted.current) return null;
    const id = setTimeout(() => {
      if (isMounted.current) {
        callback();
      }
      timeoutIds.current.delete(id);
    }, delay);
    timeoutIds.current.add(id);
    return id;
  }, []);

  // Initialize mount state
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Clear all active timeouts
      timeoutIds.current.forEach(id => clearTimeout(id));
      timeoutIds.current.clear();
    };
  }, []);

  const { highlightMurabbaTooltip } = useTooltipHighlight(
    murabbaTooltipsRef,
    lastHighlightedTooltipRef,
    highlightTimeoutRef,
    map
  );

  const { clearKillaHighlights, handleKillaClick } = useKillaInteraction({
    map,
    completePMTilesRef,
    completeLayerLoadedRef,
    activeKillaHighlightRef,
    killaMeasurementLabelsRef,
    killaMeasurementRef,
    killaMeasurement,
    user
  });

  const { loadFallbackGeoJSONs } = useFallbackGeoJSON({
    map,
    tehsil,
    mouza,
    mustateelLayers,
    testMode,
    completePMTilesLayerRef,
    killaTooltipsRef,
    fallbackLayerRef,
    murabbaTooltipsRef,
    fallbackRendererRef,
    onFallbackMode,
    onError,
    onSelect,
    highlightMurabbaTooltip,
    getMurabbaTooltipOffset,
    completeLayerLoadedRef
  });

  const { loadCompletePMTiles } = usePMTilesLoader({
    map,
    tehsil,
    mouza,
    isMounted,
    mustateelLayers,
    isFallbackMode,
    user,
    killaTooltipsRef,
    completePMTilesLayerRef,
    completeLayerLoadedRef,
    completePMTilesRef,
    fallbackLayerRef,
    handleKillaClick,
    loadFallbackGeoJSONs,
    pmtilesRef,
    testMode
  });

  const { loadGeoJsonFallback } = useGeoJsonLayer({
    map,
    tehsil,
    mouza,
    isMounted,
    mustateelLayers,
    isFallbackMode,
    selectedMurabba,
    setMurabbaOptions,
    geoJsonLayerRef,
    murabbaLayerRef,
    fallbackLayerRef,
    fallbackRendererRef,
    onFallbackMode,
    onError,
    onSelect,
    onLayerReady,
    highlightMurabbaTooltip,
    completeLayerLoadedRef,
    killaTooltipsRef,
    murabbaTooltipsRef,
    getMurabbaTooltipOffset,
    testMode,
    safeSetTimeout,
    MAP_STYLES
  });

  // Wrapper for applyMurabbaSelection (assigned later). Dropdown/click selection is
  // handled by ONE effect further down; a second effect here used to run the same
  // selection again, which fired a second camera move for every click.
  const triggerSelection = useRef(null);

  // highlightMurabbaTooltip moved to hooks/useTooltipHighlight.js

  // clearKillaHighlights, handleKillaClick, and killaMeasurement effect moved to hooks/useKillaInteraction.js


  // loadFallbackGeoJSONs moved to hooks/useFallbackGeoJSON.js

  // reloadMouzaPMTilesLayers and loadCompletePMTiles moved to hooks/usePMTilesLoader.js

  const loadGeoJsonInteractionLayer = useCallback(async () => {
    if (!tehsil || !mouza || !map) return;

    try {
      const apiBase = getApiBase();
      const geoJsonUrl = `${apiBase}/JSON Murabba/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}.geojson?t=${Date.now()}`;

      const response = await vectorFetch(geoJsonUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include' // Auth via httpOnly session cookie (no localStorage token)
      });

      if (response.ok) {
        const geoJsonData = await response.json();

        // Extract murabba numbers for dropdown
        if (setMurabbaOptions && geoJsonData.features) {
          const murabbaNumbers = Array.from(new Set(
            geoJsonData.features
              .filter((feature) => feature.properties?.Murabba_No != null)
              .map((feature) => String(feature.properties.Murabba_No))
          )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

          console.log('Extracted murabba numbers from vector tiles:', murabbaNumbers.length, 'murabbas');
          setMurabbaOptions(murabbaNumbers);
        }

        // Create invisible interaction layer
        const interactionLayer = L.geoJSON(geoJsonData, {
          pmIgnore: true,
          style: () => ({
            fillOpacity: 0.01,
            opacity: 0,
            weight: 0,
            interactive: true
          }),
          onEachFeature: (feature, layer) => {
            // Click handler
            if (layer && layer.on && layer.once && typeof layer.on === 'function') {
              // Pre-download the murabba detail on hover/touch so the click is instant.
              layer.on('mouseover touchstart', () => prefetchMurabbaGeoJson(feature.properties?.Murabba_No, tehsil, mouza));
              layer.on('click', async function (e) {
                try {
                  if (map._isDrawing) return; // Skip during draw/edit mode
                  // Mark that a feature was clicked – suppresses native dblclick zoom
                  map._featureDblClicked = true;
                  map._clickTriggeredSelection = Date.now(); // Suppress redundant programmatic zoom
                  const murabbaNo = feature.properties?.Murabba_No;
                  if (murabbaNo) {
                    if (typeof layer.getBounds === 'function') {
                      focusPoint(map, layer.getBounds().getCenter(), { zoom: 17 });
                    }
                    await loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, false, true);
                  }
                } catch (err) {
                  console.warn('loadMurabbaGeoJSON error:', err);
                }

                if (feature?.properties?.Murabba_No && onSelect) {
                  map._clickTriggeredSelection = Date.now(); // selection comes after a slow load
                  onSelect(feature.properties.Murabba_No);
                }
              });

              // Add programmatic selection handler for dropdown selection
              layer.on('programmaticSelect', async function () {
                try {
                  const murabbaNo = feature.properties?.Murabba_No;
                  if (murabbaNo) {
                    await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
                  }
                } catch (err) {
                  console.warn('programmatic loadMurabbaGeoJSON error:', err);
                }
              });
            }
          }
        });

        interactionLayer.addTo(map);
        murabbaLayerRef.current = interactionLayer;

        // console.log('? Interaction layer added to map with', geoJsonData.features?.length || 0, 'features');

        // Defer tooltip binding until layer is fully attached to the map
        setTimeout(() => {
          if (interactionLayer && interactionLayer.getLayers) {
            interactionLayer.eachLayer((layer) => {
              const feature = layer.feature;
              if (feature && feature.properties && feature.properties.Murabba_No) {
                try {
                  if (layer && typeof layer.on === 'function' && typeof layer.getBounds === 'function') {
                    // Tooltips are handled by buildMurabbaBoundsMap using centroids.
                    // bindMurabbaTooltip(feature, layer, map, { onSelect: onSelect, isFallbackMode: isFallbackMode });
                  }
                } catch (tooltipError) {
                  console.warn('Deferred tooltip binding error:', tooltipError?.message || tooltipError);
                }
              }
            });

            // Apply programmatic selection if there's a selected murabba
            if (selectedMurabba) {
               console.log('Vector tiles: initial programmatic selection for murabba:', selectedMurabba);
               setTimeout(() => {
                 applyMurabbaSelection(selectedMurabba, {
                   map,
                   tehsil,
                   mouza,
                   murabbaLayerRef,
                   mustateelLayers,
                   isFallbackMode,
                   highlightMurabbaTooltip,
                   loadCompletePMTiles,
                   pmtilesBoundsRef
                 });
               }, 100);
            }
          }
        }, 50);

        // Call onLayerReady with the GeoJSON interaction layer (has toGeoJSON method)
        onLayerReady?.(interactionLayer);

        console.log('GeoJSON interaction layer loaded for vector tiles');
      }
    } catch (error) {
      console.warn('Could not load GeoJSON interaction layer:', error);
    }
  }, [tehsil, mouza, map, onSelect, selectedMurabba, setMurabbaOptions]);

// Extract functions moved to utils/tileDecoder.js
// buildMurabbaBoundsMap and applyMurabbaSelection moved to utils/tooltipBuilder.js

  // Update effect to use highlighter (function defined earlier at line 74)
  useEffect(() => {
    if (selectedMurabba) {
      highlightMurabbaTooltip(selectedMurabba);
    }
  }, [selectedMurabba, highlightMurabbaTooltip]);

  // Assign to ref for use in earlier effect
  triggerSelection.current = (val) => {
    applyMurabbaSelection(val, {
      map,
      tehsil,
      mouza,
      murabbaLayerRef,
      mustateelLayers,
      isFallbackMode,
      highlightMurabbaTooltip,
      loadCompletePMTiles,
      pmtilesBoundsRef
    });
  };

  // loadGeoJsonFallback moved to hooks/useGeoJsonLayer.js

  const loadVectorTiles = useCallback(async (pmtilesUrlOverride = null) => {
    if (map) map._geojsonModeActive = false; // PMTiles mode: complete tiles allowed again
    if (!tehsil || !mouza || !map) {
      console.log('Skipping vector tile load - missing dependencies:', { tehsil, mouza, map: !!map });
      return;
    }

    console.log('Loading vector tiles for:', tehsil, mouza);

    try {

      // Note: Cleanup is done by the caller (main useEffect) before calling this function

      // Get secure signed URL from backend (or override if provided)
      const pmtilesUrl = pmtilesUrlOverride || await getSignedPMTilesUrl(tehsil, mouza);


      // Create PMTiles source with simple URL (caching is handled in pmtiles.js)
      const pmtiles = new PMTiles(pmtilesUrl);
      pmtilesRef.current = pmtiles; // Store for later use

      // Check if PMTiles can be loaded
      try {
        const header = await pmtiles.getHeader();
        headerRef.current = header; // Store for later use
        console.log('PMTiles header loaded:', header);
        console.log('PMTiles zoom range:', header.minZoom, 'to', header.maxZoom);
        console.log('PMTiles bounds:', header.minLon, header.minLat, header.maxLon, header.maxLat);
        console.log('Vector tiles available at native resolution from zoom 10-20');

        // Store PMTiles bounds for potential zoom operations
        if (header.minLon !== undefined && header.minLat !== undefined) {
          pmtilesBoundsRef.current = [
            [header.minLat, header.minLon],
            [header.maxLat, header.maxLon]
          ];
        }

        // Extract murabba numbers directly from PMTiles metadata in the background
        // so it doesn't block the initial PMTiles layer rendering (which takes 4-5s for fallback scanning)
        (async () => {
          try {
            const murabbaNumbers = await extractMurabbaNumbersFromPMTiles(pmtiles, header, onExtractionProgress, tehsil, mouza);
            if (murabbaNumbers && murabbaNumbers.length > 0) {
              console.log('? Extracted', murabbaNumbers.length, 'murabba numbers from PMTiles');

              if (setMurabbaOptions) {
                // Fetch centroids to allow zooming even if geometry is missing
                const centroids = await getMurabbaCentroidsFromMetadata(pmtiles) || {};
                const options = murabbaNumbers.map(num => ({
                  value: String(num),
                  label: String(num),
                  centroid: centroids[num] || null
                }));
                setMurabbaOptions(options);
              }

              // Build bounds map for each murabba (for click handling)
              const usingCache = await buildMurabbaBoundsMap(pmtiles, header, murabbaNumbers, {
                map,
                tehsil,
                mouza,
                murabbaTooltipsRef,
                murabbaBoundsMapRef,
                highlightMurabbaTooltip,
                loadCompletePMTiles,
                onSelect,
                testMode,
                getMurabbaTooltipOffset,
                mouzaCache,
                CACHE_DURATION,
                mustateelLayers,
                isFallbackMode
              });

              if (usingCache) {
                console.log('⚡ Using cached tooltips data');
              }
            } else {
              console.warn('No murabba numbers found in PMTiles metadata');
            }
          } catch (err) {
            console.error('Error in background murabba extraction:', err);
          }
        })();

        // Parse and log metadata
        if (header.jsonMetadata) {
          try {
            const metadata = JSON.parse(header.jsonMetadata);
            console.log('PMTiles metadata:', metadata);
            if (metadata.vector_layers) {
              console.log('Vector layers in PMTiles:', metadata.vector_layers);
            }
          } catch (e) {
            console.warn('Could not parse PMTiles metadata:', e);
          }
        }

        // Dedicated pane for mouza-level vector tiles is initialized in MapComponent

        // Create custom vector tile layer
        const VectorTileLayer = L.GridLayer.extend({
          createTile: function (coords, done) {
            // Creating vector tile
            const tile = L.DomUtil.create('canvas', 'leaflet-tile');
            const ctx = tile.getContext('2d');
            tile.width = this.options.tileSize;
            tile.height = this.options.tileSize;

            // Clear canvas
            ctx.clearRect(0, 0, tile.width, tile.height);

            // Get tile data from PMTiles
            this._getTileData(coords, pmtiles)
              .then(vectorTile => {
                if (vectorTile) {
                  this._drawVectorTile(ctx, vectorTile, coords);
                }
                done(null, tile);
              })
              .catch(err => {
                console.warn('Vector tile loading error:', err);
                done(err, tile);
              });

            return tile;
          },

          _getTileData: async function (coords, pmtiles) {
            try {
              // Cap request zoom at maxNativeZoom (18) to enable overzooming
              const maxNativeZoom = this.options.maxNativeZoom || 18;
              const requestZ = Math.min(coords.z, maxNativeZoom);

              // Calculate tile coordinates for the capped zoom level
              const zoomDiff = coords.z - requestZ;
              const requestX = Math.floor(coords.x / Math.pow(2, zoomDiff));
              const requestY = Math.floor(coords.y / Math.pow(2, zoomDiff));

              // Get tile data from PMTiles
              const tileData = await pmtiles.getZxy(requestZ, requestX, requestY);

              if (tileData) {
                // Handle different data types
                let arrayBuffer;
                if (tileData instanceof ArrayBuffer) {
                  arrayBuffer = tileData;
                } else if (tileData instanceof Uint8Array) {
                  arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
                } else if (tileData.buffer) {
                  // Typed array
                  arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
                } else if (typeof tileData === 'object' && tileData.data) {
                  // Possible wrapped data
                  arrayBuffer = tileData.data;
                } else {
                  console.error('Unknown tileData format:', tileData);
                  return null;
                }

                try {
                  // Parse vector tile data
                  const pbf = new Pbf(arrayBuffer);
                  const vectorTile = new VectorTile(pbf);

                  // Store the coordinates (no upsampling needed)
                  vectorTile._coords = coords;

                  return vectorTile;
                } catch (parseError) {
                  console.error('Failed to parse vector tile data:', parseError);
                  return null;
                }
              }
              return null;
            } catch (error) {
              console.warn('Error loading PMTiles data for z/x/y:', coords.z, coords.x, coords.y, error);
              return null;
            }
          },

          _coordsToTileId: function (coords) {
            return (1 << coords.z) * ((1 << coords.z) + coords.x) + coords.y;
          },

          _drawVectorTile: function (ctx, vectorTile, coords) {
            // Get available layers in the vector tile
            const layerNames = Object.keys(vectorTile.layers);

            if (layerNames.length === 0) {
              return;
            }

            // Log available layers for debugging (only once per zoom level)
            if (coords.z >= 18 && coords.x % 4 === 0 && coords.y % 4 === 0) {
              console.log('Vector tile layers at z/x/y', coords.z, coords.x, coords.y, ':', layerNames);
            }

            // Draw each layer
            layerNames.forEach(layerName => {
              const layer = vectorTile.layers[layerName];
              this._drawLayer(ctx, layer, coords, vectorTile, layerName);
            });
          },

          _drawLayer: function (ctx, layer, coords, vectorTile, layerName) {
            const tileSize = this.options.tileSize;
            const extent = layer.extent || 4096;
            const scale = tileSize / extent;

            // Draw features in the layer
            for (let i = 0; i < layer.length; i++) {
              const feature = layer.feature(i);

              // Check feature properties for styling hints (if available)
              let featureType = null;
              if (feature.properties) {
                // Log feature properties at very high zoom for debugging (less spam)
                if (coords.z >= 19 && i === 0 && coords.x % 8 === 0 && coords.y % 8 === 0) {
                  console.log('Feature properties in layer', layerName, ':', feature.properties);
                }
                featureType = feature.properties.type || feature.properties.layer_type || feature.properties.feature_type;
              }

              // Determine style based on layer name or feature properties
              let styleDef;
              if (layerName === 'musteel' || layerName === 'mustateel' || featureType === 'musteel' || featureType === 'mustateel') {
                if (coords.z >= 19 && i === 0 && coords.x % 8 === 0 && coords.y % 8 === 0) {
                  console.log('Applying musteel (gold) styling to layer:', layerName, 'featureType:', featureType);
                }
                styleDef = MAP_STYLES.musteel?.vector || {};
              } else if (layerName === 'murabba' || featureType === 'murabba') {
                styleDef = MAP_STYLES.murabba?.vector || {};
              } else {
                // Default to murabba style for unknown layers (ChakBaghWala should get red styling)
                styleDef = MAP_STYLES.murabba?.vector || {};
              }

              const stroke = styleDef['stroke-color'] || '#97e702';
              const fill = styleDef['fill-color'] || 'transparent';

              // Dynamic line width based on zoom level for clear visibility
              // Desktop widths (2x): Z10-14: 1px, Z15: 1.5px, Z16: 2px, Z17: 2.5px, Z18+: 3.5px
              let strokeWidth;
              if (coords.z <= 14) {
                strokeWidth = 1.0;
              } else if (coords.z === 15) {
                strokeWidth = 1.5;
              } else if (coords.z === 16) {
                strokeWidth = 2.0;
              } else if (coords.z === 17) {
                strokeWidth = 2.5;
              } else { // Z18+
                strokeWidth = 3.5;
              }
              // Adjust for Leaflet overzooming canvas scaling (Z19+ overzooms native Z18 tiles)
              const maxNativeZoom = this.options.maxNativeZoom || 18;
              const overzoomScale = Math.pow(2, Math.max(0, coords.z - maxNativeZoom));
              const adjustedLineWidth = strokeWidth / overzoomScale;

              ctx.strokeStyle = stroke;
              ctx.fillStyle = fill === 'transparent' ? 'rgba(0,0,0,0)' : fill;
              ctx.lineWidth = adjustedLineWidth;

              this._drawFeature(ctx, feature, scale);
            }
          },

          _drawFeature: function (ctx, feature, scale) {
            const geometry = feature.loadGeometry();
            const type = feature.type;

            geometry.forEach((ring, ringIndex) => {
              ctx.beginPath();

              ring.forEach((point, index) => {
                const x = point.x * scale;
                const y = point.y * scale;

                if (index === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              });

              if (type === 3) { // Polygon
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              } else { // LineString or Point
                ctx.stroke();
              }
            });
          }
        });

        const vectorTileLayer = new VectorTileLayer({
          tileSize: 256, // Standard tile size
          zoomOffset: 0, // No offset
          minZoom: 10,
          maxZoom: 22, // Display layer at all zoom levels (tiles exist up to Z18, but overzoom beyond)
          maxNativeZoom: header.maxZoom || 18, // Actual tile data ends at Z18
          parentMap: map,
          pane: 'mouzaPMTilesPane', // Use dedicated pane for shifting
          zIndex: 610, // Match pane z-index
          bounds: header.minLon !== undefined ? [
            [header.minLat, header.minLon],
            [header.maxLat, header.maxLon]
          ] : undefined
        });

        // Store reference but don't add to map yet
        vectorLayerRef.current = vectorTileLayer;

        // Add click handler to zoom to murabba (removed hover tooltip - using permanent tooltips instead)
        // Gotcha 7 fix: keep a reference so cleanup removes ONLY this handler.
        if (mouzaClickHandlerRef.current) map.off('click', mouzaClickHandlerRef.current);
        const onMouzaClick = async (e) => {
          console.log('🖱️ Map clicked at:', e.latlng);
          if (map._isDrawing) return; // Skip during draw/edit mode
          if (!vectorLayerRef.current || !pmtilesRef.current || !headerRef.current) return;

          const zoom = Math.floor(map.getZoom());
          console.log('📊 Current zoom level:', zoom);
          if (zoom < 10) return;

          const latlng = e.latlng;
          const tileCoords = {
            x: Math.floor((latlng.lng + 180) / 360 * Math.pow(2, zoom)),
            y: Math.floor((1 - Math.log(Math.tan(latlng.lat * Math.PI / 180) + 1 / Math.cos(latlng.lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)),
            z: zoom
          };

          // Simple point-in-polygon ray casting algorithm
          function pointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              const xi = polygon[i][0], yi = polygon[i][1];
              const xj = polygon[j][0], yj = polygon[j][1];

              const intersect = ((yi > point[1]) !== (yj > point[1]))
                && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
              if (intersect) inside = !inside;
            }
            return inside;
          }

          try {
            const tileData = await pmtilesRef.current.getZxy(tileCoords.z, tileCoords.x, tileCoords.y);
            if (!tileData) return;

            // Extract ArrayBuffer from tileData (same as buildMurabbaBoundsMap)
            let arrayBuffer;
            if (tileData.data instanceof ArrayBuffer) {
              arrayBuffer = tileData.data;
            } else if (tileData.data instanceof Uint8Array) {
              arrayBuffer = tileData.data.buffer.slice(tileData.data.byteOffset, tileData.data.byteOffset + tileData.data.byteLength);
            } else if (tileData.data && tileData.data.buffer) {
              arrayBuffer = tileData.data.buffer.slice(tileData.data.byteOffset, tileData.data.byteOffset + tileData.data.byteLength);
            } else if (tileData instanceof ArrayBuffer) {
              arrayBuffer = tileData;
            } else if (tileData instanceof Uint8Array) {
              arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
            } else if (tileData.buffer) {
              arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
            }

            if (arrayBuffer) {
              const pbf = new Pbf(arrayBuffer);
              const vectorTile = new VectorTile(pbf);

              const extent = 4096;
              const tilePixelX = ((latlng.lng + 180) / 360 * Math.pow(2, zoom) - tileCoords.x) * extent;
              const tilePixelY = ((1 - Math.log(Math.tan(latlng.lat * Math.PI / 180) + 1 / Math.cos(latlng.lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom) - tileCoords.y) * extent;

              console.log('🔍 Checking tile at z/x/y:', zoom, tileCoords.x, tileCoords.y);
              console.log('📍 Tile pixel coordinates:', tilePixelX, tilePixelY);

              let clickedMurabba = null;
              Object.keys(vectorTile.layers).forEach(layerName => {
                const layer = vectorTile.layers[layerName];
                console.log('🗺️ Checking layer:', layerName, 'features:', layer.length);
                for (let i = 0; i < layer.length; i++) {
                  const feature = layer.feature(i);
                  if (feature.properties && feature.properties.Murabba_No) {
                    const geometry = feature.loadGeometry();
                    for (let ring of geometry) {
                      if (pointInPolygon([tilePixelX, tilePixelY], ring.map(p => [p.x, p.y]))) {
                        clickedMurabba = String(feature.properties.Murabba_No);
                        console.log('✅ Found clicked murabba:', clickedMurabba);
                        break;
                      }
                    }
                    if (clickedMurabba) break;
                  }
                }
                if (clickedMurabba) return;
              });

              if (clickedMurabba) {
                // Mark that a feature was clicked – suppresses native dblclick zoom
                map._featureDblClicked = true;
                map._clickTriggeredSelection = Date.now();
                // Notify parent component
                if (onSelect) {
                  onSelect(clickedMurabba);
                }

                // Smoothly zoom/pan to the clicked murabba center at zoom 17, matching GeoJSON and tooltip behavior
                let murabbaCenter = null;
                const foundTooltip = murabbaTooltipsRef.current?.find(item => String(item._murabbaNo) === String(clickedMurabba));
                if (foundTooltip) {
                  murabbaCenter = foundTooltip._latlng || (typeof foundTooltip.getLatLng === 'function' ? foundTooltip.getLatLng() : null);
                }
                if (!murabbaCenter && window.scannedMurabbaCentroids?.[clickedMurabba]) {
                  murabbaCenter = window.scannedMurabbaCentroids[clickedMurabba];
                }
                if (!murabbaCenter && e?.latlng) {
                  murabbaCenter = e.latlng;
                }

                // One smooth camera move (distance-aware) instead of flyTo/panTo here
                // plus further moves from the selection effect.
                if (murabbaCenter) {
                  focusPoint(map, murabbaCenter, { zoom: 17 });
                }

                // Load individual murabba geojson / pmtiles with skipZoom = true so it does not zoom out to mouza bounds
                await loadMurabbaPMTiles(clickedMurabba, tehsil, mouza, map, mustateelLayers, isFallbackMode, false, true);

                // Heavy work (complete PMTiles, layer re-ordering, killa labels) and the
                // label pulse wait until the camera has settled, so nothing redraws mid-flight.
                afterMove(map, () => {
                  highlightMurabbaTooltip(clickedMurabba);
                  console.log('🎯 Vector tile map clicked, loading complete PMTiles for murabba:', clickedMurabba);
                  loadCompletePMTiles(tehsil, mouza, map);
                });
              } else {
                console.log('❌ No murabba found at click location');
              }
            }
          } catch (err) {
            console.warn('Click handler error:', err);
          }
        };
        mouzaClickHandlerRef.current = onMouzaClick;
        map.on('click', onMouzaClick);

        // Auto-fit map to PMTiles mouza bounds — BUT only if the user isn't already zoomed
        // in to this mouza. Skipping prevents the jarring zoom-out-then-zoom-in behaviour.
        if (pmtilesBoundsRef.current) {
          if (isMounted.current) {
            safeSetTimeout(() => {
              if (!map || !isMounted.current) return;

              const currentZoom = map.getZoom();
              const mouzaBounds = L.latLngBounds(pmtilesBoundsRef.current);
              const alreadyInsideMouza = currentZoom >= 14 && mouzaBounds.contains(map.getCenter());

              const addVectorLayer = () => {
                if (map && isMounted.current && vectorTileLayer) {
                  console.log('??? Adding vector tiles to map');
                  vectorTileLayer.addTo(map);
                  console.log('??? Vector tiles added with z-index:', vectorTileLayer.options.zIndex);

                  // Ensure any existing murabba layers stay on top
                  const ensureMurabbaOnTop = () => {
                    if (!isMounted.current || !map) return;
                    try {
                      let pane = map.getPane('murabbaPane');
                      if (!pane) {
                        pane = map.createPane('murabbaPane');
                      }
                      // Above mouza PMTiles (620), below murabba tooltips (640)
                      pane.style.zIndex = 630;

                      // Create murabba tooltip pane (top layer)
                      // Pane initialized in MapComponent
                      let tooltipPane = map.getPane('murabbaTooltipPane');
                      // Top layer: murabba tooltips above everything
                      tooltipPane.style.zIndex = 640;
                      pane.style.pointerEvents = 'auto';
                      if (mustateelLayers?.current?.length) {
                        mustateelLayers.current.forEach((lyr) => {
                          if (lyr && map.hasLayer(lyr) && lyr.bringToFront) {
                            lyr.bringToFront();
                          }
                        });
                      }
                    } catch (e) {
                      // noop
                    }
                  };
                  // Run immediately and after a short delay to cover async tile draws
                  ensureMurabbaOnTop();
                  safeSetTimeout(ensureMurabbaOnTop, 150);
                }
              };

              if (alreadyInsideMouza) {
                // Already zoomed in — add immediately, no flyToBounds
                console.log('Map already inside mouza bounds at zoom', currentZoom, '— skipping flyToBounds, adding tiles immediately');
                addVectorLayer();
              } else {
                // First time arriving at this mouza — fly to its bounds then add tiles
                console.log('Auto-fitting map to mouza PMTiles bounds');
                addVectorLayer();

                const targetCenter = mouzaBounds.getCenter();
                const currentCenter = map.getCenter();
                const distance = currentCenter.distanceTo(targetCenter);
                const zoomDiff = Math.abs(map.getZoom() - 17);

                let duration = 3.5; // Max 3.5 seconds for long distance transitions
                if (distance < 200 && zoomDiff <= 1) {
                  duration = 0.6; // Avoid sub-pixel map vibration if already close
                } else if (distance < 1000) {
                  duration = 1.2;
                } else if (distance < 5000) {
                  duration = 2.2;
                }

                map.flyToBounds(mouzaBounds, {
                  duration: duration,
                  easeLinearity: 0.25,
                  padding: [20, 20]
                });
              }
            }, 200);
          }
        } else {
          // No bounds, add immediately
          console.log('??? Adding vector tiles immediately (no bounds)');
          if (isMounted.current && map) {
            vectorTileLayer.addTo(map);
            console.log('??? Vector tiles added with z-index:', vectorTileLayer.options.zIndex);
          }
        }


        // For now, vector tiles will be used for rendering only (no GeoJSON overlay needed)
        console.log('Vector tiles prepared successfully with direct interaction support');

        // Vector tiles loaded successfully - notify parent to enable tools (like Shift)
        if (onLayerReady) {
          onLayerReady(vectorTileLayer);
        }

        console.log('Vector tiles loaded successfully');
        return; // Success - don't fall back to GeoJSON

      } catch (headerError) {
        throw new Error('Failed to load PMTiles header: ' + headerError.message, { cause: headerError });
      }

    } catch (error) {
      console.error('Vector tiles failed to load:', error.message);
      // Re-throw error to be handled by caller
      throw error;
    }
  }, [tehsil, mouza, map, onLayerReady, onSelect, selectedMurabba, setMurabbaOptions, loadGeoJsonInteractionLayer]);

  const handleZoomEnd = useCallback(() => {
    if (!map || !tehsil || !mouza) return;

    const currentZoom = map.getZoom();

    // Auto-load complete PMTiles at zoom 16+
    if (currentZoom >= 16 && !completeLayerLoadedRef.current) {
      console.log('🔍 Zoom level 16+ detected, auto-loading complete PMTiles');
      loadCompletePMTiles(tehsil, mouza, map);
    }

    // Remove complete layer if zooming out below 16
    if (currentZoom < 16 && completeLayerLoadedRef.current && completePMTilesLayerRef.current) {
      console.log('📤 Zoom level < 16, removing complete PMTiles layer');
      if (map.hasLayer(completePMTilesLayerRef.current)) {
        map.removeLayer(completePMTilesLayerRef.current);
      }

      // Remove Killa tooltips
      killaTooltipsRef.current.forEach(tooltip => {
        if (map.hasLayer(tooltip)) {
          map.removeLayer(tooltip);
        }
      });
      killaTooltipsRef.current = [];

      // Reset flags so it can be loaded again when zooming back in
      completePMTilesLayerRef.current = null;
      completeLayerLoadedRef.current = false;
      map._completePMTilesLoaded = false;
      map._hasKillaTooltips = false;

      console.log('✅ Complete PMTiles and Killa tooltips removed');
    }
  }, [map, tehsil, mouza, loadCompletePMTiles]);

  // Cleanup function for ALL layers (vector, GeoJSON, mustateel)
  // Define this BEFORE it's used in useEffects
  const cleanupAllLayers = useCallback(() => {
    console.log('===== CLEANUP STARTING =====');
    console.log('Cleaning up ALL layers (vector, GeoJSON, mustateel, tooltips) and event listeners');

    // Reset bindTooltips registries
    try {
      clearRegisteredTooltips();
    } catch (err) {
      console.warn('Error clearing registered tooltips:', err);
    }

    // Remove map event listeners for vector tiles (only unnamed mousemove/click)
    // NOTE: Do NOT call map.off('zoomend') or map.off('moveend') without a specific handler —
    // that nukes ALL listeners on those events, breaking Leaflet rendering and bindTooltips.
    try {
      // Gotcha 7 fix: remove only our own handler instead of wiping every listener.
      if (mouzaClickHandlerRef.current) {
        map.off('click', mouzaClickHandlerRef.current);
        mouzaClickHandlerRef.current = null;
      }
      console.log('✓ Map mousemove/click event listeners removed');
    } catch (err) {
      console.warn('Error removing map event listeners:', err);
    }

    // Remove permanent tooltips
    if (murabbaTooltipsRef.current && murabbaTooltipsRef.current.length > 0) {
      console.log(`Removing ${murabbaTooltipsRef.current.length} permanent tooltips`);
      murabbaTooltipsRef.current.forEach(tooltip => {
        try {
          if (map.hasLayer(tooltip)) {
            map.removeLayer(tooltip);
          }
        } catch (err) {
          console.warn('Error removing tooltip:', err);
        }
      });
      murabbaTooltipsRef.current = [];
      console.log('? All permanent tooltips removed');
    }

    // Clean up complete PMTiles layer
    if (completePMTilesLayerRef.current) {
      console.log('Removing complete PMTiles layer');
      try {
        // Remove Killa tooltips
        if (killaTooltipsRef.current && killaTooltipsRef.current.length > 0) {
          console.log(`Removing ${killaTooltipsRef.current.length} Killa tooltips`);
          killaTooltipsRef.current.forEach(tooltip => {
            try {
              if (map.hasLayer(tooltip)) {
                map.removeLayer(tooltip);
              }
            } catch (err) {
              console.warn('Error removing Killa tooltip:', err);
            }
          });
          killaTooltipsRef.current = [];
          console.log('✓ All Killa tooltips removed');
        }

        map._completePMTilesLoaded = false;
        map._hasKillaTooltips = false;

        if (map.hasLayer(completePMTilesLayerRef.current)) {
          map.removeLayer(completePMTilesLayerRef.current);
        }
        completePMTilesLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing complete PMTiles layer:', err);
      }
    }

    // Clean up fallback layer
    if (fallbackLayerRef.current) {
      try {
        // Remove event listeners attached to fallback layer
        if (fallbackLayerRef.current._killaHandlers) {
          console.log('🧹 Removing fallback event listeners');
          if (fallbackLayerRef.current._killaHandlers.zoomend) {
            map.off('zoomend', fallbackLayerRef.current._killaHandlers.zoomend);
          }
          if (fallbackLayerRef.current._killaHandlers.moveend) {
            map.off('moveend', fallbackLayerRef.current._killaHandlers.moveend);
          }
          fallbackLayerRef.current._killaHandlers = null;
        }

        if (map.hasLayer(fallbackLayerRef.current)) {
          map.removeLayer(fallbackLayerRef.current);
        }
        const fallbackPane = map.getPane('fallbackGeoJsonPane');
        if (fallbackPane) {
          fallbackPane.innerHTML = '';
          fallbackPane.style.transform = '';
          fallbackPane.style.left = '0px';
          fallbackPane.style.top = '0px';
        }
        fallbackLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing fallback layer:', err);
      }
    }

    if (fallbackRendererRef.current) {
      try {
        fallbackRendererRef.current.remove();
      } catch (err) {
        console.warn('Error removing fallback renderer:', err);
      }
      fallbackRendererRef.current = null;
    }

    completeLayerLoadedRef.current = false;

    // Clean up vector tile layers
    if (vectorLayerRef.current) {
      try {
        console.log('Removing vector tile layer from map');
        if (map.hasLayer(vectorLayerRef.current)) {
          map.removeLayer(vectorLayerRef.current);
          console.log('? Vector tile layer removed');
        } else {
          console.log('Vector layer not on map');
        }
        vectorLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing vector layer:', err);
      }
    } else {
      console.log('No vector layer to remove');
    }

    if (murabbaLayerRef.current) {
      try {
        console.log('Removing murabba interaction layer from map');
        if (map.hasLayer(murabbaLayerRef.current)) {
          map.removeLayer(murabbaLayerRef.current);
          console.log('? Murabba layer removed');
        } else {
          console.log('Murabba layer not on map');
        }
        murabbaLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing murabba layer:', err);
      }
    } else {
      console.log('No murabba layer to remove');
    }

    // Clean up GeoJSON layers
    if (geoJsonLayerRef && geoJsonLayerRef.current) {
      try {
        console.log('Removing GeoJSON layer from map');
        if (map.hasLayer(geoJsonLayerRef.current)) {
          map.removeLayer(geoJsonLayerRef.current);
          console.log('? GeoJSON layer removed');
        } else {
          console.log('GeoJSON layer not on map');
        }
        geoJsonLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing GeoJSON layer:', err);
      }
    } else {
      console.log('No GeoJSON layer to remove');
    }

    // Clean up mustateel layers
    if (mustateelLayers && mustateelLayers.current && Array.isArray(mustateelLayers.current)) {
      const count = mustateelLayers.current.length;
      console.log(`Removing ${count} mustateel layers`);
      mustateelLayers.current.forEach((layer, index) => {
        try {
          // Clean up Killa tooltips if they exist
          if (layer._killaTooltips && Array.isArray(layer._killaTooltips)) {
            console.log(`  Removing ${layer._killaTooltips.length} Killa tooltips for layer ${index}`);
            layer._killaTooltips.forEach((marker) => {
              // Remove zoom handler
              if (marker._zoomHandler) {
                map.off('zoomend', marker._zoomHandler);
              }
              // Remove marker from map
              if (map.hasLayer(marker)) {
                map.removeLayer(marker);
              }
            });
            layer._killaTooltips = [];
          }

          // Remove the layer itself
          if (map.hasLayer(layer)) {
            map.removeLayer(layer);
          }
        } catch (err) {
          console.warn(`Error removing mustateel layer ${index}:`, err);
        }
      });
      mustateelLayers.current = [];
      console.log('? All mustateel layers removed');
    } else {
      console.log('No mustateel layers to remove');
    }

    // AGGRESSIVE CLEANUP: Remove any GeoJSON or Canvas layers that might be lingering
    try {
      const layersToRemove = [];
      map.eachLayer((layer) => {
        // Check if this is a GeoJSON layer or Canvas-based GridLayer (vector tiles)
        if (layer instanceof L.GeoJSON ||
          (layer instanceof L.GridLayer && !(layer instanceof L.TileLayer))) {
          // Don't remove base map tiles, only our data layers
          if (!layer._url) { // TileLayers have _url, our custom layers don't
            layersToRemove.push(layer);
          }
        }
      });

      if (layersToRemove.length > 0) {
        console.log(`Found ${layersToRemove.length} orphaned data layers, removing...`);
        layersToRemove.forEach((layer) => {
          try {
            map.removeLayer(layer);
          } catch (err) {
            console.warn('Error removing orphaned layer:', err);
          }
        });
        console.log('? Orphaned layers removed');
      }
    } catch (err) {
      console.warn('Error during aggressive cleanup:', err);
    }

    // A bit of a hack: by setting the internal _renderer to null, we force
    // Leaflet to create a new one for the next vector layer. This prevents
    // a bug where the renderer from a previous, smaller GeoJSON (like a single
    // murabba) would be reused, causing the entire mouza to be scaled down.
    if (map._renderer) {
      console.log('Forcefully resetting Leaflet renderer.');
      map._renderer.remove(); // Remove from DOM
      map._renderer = null;
    }

    // Remove custom listeners
    if (map._customListeners) {
      console.log(`🧹 Removing ${map._customListeners.length} custom map event listeners...`);
      map._customListeners.forEach(({ event, handler }) => {
        map.off(event, handler);
      });
      map._customListeners = [];
    }

    clearKillaHighlights();
    map.off('click', handleKillaClick);

    console.log('===== CLEANUP COMPLETE =====');
  }, [map, geoJsonLayerRef, mustateelLayers, clearKillaHighlights, handleKillaClick]);

  useEffect(() => {
    if (!map) return;

    map.on('zoomend', handleZoomEnd);
    return () => map.off('zoomend', handleZoomEnd);
  }, [map, handleZoomEnd]);

  useEffect(() => {
    // Don't run if essential dependencies are missing
    if (!tehsil || !mouza || !map) {
      console.log('Skipping load - missing dependencies:', { tehsil, mouza, map: !!map });
      return;
    }

    // Check if mouza actually changed (prevents duplicate runs from Strict Mode)
    const mouzaKey = `${tehsil}/${mouza}/${resetFlag || ''}/${adminMapMode || 'auto'}`;
    if (currentMouzaRef.current === mouzaKey) {
      console.log('⏭️ Same mouza, skipping duplicate effect (Strict Mode double-invoke)');
      return;
    }

    // Prevent concurrent loading
    // Update current mouza tracker
    currentMouzaRef.current = mouzaKey;
    isLoadingRef.current = true;

    // Reset fallback mode
    if (onFallbackMode) {
      onFallbackMode(false);
    }

    // Notify parent that loading has started
    // Update current mouza tracker
    currentMouzaRef.current = mouzaKey;
    isLoadingRef.current = true;

    // Notify parent that loading has started
    if (onLoadingChange) {
      onLoadingChange(true);
    }

    // Clean up all layers when mouza changes or reset is triggered
    console.log('===== MOUZA CHANGED: Cleaning up all previous layers =====');
    console.log('Mouza:', mouza, 'Tehsil:', tehsil);

    // Force synchronous cleanup
    cleanupAllLayers();

    // Reset the completeLayerLoaded flag to allow reloading
    completeLayerLoadedRef.current = false;

    // Force map to update/redraw after cleanup
    if (map) {
      try {
        map.invalidateSize();
      } catch (err) {
        console.warn('Error invalidating map size:', err);
      }
    }

    // Load vector tiles (which will auto-fallback to GeoJSON if PMTiles don't exist)
    const loadLayers = async () => {
      try {
        // Shorter delay since we're preventing duplicate runs
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('Starting layer load...');

        // ── Mobile-first: prefer GeoJSON on mobile devices ──────────────────
        let isMobile =
          (L.Browser && L.Browser.mobile) ||
          /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        // Allow admin dev mode overrides
        const isAdmin = user?.userType === 'admin';
        if (isAdmin) {
          if (adminMapMode === 'geojson') {
            console.log('🛡️ Admin Dev Mode: Forcing GeoJSON...');
            isMobile = true; // Treats as mobile to force GeoJSON path
          } else if (adminMapMode === 'pmtiles') {
            console.log('🛡️ Admin Dev Mode: Forcing PMTiles...');
            isMobile = false; // Treats as desktop to force PMTiles path
          }
        }

        if (isMobile) {
          console.log('📱 Mobile device detected — trying GeoJSON first...');
          try {
            if (onFallbackMode) onFallbackMode(true);
            await loadGeoJsonFallback();
            console.log('✅ GeoJSON loaded as primary source on mobile');
            return; // Done — skip PMTiles entirely on mobile
          } catch (mobileGeoJsonError) {
            // If admin explicitly forced GeoJSON mode, do NOT fall through to PMTiles.
            // Show the error and stop — the user is testing GeoJSON mode.
            const isForced = isAdmin && adminMapMode === 'geojson';
            if (isForced) {
              console.error('❌ GeoJSON mode is forced but GeoJSON failed for this mouza:', mobileGeoJsonError.message);
              console.warn('ℹ️ PMTiles fallback suppressed because GeoJSON mode is active. Switch to Auto or PMTiles mode to load this mouza.');
              if (onError) onError(new Error(`GeoJSON mode active — data unavailable for this mouza (${mobileGeoJsonError.message})`));
              return; // Stop here — do not fall through to PMTiles
            }
            console.warn('⚠️ GeoJSON failed on mobile, falling back to PMTiles:', mobileGeoJsonError.message);
            if (onFallbackMode) onFallbackMode(false);
            // Falls through to PMTiles attempts below
          }
        }

        // Try PMTiles first (desktop, or mobile GeoJSON failed) ──────────────
        let pmtilesUrl;
        try {
          pmtilesUrl = await getSignedPMTilesUrl(tehsil, mouza);
          console.log('✅ PMTiles URL fetched - attempting to load vector tiles');
          // Reset fallback mode since we are attempting PMTiles
          if (onFallbackMode) {
            onFallbackMode(false);
          }
          await loadVectorTiles();
          return; // Exit early on success
        } catch (error) {
          console.warn('Error checking PMTiles from Cloudflare:', error);

          // Try frontend fallback URL
          try {
            pmtilesUrl = `/pmtiles/${tehsil}/${mouza}.pmtiles`;
              console.log('✅ Frontend PMTiles URL generated - attempting to load vector tiles');
              await loadVectorTiles(pmtilesUrl); // Pass the frontend URL
              return; // Exit early on success
          } catch (fallbackError) {
            console.warn('Frontend PMTiles also failed:', fallbackError);
          }
        }

        // If we reach here, all PMTiles attempts failed - fallback to GeoJSON
        console.log('Falling back to GeoJSON');
        // Set fallback mode
        if (onFallbackMode) {
          onFallbackMode(true);
        }
        await loadGeoJsonFallback();
      } finally {
        // Notify parent that loading has completed
        if (onLoadingChange) {
          onLoadingChange(false);
        }

        // Clear loading flag after a delay to prevent rapid re-triggers
        setTimeout(() => {
          isLoadingRef.current = false;
        }, 500);
      }
    };

    loadLayers();

    return () => {
      // Final cleanup on unmount
      isLoadingRef.current = false;
      cleanupAllLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tehsil, mouza, map, resetFlag, adminMapMode]); // Include resetFlag/adminMapMode for forced reloads

  // Handle programmatic murabba selection from dropdown
  useEffect(() => {
    // Only apply if we have a valid murabba selection (not empty or null)
    if (selectedMurabba && typeof selectedMurabba === 'string' && selectedMurabba.trim() !== '') {
      console.log('-----------------------------------------------');
      console.log('Vector tiles: Dropdown selection changed to:', selectedMurabba);
      console.log('-----------------------------------------------');

      // For vector tiles, always call applyMurabbaSelection (it handles PMTiles bounds directly)
      // Add a small delay to ensure data is loaded
      const timer = setTimeout(() => {
        applyMurabbaSelection(selectedMurabba, {
          map,
          tehsil,
          mouza,
          murabbaLayerRef,
          mustateelLayers,
          isFallbackMode,
          highlightMurabbaTooltip,
          loadCompletePMTiles,
          pmtilesBoundsRef
        });
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [selectedMurabba, applyMurabbaSelection]);

  return null; // This is a data-only component
};

export default VectorTileLoader;




