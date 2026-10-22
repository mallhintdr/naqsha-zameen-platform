import { useCallback } from 'react';
import { apiBase as getApiBase } from '@/shared/api/base';
import L from 'leaflet';
import { bindMurabbaTooltip, bindKillaTooltip } from '../Map/bindTooltips';
import { showKaramSegmentLengths, clearActiveKillaSelection } from '../measurementUtils';
import { normalizeKillaBandi, byPlotNumber } from '@/shared/lib/killaBandi';
import { focusPoint, focusBounds, afterMove } from '../utils/murabbaCamera';
import { prefetchMurabbaGeoJson, loadMurabbaPMTiles } from '../loadMurabbaPMTiles';

// Killa-bandi plot (killa used as murabba): highlight it with its karam lengths and
// zoom to it. There are no murabba sub-divisions to load for these mouzas.
const selectKillaBandiPlot = (layer, map, zoom = true) => {
  if (typeof layer.getLatLngs !== 'function') return;
  clearActiveKillaSelection(map);
  const highlight = L.polygon(layer.getLatLngs(), {
    color: '#10B981', weight: 3, dashArray: '5, 5', fillColor: '#10B981', fillOpacity: 0.25, pane: 'murabbaPane'
  }).addTo(map);
  map._activeKillaHighlight = highlight;
  const featureLabelsMap = new Map();
  showKaramSegmentLengths(highlight, map, featureLabelsMap, L);
  map._activeKillaKaramLabels = featureLabelsMap.get(highlight) || [];
  if (zoom && typeof layer.getBounds === 'function') {
    focusBounds(map, layer.getBounds(), { padding: [40, 40], maxZoom: 19 });
  }
};

// Helper function to load individual murabba PMTiles
const loadMurabbaGeoJSON = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, skipZoom = false) => {
  return loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, false, skipZoom);
};

