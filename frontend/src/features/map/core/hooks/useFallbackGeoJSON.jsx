import { useCallback } from 'react';
import { apiBase as getApiBase } from '@/shared/api/base';
import L from 'leaflet';
import { loadMurabbaPMTiles } from '../loadMurabbaPMTiles';
import { showKaramSegmentLengths, clearActiveKillaSelection } from '../measurementUtils';
import { focusPoint } from '../utils/murabbaCamera';
import { vectorFetch } from '@/shared/lib/vectorFetch';

// Helper function to load individual murabba PMTiles (delegates to external module)
const loadMurabbaGeoJSON = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, skipZoom = false) => {
  return loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, false, skipZoom);
};

export function useFallbackGeoJSON({
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
}) {
  const loadFallbackGeoJSONs = useCallback(async () => {
    console.log('⚠️ Initiating fallback to individual Murabba GeoJSONs...');

    // CRITICAL: Clean up any existing PMTiles layers and tooltips before loading fallback
    console.log('🧹 Cleaning up existing PMTiles layers before fallback...');

    // Remove complete PMTiles layer
    if (completePMTilesLayerRef.current) {
      try {
        if (map.hasLayer(completePMTilesLayerRef.current)) {
          map.removeLayer(completePMTilesLayerRef.current);
        }
        completePMTilesLayerRef.current = null;
      } catch (err) {
        console.warn('Error removing complete PMTiles layer:', err);
      }
    }

    // Remove ALL existing Killa tooltips
    if (killaTooltipsRef.current && killaTooltipsRef.current.length > 0) {
      console.log(`🧹 Removing ${killaTooltipsRef.current.length} existing Killa tooltips...`);
      killaTooltipsRef.current.forEach(tooltip => {
        try {
          if (map.hasLayer(tooltip)) {
            map.removeLayer(tooltip);
          }
        } catch (err) {
          console.warn('Error removing tooltip:', err);
        }
      });
      killaTooltipsRef.current = [];
    }

    // Remove fallback-specific event listeners
    if (fallbackLayerRef.current && fallbackLayerRef.current._killaHandlers) {
      const { zoomend, moveend } = fallbackLayerRef.current._killaHandlers;
      if (zoomend) {
        map.off('zoomend', zoomend);
      }
      if (moveend) {
        map.off('moveend', moveend);
      }
      fallbackLayerRef.current._killaHandlers = null;
    }

    // Remove murabba tooltip handlers
    if (fallbackLayerRef.current && fallbackLayerRef.current._murabbaHandlers) {
      const { zoomend, moveend } = fallbackLayerRef.current._murabbaHandlers;
      if (zoomend) {
        map.off('zoomend', zoomend);
      }
      if (moveend) {
        map.off('moveend', moveend);
      }
      fallbackLayerRef.current._murabbaHandlers = null;
    }

    // Remove murabba tooltips
    if (murabbaTooltipsRef.current && murabbaTooltipsRef.current.length > 0) {
      console.log(`🧹 Removing ${murabbaTooltipsRef.current.length} existing murabba tooltips...`);
      murabbaTooltipsRef.current.forEach(tooltip => {
        try {
          if (map.hasLayer(tooltip)) {
            map.removeLayer(tooltip);
          }
        } catch (err) {
          console.warn('Error removing murabba tooltip:', err);
        }
      });
      murabbaTooltipsRef.current = [];
    }

    // Clear any existing individually loaded murabba GeoJSON layers
    if (mustateelLayers && mustateelLayers.current && mustateelLayers.current.length > 0) {
      mustateelLayers.current.forEach((layer, index) => {
        try {
          if (layer._zoomHandler) {
            map.off('zoomend', layer._zoomHandler);
          }
          if (layer._updateTooltipSize) {
            map.off('zoomend', layer._updateTooltipSize);
          }
          if (layer._killaTooltips && Array.isArray(layer._killaTooltips)) {
            layer._killaTooltips.forEach((marker) => {
              if (marker._zoomHandler) {
                map.off('zoomend', marker._zoomHandler);
              }
              if (map.hasLayer(marker)) {
                map.removeLayer(marker);
              }
            });
            layer._killaTooltips = [];
          }
          if (map.hasLayer(layer)) {
            map.removeLayer(layer);
          }
        } catch (err) {
          console.warn(`Error removing murabba layer ${index} during fallback cleanup:`, err);
        }
      });
      mustateelLayers.current = [];
    }

    // Notify parent that we are in fallback mode
    if (onFallbackMode) {
      onFallbackMode(true);
    }

    try {
      // 1. Fetch metadata to get list of Murabbas
      // Try both locations: Metadata folder and Tehsil folder
      let metadata = null;

      // Try standard Metadata location first
      try {
        const apiBase = getApiBase();
        const metaUrl = `${apiBase}/Metadata/${tehsil}/${mouza}-Murabba.json`;
        const res = await vectorFetch(metaUrl, { credentials: 'include' });
        if (res.ok) {
          metadata = await res.json();
        }
      } catch (e) {
        console.warn('Failed to fetch metadata from standard location', e);
      }

      if (!metadata || !metadata.murabba_list) {
        console.error('❌ No metadata available for fallback loading');
        return;
      }

      const murabbas = metadata.murabba_list;
      console.log(`Found ${murabbas.length} murabbas to load for fallback.`);

      // Extract murabba centroids for creating clickable tooltips
      const murabbaCentroids = metadata.murabba_centroids || {};
      console.log(`Found ${Object.keys(murabbaCentroids).length} murabba centroids for tooltips`);

      // 2. Create FeatureGroup for the fallback layers
      if (fallbackLayerRef.current) {
        try {
          if (map.hasLayer(fallbackLayerRef.current)) {
            map.removeLayer(fallbackLayerRef.current);
          }
        } catch (err) {
          console.warn('Error removing previous fallback layer:', err);
        }
      }
      if (fallbackRendererRef.current) {
        try {
          fallbackRendererRef.current.remove();
        } catch (err) {
          console.warn('Error removing previous fallback renderer:', err);
        }
        fallbackRendererRef.current = null;
      }

      const fallbackGroup = L.featureGroup();

      // Create a dedicated pane for fallback layers
      let fallbackPane = map.getPane('fallbackGeoJsonPane');
      if (!fallbackPane) {
        fallbackPane = map.createPane('fallbackGeoJsonPane');
      }
      fallbackPane.style.zIndex = 550; // Underneath mouzaPMTilesPane (610) and murabba selection pane (630)
      fallbackPane.style.pointerEvents = 'auto';
      fallbackPane.innerHTML = '';
      fallbackPane.style.transform = '';
      fallbackPane.style.left = '0px';
      fallbackPane.style.top = '0px';

      fallbackRendererRef.current = L.svg({ pane: 'fallbackGeoJsonPane' });
      fallbackRendererRef.current.addTo(map);

      // 3. Load each Murabba GeoJSON
      let loadedCount = 0;
      const allKillaCentroids = []; // Store collected Killa centroids for tooltips

      // Load in parallel chunks to avoid overwhelming the browser
      const CHUNK_SIZE = 5;
      for (let i = 0; i < murabbas.length; i += CHUNK_SIZE) {
        const chunk = murabbas.slice(i, i + CHUNK_SIZE);

        await Promise.all(chunk.map(async (murabba) => {
          // Sanitize murabba name (replace / with -)
          const safeMurabba = String(murabba).replace(/\//g, '-');
          // Remove other invalid chars to match python script: re.sub(r'[\\:*?"<>|]', '_', safe_gk)
          const sanitized = safeMurabba.replace(/[\\:*?"<>|]/g, '_').trim();

          const apiBase = getApiBase();
          const url = `${apiBase}/JSON Murabba/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}/${encodeURIComponent(sanitized)}.geojson`;

          try {
            const res = await vectorFetch(url, { credentials: 'include' });
            if (!res.ok) {
              console.warn(`Failed to fetch fallback GeoJSON: ${url} (Status: ${res.status})`);
              return;
            }

            const data = await res.json();

            const updateKillaStyle = () => {
              const currentZoom = map.getZoom();
              let scaledLineWidth;
              if (currentZoom <= 15) scaledLineWidth = 0.75;
              else if (currentZoom === 16) scaledLineWidth = 1.0;
              else if (currentZoom === 17) scaledLineWidth = 1.25;
              else scaledLineWidth = 1.75;

              let dashArray = '2, 3';
              if (currentZoom <= 15) dashArray = '2, 8';
              else if (currentZoom === 16) dashArray = '2, 6';
              else if (currentZoom === 17) dashArray = '2, 4';

              return {
                color: '#FFD700', // Bright gold highlight
                weight: scaledLineWidth, // 50% of murabba width
                dashArray: dashArray, // Dotted line style matching PMTiles
                opacity: 1,
                fill: true,
                fillColor: '#FFD700',
                fillOpacity: 0.001
              };
            };

            const killaLayer = L.geoJSON(data, {
              pmIgnore: true,
              pane: 'fallbackGeoJsonPane',
              renderer: fallbackRendererRef.current,
              style: updateKillaStyle,
              onEachFeature: (feature, layer) => {
                // Collect Killa centroids for density-based tooltips
                if (feature.properties && feature.properties.Killa) {
                  const center = layer.getBounds().getCenter();
                  allKillaCentroids.push({
                    Killa: feature.properties.Killa,
                    centroid: [center.lng, center.lat]
                  });

                  // Bind Killa click listener for Karam side measurements
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
                }
              }
            }).addTo(fallbackGroup);

            loadedCount++;
          } catch (e) {
            // Silent fail for individual files
          }
        }));
      }

      if (loadedCount > 0) {
        fallbackGroup.addTo(map);
        fallbackLayerRef.current = fallbackGroup;
        console.log(`✅ Loaded ${loadedCount} fallback Murabba GeoJSONs`);

        // Store bounds for the fallback group
        const groupBounds = fallbackGroup.getBounds();
        if (groupBounds && groupBounds.isValid()) {
          fallbackLayerRef.current._fallbackBounds = groupBounds;
          console.log('📍 Fallback group bounds:', groupBounds);

          // Zoom to the fallback group bounds
          map.fitBounds(groupBounds, {
            padding: [20, 20],
            maxZoom: 16,
            animate: !testMode, // Disable animation in test mode
            duration: testMode ? 0 : 0.25
          });
        }

        // Mark as loaded so we don't retry
        completeLayerLoadedRef.current = true;

        // ---------------------------------------------------------
        // Implement Density-Based Tooltips for Fallback GeoJSONs
        // ---------------------------------------------------------
        if (allKillaCentroids.length > 0) {
          console.log(`📍 Generating tooltips for ${allKillaCentroids.length} fallback Killas...`);

          // Clear existing tooltips
          killaTooltipsRef.current.forEach(t => {
            if (map.hasLayer(t)) map.removeLayer(t);
          });
          killaTooltipsRef.current = [];

          const isDenseMode = allKillaCentroids.length > 500;
          const tooltipZoomThreshold = isDenseMode ? 16 : 15; // Sync with complete PMTiles

          // Calculate spatial density
          const spatialDensityMap = new Map();
          const proximityThreshold = 0.0005; // ~55 meters

          allKillaCentroids.forEach((killa1, idx1) => {
            const [lng1, lat1] = killa1.centroid;
            let nearbyCount = 0;

            const checkLimit = 500;
            let checked = 0;

            for (let idx2 = 0; idx2 < allKillaCentroids.length; idx2++) {
              if (idx1 === idx2) continue;
              if (checked++ > checkLimit) break;

              const killa2 = allKillaCentroids[idx2];
              const [lng2, lat2] = killa2.centroid;
              const distance = Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2));
              if (distance < proximityThreshold) {
                nearbyCount++;
              }
            }

            spatialDensityMap.set(killa1.Killa, nearbyCount);
          });

          // Ensure killa tooltip pane exists
          if (!map.getPane('killaTooltipPane')) {
            map.createPane('killaTooltipPane');
            map.getPane('killaTooltipPane').style.zIndex = 615;
          }

          // Create tooltips
          allKillaCentroids.forEach(killa => {
            const [lng, lat] = killa.centroid;
            const nearbyTooltips = spatialDensityMap.get(killa.Killa) || 0;

            let densityClass = '';
            if (nearbyTooltips > 25) densityClass = ' killa-tooltip--extremely-dense';
            else if (nearbyTooltips > 15) densityClass = ' killa-tooltip--very-dense';
            else if (nearbyTooltips > 8) densityClass = ' killa-tooltip--medium-dense';

            let zoomClass = '';
            const currentZoom = map.getZoom();
            if (currentZoom <= 16) zoomClass = ' killa-tooltip--zoom-low';
            else if (currentZoom === 17) zoomClass = ' killa-tooltip--zoom-medium';
            else if (currentZoom >= 18) zoomClass = ' killa-tooltip--zoom-high';

            const tooltip = L.tooltip({
              permanent: true,
              direction: 'center',
              className: 'killa-tooltip' + densityClass + zoomClass,
              opacity: 0.9,
              offset: L.point(0, 0),
              pane: 'killaTooltipPane'
            })
              .setLatLng([lat, lng])
              .setContent(String(killa.Killa));

            tooltip._killaNo = killa.Killa;
            tooltip._latlng = [lat, lng];
            tooltip._densityClass = densityClass;

            killaTooltipsRef.current.push(tooltip);
          });

          // Visibility Handler
          const updateKillaTooltipVisibility = () => {
            const zoom = map.getZoom();
            const shouldShowByZoom = zoom >= tooltipZoomThreshold;
            const mapBounds = isDenseMode ? map.getBounds() : null;

            // Dynamically update Killa GeoJSON vector paths styles
            fallbackGroup.eachLayer(layer => {
              if (layer.setStyle && typeof layer.options.style === 'function') {
                layer.setStyle(layer.options.style(layer.feature));
              }
            });

            let zoomClass = '';
            if (zoom <= 16) zoomClass = ' killa-tooltip--zoom-low';
            else if (zoom === 17) zoomClass = ' killa-tooltip--zoom-medium';
            else if (zoom >= 18) zoomClass = ' killa-tooltip--zoom-high';

            killaTooltipsRef.current.forEach(tooltip => {
              const withinViewport = !isDenseMode || !tooltip._latlng || mapBounds.contains(tooltip._latlng);
              const shouldShow = shouldShowByZoom && withinViewport;

              if (shouldShow && !map.hasLayer(tooltip)) {
                tooltip.addTo(map);
              } else if (!shouldShow && map.hasLayer(tooltip)) {
                map.removeLayer(tooltip);
              }

              if (map.hasLayer(tooltip)) {
                const el = tooltip.getElement();
                if (el) {
                  el.classList.remove('killa-tooltip--zoom-low', 'killa-tooltip--zoom-medium', 'killa-tooltip--zoom-high');
                  if (zoomClass) el.classList.add(zoomClass.trim());
                  if (tooltip._densityClass && !el.classList.contains(tooltip._densityClass.trim())) {
                    el.classList.add(tooltip._densityClass.trim());
                  }
                }
              }
            });
          };

          // Store handlers for cleanup
          if (!fallbackLayerRef.current._killaHandlers) {
            fallbackLayerRef.current._killaHandlers = {
              zoomend: updateKillaTooltipVisibility,
              moveend: isDenseMode ? updateKillaTooltipVisibility : null
            };
          }

          // Initial check and listeners
          updateKillaTooltipVisibility();
          map.on('zoomend', updateKillaTooltipVisibility);
          if (isDenseMode) {
            map.on('moveend', updateKillaTooltipVisibility);
          }

          console.log(`✅ Fallback Killa tooltips configured (${killaTooltipsRef.current.length} tooltips)`);
        }

        // ---------------------------------------------------------
        // Create Murabba-level Tooltips for Fallback Mode
        // ---------------------------------------------------------
        if (Object.keys(murabbaCentroids).length > 0) {
          console.log(`📍 Creating ${Object.keys(murabbaCentroids).length} murabba tooltips for fallback mode...`);

          // Clear existing murabba tooltips
          murabbaTooltipsRef.current.forEach(t => {
            if (map.hasLayer(t)) map.removeLayer(t);
          });
          murabbaTooltipsRef.current = [];

          // Ensure murabba tooltip pane exists
          if (!map.getPane('murabbaTooltipPane')) {
            map.createPane('murabbaTooltipPane');
            map.getPane('murabbaTooltipPane').style.zIndex = 640;
          }

          const isDenseMode = Object.keys(murabbaCentroids).length > 400;
          const tooltipZoomThreshold = 15; // Always show at zoom 15+ regardless of density

          // Create murabba tooltips
          Object.entries(murabbaCentroids).forEach(([murabbaNo, coords]) => {
            if (!coords || !Array.isArray(coords) || coords.length !== 2) return;

            // NOTE: Metadata has [lng, lat] but Leaflet expects [lat, lng]
            const latlng = [coords[1], coords[0]];

            let zoomClass = '';
            const currentZoom = map.getZoom();
            if (currentZoom <= 14) {
              zoomClass = ' murabba-tooltip--zoom-low';
            } else if (currentZoom === 15) {
              zoomClass = ' murabba-tooltip--zoom-medium';
            } else if (currentZoom >= 18) {
              zoomClass = ' murabba-tooltip--zoom-high';
            }

            const baseClass = isDenseMode ? 'murabba-tooltip murabba-tooltip--dense clickable-tooltip' : 'murabba-tooltip clickable-tooltip';

            const tooltip = L.tooltip({
              permanent: true,
              direction: 'center',
              className: baseClass + zoomClass,
              interactive: true,
              opacity: 1.0,
              offset: getMurabbaTooltipOffset(currentZoom, isDenseMode),
              pane: 'murabbaTooltipPane'
            })
              .setLatLng(latlng)
              .setContent(String(murabbaNo));

            tooltip._murabbaNo = murabbaNo;
            tooltip._latlng = latlng;

            murabbaTooltipsRef.current.push(tooltip);
          });

          // Visibility and click handler for murabba tooltips
          const updateMurabbaTooltips = () => {
            const zoom = map.getZoom();
            const shouldShowByZoom = zoom >= tooltipZoomThreshold;

            let zoomClass = '';
            if (zoom <= 14) {
              zoomClass = ' murabba-tooltip--zoom-low';
            } else if (zoom === 15) {
              zoomClass = ' murabba-tooltip--zoom-medium';
            } else if (zoom >= 18) {
              zoomClass = ' murabba-tooltip--zoom-high';
            }
            const mapBounds = isDenseMode ? map.getBounds() : null;
            const dynamicOffset = getMurabbaTooltipOffset(zoom, isDenseMode);

            murabbaTooltipsRef.current.forEach(tooltip => {
              const el = tooltip.getElement();
              const isSelected = el && el.classList.contains('murabba-tooltip--selected-displaced');
              if (!isSelected) {
                tooltip.options.offset = dynamicOffset;
                if (map.hasLayer(tooltip)) {
                  tooltip.update();
                }
              }
              const withinViewport = !isDenseMode || !tooltip._latlng || mapBounds.contains(tooltip._latlng);
              const shouldShow = shouldShowByZoom && withinViewport;

              if (shouldShow && !map.hasLayer(tooltip)) {
                tooltip.addTo(map);

                // Add click handler when tooltip is added
                const el = tooltip.getElement();
                if (el && !el.hasAttribute('data-click-handler')) {
                  el.setAttribute('data-click-handler', 'true');
                  el.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (map._isDrawing) return; // Skip during draw/edit mode
                    const murabbaNo = tooltip._murabbaNo;
                    const murabbaCenter = tooltip._latlng;

                    console.log('🔨 Fallback mode: Loading individual murabba GeoJSON:', murabbaNo);

                    // Highlight this tooltip
                    highlightMurabbaTooltip(murabbaNo);

                    if (onSelect) {
                      onSelect(murabbaNo);
                    }

                    // Load individual murabba GeoJSON
                    await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, true);

                    // Centre on the murabba (one smooth, distance-aware move)
                    if (murabbaCenter) {
                      map._clickTriggeredSelection = Date.now();
                      const targetZoom = completeLayerLoadedRef.current ? 18 : 20;
                      if (testMode) map.setView(murabbaCenter, targetZoom, { animate: false });
                      else focusPoint(map, murabbaCenter, { zoom: targetZoom, maxZoom: 20 });
                    }
                  });
                }
              }

              // Update zoom-based class for ALL visible tooltips (newly added or already on map)
              if (shouldShow && map.hasLayer(tooltip)) {
                const el = tooltip.getElement();
                if (el) {
                  // Remove old zoom classes
                  el.classList.remove('murabba-tooltip--zoom-low', 'murabba-tooltip--zoom-medium', 'murabba-tooltip--zoom-high');
                  // Add new zoom class
                  if (zoomClass) {
                    el.classList.add(zoomClass.trim());
                  }
                  // Ensure density class persists (if in dense mode)
                  if (isDenseMode && !el.classList.contains('murabba-tooltip--dense')) {
                    el.classList.add('murabba-tooltip--dense');
                  }
                }
              } else if (!shouldShow && map.hasLayer(tooltip)) {
                map.removeLayer(tooltip);
              }
            });
          };

          // Store handlers for cleanup
          if (!fallbackLayerRef.current._murabbaHandlers) {
            fallbackLayerRef.current._murabbaHandlers = {
              zoomend: updateMurabbaTooltips,
              moveend: isDenseMode ? updateMurabbaTooltips : null
            };
          }

          // Initial check and listeners
          updateMurabbaTooltips();
          map.on('zoomend', updateMurabbaTooltips);
          if (isDenseMode) {
            map.on('moveend', updateMurabbaTooltips);
          }

          console.log(`✅ Fallback murabba tooltips configured (${murabbaTooltipsRef.current.length} tooltips)`);
        }

      } else {
        const msg = '❌ Failed to load any fallback GeoJSONs. Data may be missing.';
        console.warn(msg);
        if (onError) onError(new Error(msg));
      }

    } catch (err) {
      console.error('Error in fallback loading:', err);
      if (onError) onError(err);
    }
  }, [
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
  ]);

  return { loadFallbackGeoJSONs };
}