export function useGeoJsonLayer({
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
}) {
  const loadGeoJsonFallback = useCallback(async () => {
    if (!tehsil || !mouza || !map) return;

    console.log('Loading GeoJSON fallback for:', tehsil, mouza);
    map._geojsonModeActive = true; // PMTiles loaders check this and stay off

    try {
      // On localhost the CRA dev-server proxies relative paths to localhost:5000 where the
      // auth cookie is valid. Using REACT_APP_API_URL (production API) from localhost sends
      // a cross-origin request and the httpOnly cookie is blocked by the browser — causing 401.
      const apiBase = getApiBase();
      let geoJsonData = null;

      // 1. Try static JSON Murabba file first
      const geoJsonUrl = `${apiBase}/JSON Murabba/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}.geojson?t=${Date.now()}`;
      try {
        console.log('Fetching GeoJSON from:', geoJsonUrl);
        const response = await fetch(geoJsonUrl, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (response.ok) {
          geoJsonData = await response.json();
        }
      } catch (err) {
        console.warn('Failed to fetch from static JSON Murabba:', err);
      }

      // 2. If static file not found, try dynamic API database route
      if (!geoJsonData) {
        try {
          const apiGeoJsonUrl = `${apiBase}/api/geojson/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}?t=${Date.now()}`;
          console.log('Trying GeoJSON API database route:', apiGeoJsonUrl);
          const response = await fetch(apiGeoJsonUrl, {
            credentials: 'include',
            cache: 'no-store'
          });
          if (response.ok) {
            geoJsonData = await response.json();
          }
        } catch (err) {
          console.warn('Failed to fetch from /api/geojson:', err);
        }
      }

      if (!geoJsonData) {
        throw new Error(`GeoJSON not found for ${tehsil} / ${mouza}`);
      }

      // Killa-bandi mouza: treat each killa as a murabba (no-op for normal mouzas).
      normalizeKillaBandi(geoJsonData, tehsil, mouza);

      if (!isMounted.current) return;

      console.log('GeoJSON fallback: deferring Leaflet layer creation by 350ms to allow layout to settle');
      safeSetTimeout(() => {
        if (!isMounted.current || !map) return;

        map.invalidateSize();

        const mergedStyle = MAP_STYLES.merged.geojson;
        const murabbaStyle = MAP_STYLES.murabba.geojson;

        if (!map.getPane('fallbackGeoJsonPane')) {
          map.createPane('fallbackGeoJsonPane');
        }
        map.getPane('fallbackGeoJsonPane').style.zIndex = 550; // Below mouzaPMTilesPane (610) and active selected murabbaPane (630)

        if (!fallbackRendererRef.current) {
          fallbackRendererRef.current = L.svg({ pane: 'fallbackGeoJsonPane' });
          fallbackRendererRef.current.addTo(map);
        }

        const geoJsonLayer = L.geoJSON(geoJsonData, {
          pmIgnore: true,
          pane: 'fallbackGeoJsonPane',
          renderer: fallbackRendererRef.current,
          style: (feature) => {
            const isMurabbaBoundary = feature.properties?.layer_type === 'murabba' ||
              feature.properties?.type === 'murabba_boundary';
            const baseStyle = isMurabbaBoundary ? murabbaStyle : mergedStyle;
            
            // Dynamic line width based on zoom level for clear visibility (matching vector tiles)
            const currentZoom = map.getZoom();
            let strokeWidth;
            if (isMurabbaBoundary) {
              if (currentZoom <= 14) strokeWidth = 1.0;
              else if (currentZoom === 15) strokeWidth = 1.5;
              else if (currentZoom === 16) strokeWidth = 2.0;
              else if (currentZoom === 17) strokeWidth = 2.5;
              else strokeWidth = 3.5;
            } else {
              // Merged boundaries (ChakBaghWala style)
              if (currentZoom <= 14) strokeWidth = 1.0;
              else if (currentZoom === 15) strokeWidth = 1.5;
              else if (currentZoom === 16) strokeWidth = 2.0;
              else if (currentZoom === 17) strokeWidth = 2.5;
              else strokeWidth = 3.5;
            }

            return {
              color: baseStyle.color,
              weight: strokeWidth,
              fill: true,
              fillOpacity: baseStyle.fillOpacity > 0 ? baseStyle.fillOpacity : 0.01,
              opacity: baseStyle.opacity,
              fillColor: baseStyle.fillColor !== 'transparent' ? baseStyle.fillColor : (baseStyle.color || '#FFD700')
            };
          },
          onEachFeature: (feature, layer) => {
            // Start downloading this murabba's detail as soon as the pointer is over it
            // (or a finger touches it), so the click shows it without waiting.
            layer.on('mouseover touchstart', () => {
              if (!feature.properties?._killaBandi) prefetchMurabbaGeoJson(feature.properties?.Murabba_No, tehsil, mouza);
            });

            layer.on('click', async (e) => {
              try {
                if (map._isDrawing) return;
                map._featureDblClicked = true;
                // This click already zooms to the murabba. Mark it as click-triggered (as
                // the PMTiles click handlers do) so the selection that follows via onSelect
                // does not fly the map a second time to the metadata centroid.
                map._clickTriggeredSelection = Date.now();

                // Killa-bandi plot: highlight + zoom only, then report the selection.
                if (feature.properties?._killaBandi) {
                  if (e.originalEvent) e.originalEvent._killaHandled = true;
                  selectKillaBandiPlot(layer, map);
                  if (isMounted.current) highlightMurabbaTooltip(feature.properties.Murabba_No);
                  if (onSelect) onSelect(feature.properties.Murabba_No);
                  return;
                }

                // Handle Killa feature click in GeoJSON mode
                if (feature.properties && feature.properties.Killa && typeof layer.getLatLngs === 'function') {
                  if (e.originalEvent) e.originalEvent._killaHandled = true;
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
                }

                const murabbaNo = feature.properties?.Murabba_No;
                if (murabbaNo && isMounted.current) {
                  if (typeof layer.getBounds === 'function') {
                    // One smooth, distance-aware move (short glide for neighbours).
                    focusPoint(map, layer.getBounds().getCenter(), { zoom: 17 });
                  }
                  await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
                  afterMove(map, () => { if (isMounted.current) highlightMurabbaTooltip(murabbaNo); });
                }
              } catch (err) {
                console.warn('loadMurabbaGeoJSON error:', err);
              }
              if (onSelect) {
                // Refresh the click mark: the selection effect runs after this, possibly
                // long after the click if the murabba file was slow to download.
                map._clickTriggeredSelection = Date.now();
                onSelect(feature.properties?.Murabba_No);
              }
            });

            layer.on('programmaticSelect', async () => {
              try {
                if (feature.properties?._killaBandi) { // chosen from the dropdown
                  selectKillaBandiPlot(layer, map);
                  if (isMounted.current) highlightMurabbaTooltip(feature.properties.Murabba_No);
                  return;
                }
                const murabbaNo = feature.properties?.Murabba_No;
                if (murabbaNo && isMounted.current) {
                  await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
                }
              } catch (err) {
                console.warn('programmatic loadMurabbaGeoJSON error:', err);
              }
            });
          }
        });

        if (geoJsonLayerRef) {
          geoJsonLayerRef.current = geoJsonLayer;
        }
        murabbaLayerRef.current = geoJsonLayer;
        fallbackLayerRef.current = geoJsonLayer;

        geoJsonLayer.addTo(map);
        console.log('GeoJSON layer added to map');

        const bounds = geoJsonLayer.getBounds();
        if (bounds && bounds.isValid()) {
          const currentZoom = map.getZoom();
          const alreadyInsideMouza = currentZoom >= 14 && bounds.contains(map.getCenter());
          
          if (!alreadyInsideMouza && !selectedMurabba) {
            map.flyToBounds(bounds, {
              duration: 4,
              easeLinearity: 0.25,
              padding: [20, 20]
            });
          }
        }

        if (geoJsonLayer && geoJsonLayer.getLayers) {
          geoJsonLayer.eachLayer((layer) => {
            const feature = layer.feature;
            if (feature && feature.properties) {
              try {
                if (layer && typeof layer.on === 'function' && typeof layer.getBounds === 'function') {
                  if (feature.properties.Murabba_No) {
                    bindMurabbaTooltip(feature, layer, map, { pane: 'murabbaTooltipPane' });
                  }
                  if (feature.properties.Killa) {
                    bindKillaTooltip(feature, layer, map);
                  }
                }
              } catch (tooltipError) {
                console.warn('GeoJSON fallback tooltip binding error:', tooltipError?.message || tooltipError);
              }
            }
          });

          if (selectedMurabba) {
            console.log('GeoJSON fallback: applying programmatic selection for:', selectedMurabba);
            safeSetTimeout(() => {
              if (!isMounted.current) return;
              geoJsonLayer.eachLayer((layer) => {
                if (String(layer.feature?.properties?.Murabba_No) === String(selectedMurabba)) {
                  console.log('GeoJSON fallback: found matching murabba, firing programmaticSelect');
                  layer.fire('programmaticSelect');
                }
              });
            }, 100);
          }
        }

        // Add dynamic zoom styling listener
        const updateFallbackLayerStyles = () => {
          if (!map || !geoJsonLayer) return;
          const currentZoom = map.getZoom();
          geoJsonLayer.eachLayer((layer) => {
            const feature = layer.feature;
            const isMurabbaBoundary = feature.properties?.layer_type === 'murabba' ||
              feature.properties?.type === 'murabba_boundary';
            
            let strokeWidth;
            if (isMurabbaBoundary) {
              if (currentZoom <= 14) strokeWidth = 1.0;
              else if (currentZoom === 15) strokeWidth = 1.5;
              else if (currentZoom === 16) strokeWidth = 2.0;
              else if (currentZoom === 17) strokeWidth = 2.5;
              else strokeWidth = 3.5;
            } else {
              if (currentZoom <= 14) strokeWidth = 1.0;
              else if (currentZoom === 15) strokeWidth = 1.5;
              else if (currentZoom === 16) strokeWidth = 2.0;
              else if (currentZoom === 17) strokeWidth = 2.5;
              else strokeWidth = 3.5;
            }
            
            if (layer.setStyle) {
              layer.setStyle({ weight: strokeWidth });
            }
          });
        };

        map.on('zoomend', updateFallbackLayerStyles);
        
        // Save clean up references to the layer object so it clears properly
        geoJsonLayer._zoomendHandler = updateFallbackLayerStyles;
        geoJsonLayer.on('remove', () => {
          map.off('zoomend', updateFallbackLayerStyles);
        });

        if (setMurabbaOptions && geoJsonData.features) {
          const options = geoJsonData.features
            .map(feature => feature.properties?.Murabba_No)
            .filter(Boolean)
            .sort(byPlotNumber); // 1, 2, … 10 (not 1, 10, 2)
          setMurabbaOptions([...new Set(options)]);
        }

        onLayerReady?.(geoJsonLayer);
        console.log('GeoJSON fallback loaded successfully');
      }, 350);

    } catch (error) {
      if (isMounted.current) {
        console.error('GeoJSON fallback failed:', error);
        onError?.(error);
      }
      throw error;
    }
  }, [
    tehsil,
    mouza,
    map,
    mustateelLayers,
    onLayerReady,
    onError,
    onSelect,
    setMurabbaOptions,
    selectedMurabba,
    isMounted,
    geoJsonLayerRef,
    murabbaLayerRef,
    fallbackLayerRef,
    fallbackRendererRef,
    highlightMurabbaTooltip,
    isFallbackMode,
    safeSetTimeout,
    MAP_STYLES
  ]);

  return { loadGeoJsonFallback };
}
