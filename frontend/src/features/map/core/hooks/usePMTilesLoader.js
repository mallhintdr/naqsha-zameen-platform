import { useCallback, useRef } from 'react';
import L from 'leaflet';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { getSignedPMTilesUrl } from '@/features/map/config/pmtiles';
import { fetchKillaJson, fetchMurabbaJson } from '@/shared/lib/mouzaApi';
import { loadMurabbaPMTiles } from '../loadMurabbaPMTiles';
import { clearActiveKillaSelection } from '../measurementUtils';

// Helper function to load individual murabba PMTiles
const loadMurabbaGeoJSON = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, skipZoom = false) => {
  return loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, false, skipZoom);
};

export function usePMTilesLoader({
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
}) {
  const isCompleteLoadingRef = useRef(false);
  const tooltipListenersRef = useRef(null);
  /**
   * Helper function to reload mouza PMTiles layers after complete PMTiles loads
   * This ensures mouza layers render on top of complete PMTiles by re-adding them
   */
  const reloadMouzaPMTilesLayers = async (map, mustateelLayersRef, tehsil, mouza, isFallbackMode) => {
    if (!mustateelLayersRef.current || mustateelLayersRef.current.length === 0) {
      console.log('ℹ️ No mouza layers to reload');
      return;
    }

    console.log('🔄 Reloading mouza PMTiles layers to fix rendering order...');

    const mouzaLayersToReload = [];
    mustateelLayersRef.current.forEach(layer => {
      if (layer.murabbaNo) {
        mouzaLayersToReload.push({
          murabbaNo: layer.murabbaNo,
          bounds: layer._murabbaBounds
        });
      }
    });

    if (mouzaLayersToReload.length === 0) {
      console.log('ℹ️ No mouza layers found to reload');
      return;
    }

    console.log(`📋 Found ${mouzaLayersToReload.length} mouza layer(s) to reload`);

    mustateelLayersRef.current.forEach(layer => {
      if (layer.murabbaNo && map.hasLayer(layer)) {
        if (layer._killaTooltips && Array.isArray(layer._killaTooltips)) {
          layer._killaTooltips.forEach(tooltip => {
            if (map.hasLayer(tooltip)) {
              map.removeLayer(tooltip);
            }
          });
        }
        if (layer._zoomHandler) {
          map.off('zoomend', layer._zoomHandler);
        }
        map.removeLayer(layer);
        console.log(`✅ Removed mouza layer: ${layer.murabbaNo}`);
      }
    });

    mustateelLayersRef.current = mustateelLayersRef.current.filter(layer => !layer.murabbaNo);

    for (const layerInfo of mouzaLayersToReload) {
      try {
        console.log(`🔨 Reloading mouza PMTiles: ${layerInfo.murabbaNo}`);
        await loadMurabbaPMTiles(
          layerInfo.murabbaNo,
          tehsil,
          mouza,
          map,
          mustateelLayersRef,
          isFallbackMode,
          testMode,
          true
        );
      } catch (err) {
        console.error(`❌ Failed to reload mouza ${layerInfo.murabbaNo}:`, err);
      }
    }

    console.log('✅ Mouza PMTiles layers reloaded successfully - now rendering on top');
  };

  const loadCompletePMTiles = useCallback(async (tehsil, mouza, map) => {
    if (map) {
      clearActiveKillaSelection(map);
    }

    // GeoJSON mode never uses PMTiles. fallbackLayerRef alone was not enough: it is
    // briefly null while a mouza reloads, and a pending selection then fetched
    // <mouza>-complete.pmtiles in GeoJSON mode.
    if (map && map._geojsonModeActive) {
      console.log('ℹ️ GeoJSON mode active, not loading complete PMTiles');
      return;
    }

    if (completeLayerLoadedRef.current || fallbackLayerRef.current || isCompleteLoadingRef.current) {
      if (fallbackLayerRef.current) {
        console.log('ℹ️ Fallback layer already active, skipping complete PMTiles load');
      } else if (isCompleteLoadingRef.current) {
        console.log('⏳ Complete PMTiles is currently loading, skipping duplicate trigger');
      } else {
        console.log('✅ Complete PMTiles already loaded');
      }
      return;
    }

    isCompleteLoadingRef.current = true;

    try {
      console.log('🔨 Loading complete PMTiles:', `${mouza}-complete.pmtiles`);

      let completeUrl = await getSignedPMTilesUrl(tehsil, mouza, null, `${mouza}-complete.pmtiles`);
      console.log('🔗 Using complete PMTiles URL:', completeUrl);
      let completePMTiles;
      let header;

      try {
        completePMTiles = new PMTiles(completeUrl);
        header = await completePMTiles.getHeader();

        if (!header) {
          throw new Error('Could not load complete PMTiles header');
        }
      } catch (pmTilesError) {
        console.warn('❌ Failed to instantiate complete PMTiles (magic number/header error):', pmTilesError.message);

        if (!completeUrl.includes('/pmtiles/')) {
          const fallbackUrl = `/pmtiles/${tehsil}/${mouza}-complete.pmtiles`;
          console.log('🔄 Trying frontend fallback for corrupt signed URL:', fallbackUrl);
          try {
            completePMTiles = new PMTiles(fallbackUrl);
            header = await completePMTiles.getHeader();
          } catch (fallbackErr) {
            console.error('❌ Frontend fallback also failed:', fallbackErr.message);
            if (pmtilesRef.current) {
              console.warn('⚠️ Complete PMTiles missing, but base layer exists. Aborting fallback to preserve base layer.');
              return;
            }
            await loadFallbackGeoJSONs(tehsil, mouza, map);
            return;
          }
        } else {
          if (pmtilesRef.current) {
            console.warn('⚠️ Complete PMTiles missing, but base layer exists. Aborting fallback to preserve base layer.');
            return;
          }
          await loadFallbackGeoJSONs(tehsil, mouza, map);
          return;
        }
      }

      console.log('✅ Complete PMTiles header loaded:', {
        zoom: `${header.minZoom}-${header.maxZoom}`,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat]
      });

      completePMTilesRef.current = completePMTiles;

      console.log('📍 Loading Killa tooltips from JSON metadata...');
      const killaData = await fetchKillaJson(tehsil, mouza);

      if (killaData && killaData.length > 0) {
        console.log('🔍 First Killa item received in Loader:', killaData[0]);
      } else {
        console.warn('⚠️ No Killa data received or empty array');
      }

      const isDenseMode = killaData && killaData.length > 500;
      const pmtilesZoomThreshold = 15;
      const tooltipZoomThreshold = isDenseMode ? 17 : 16;

      console.log(`🔍 Density Check: count=${killaData?.length || 0}, limit=500, isDense=${isDenseMode}`);
      console.log(`🔍 Complete PMTiles will show at zoom >= ${pmtilesZoomThreshold} (always)`);
      console.log(`🏷️ Killa tooltips will show at zoom >= ${tooltipZoomThreshold} (${isDenseMode ? 'dense' : 'normal'} mode)`);

      const completeLayer = L.gridLayer({
        pane: 'completePMTilesPane',
        attribution: '',
        tileSize: 256,
        minZoom: pmtilesZoomThreshold,
        maxZoom: 22,
        maxNativeZoom: Math.min(header.maxZoom || 20, 22),
        bounds: L.latLngBounds(
          [header.minLat, header.minLon],
          [header.maxLat, header.maxLon]
        )
      });

      const originalTileReady = completeLayer._tileReady;
      completeLayer._tileReady = function (coords, err, tile) {
        if (!this._map) {
          return;
        }
        return originalTileReady.call(this, coords, err, tile);
      };

      completeLayer.createTile = function (coords) {
        const tile = document.createElement('canvas');
        tile.width = 256;
        tile.height = 256;
        const ctx = tile.getContext('2d');

        (async () => {
          try {
            const maxNativeZoom = this.options.maxNativeZoom || 20;
            const requestZ = Math.min(coords.z, maxNativeZoom);
            const zoomDiff = coords.z - requestZ;
            const requestX = Math.floor(coords.x / Math.pow(2, zoomDiff));
            const requestY = Math.floor(coords.y / Math.pow(2, zoomDiff));

            const tileData = await completePMTiles.getZxy(requestZ, requestX, requestY);
            if (tileData) {
              const vectorTile = new VectorTile(new Pbf(tileData.data));
              // Dynamic line width for complete PMTiles (Killa boundaries)
              // Should be 50% (0.5) of the Murabba line width at the same zoom level:
              // Z15: 1.5px * 0.5 = 0.75px
              // Z16: 2.0px * 0.5 = 1.0px
              // Z17: 2.5px * 0.5 = 1.25px
              // Z18+: 3.5px * 0.5 = 1.75px
              let scaledLineWidth;
              if (coords.z <= 15) {
                scaledLineWidth = 0.75;
              } else if (coords.z === 16) {
                scaledLineWidth = 1.0;
              } else if (coords.z === 17) {
                scaledLineWidth = 1.25;
              } else { // Z18+
                scaledLineWidth = 1.75;
              }

              // Adjust for Leaflet overzooming canvas scaling (Z19+ overzooms native Z18 tiles)
              const maxNativeZoom = this.options.maxNativeZoom || 18;
              const overzoomScale = Math.pow(2, Math.max(0, coords.z - maxNativeZoom));
              const adjustedLineWidth = scaledLineWidth / overzoomScale;

              Object.keys(vectorTile.layers).forEach(layerName => {
                const vectorLayer = vectorTile.layers[layerName];

                for (let i = 0; i < vectorLayer.length; i++) {
                  const feature = vectorLayer.feature(i);
                  const geom = feature.loadGeometry();

                  let dashArray = [2, 3];
                  if (coords.z <= 15) dashArray = [2, 8];
                  else if (coords.z === 16) dashArray = [2, 6];
                  else if (coords.z === 17) dashArray = [2, 4];

                  // Scale dash array spacing for overzooming
                  const adjustedDashArray = dashArray.map(val => val / overzoomScale);

                  ctx.strokeStyle = '#FFD700';
                  ctx.lineWidth = adjustedLineWidth;
                  ctx.setLineDash(adjustedDashArray);

                  geom.forEach(ring => {
                    ctx.beginPath();
                    ring.forEach((point, idx) => {
                      const x = (point.x / vectorLayer.extent) * 256;
                      const y = (point.y / vectorLayer.extent) * 256;
                      if (idx === 0) {
                        ctx.moveTo(x, y);
                      } else {
                        ctx.lineTo(x, y);
                      }
                    });
                    ctx.closePath();
                    ctx.stroke();
                  });
                }
              });
            }
          } catch (err) {
            console.warn('Error rendering complete PMTiles tile:', err);
          }
        })();

        return tile;
      };

      if (isMounted.current && map) {
        completeLayer.addTo(map);
        completePMTilesLayerRef.current = completeLayer;
        completeLayerLoadedRef.current = true;

        await reloadMouzaPMTilesLayers(map, mustateelLayers, tehsil, mouza, isFallbackMode);

        map.on('click', handleKillaClick);
      } else {
        console.warn('Map unmounted during complete PMTiles load, aborting');
        return;
      }

      let shouldLoadKillaTooltips = true;

      try {
        const murabbaMeta = await fetchMurabbaJson(tehsil, mouza);
        // Killa-bandi mouzas fall into the "low density & high overlap" case below:
        // the murabba labels (built from the killa numbers) are the single label set.
        if (murabbaMeta && Array.isArray(murabbaMeta.murabba_list) && killaData && killaData.length > 0) {
          const mSet = new Set(murabbaMeta.murabba_list.map(String));
          let matchCount = 0;
          const sampleSize = Math.min(killaData.length, 50);

          for (let i = 0; i < sampleSize; i++) {
            if (mSet.has(String(killaData[i].Killa))) {
              matchCount++;
            }
          }

          const overlapRatio = matchCount / sampleSize;
          const murabbaCount = murabbaMeta.murabba_list.length || 1;
          const killaCount = killaData.length;
          const densityRatio = killaCount / murabbaCount;

          console.log(`📊 Label Analysis: Overlap=${(overlapRatio * 100).toFixed(1)}%, Density=${densityRatio.toFixed(1)} (K:${killaCount}/M:${murabbaCount})`);

          if (overlapRatio > 0.7 && densityRatio < 2.0) {
            console.log('✨ Low density & high overlap detected (Kamoke style). Hiding duplicate Killa labels.');
            shouldLoadKillaTooltips = false;
          } else if (overlapRatio > 0.7) {
            console.log('✨ High density detected (Rajanpur style). Keeping Killa labels despite value overlap.');
          }
        }
      } catch (e) {
        console.warn('⚠️ Error during duplicate label check:', e);
      }

      if (shouldLoadKillaTooltips && killaData && Array.isArray(killaData) && killaData.length > 0) {
        console.log(`` + `✅ Loaded ${killaData.length} Killa centroids from JSON`);

        const spatialDensityMap = new Map();
        const proximityThreshold = 0.0005;

        const grid = new Map();
        killaData.forEach((killa) => {
          if (!killa.centroid) return;
          const [lng, lat] = killa.centroid;
          const cellX = Math.floor(lat / proximityThreshold);
          const cellY = Math.floor(lng / proximityThreshold);
          const key = `${cellX},${cellY}`;
          if (!grid.has(key)) {
            grid.set(key, []);
          }
          grid.get(key).push({ Killa: killa.Killa, lat, lng });
        });

        killaData.forEach((killa1) => {
          if (!killa1.centroid) return;
          const [lng1, lat1] = killa1.centroid;
          const cellX1 = Math.floor(lat1 / proximityThreshold);
          const cellY1 = Math.floor(lng1 / proximityThreshold);
          let nearbyCount = 0;

          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const key = `${cellX1 + dx},${cellY1 + dy}`;
              const cellPoints = grid.get(key);
              if (cellPoints) {
                cellPoints.forEach(pt => {
                  if (pt.Killa !== killa1.Killa) {
                    const d2 = Math.pow(pt.lat - lat1, 2) + Math.pow(pt.lng - lng1, 2);
                    if (d2 < proximityThreshold * proximityThreshold) {
                      nearbyCount++;
                    }
                  }
                });
              }
            }
          }
          spatialDensityMap.set(killa1.Killa, nearbyCount);
        });

        console.log(`🔍 Killa density mode: ${isDenseMode ? 'DENSE' : 'NORMAL'}, threshold zoom: ${tooltipZoomThreshold}`);

        if (!map.getPane('killaTooltipPane')) {
          map.createPane('killaTooltipPane');
          const killaTooltipPane = map.getPane('killaTooltipPane');
          killaTooltipPane.style.zIndex = 620;
        }

        killaData.forEach(killa => {
          if (killa.centroid && killa.Killa) {
            const [lng, lat] = killa.centroid;
            const nearbyTooltips = spatialDensityMap.get(killa.Killa) || 0;

            let densityClass = '';
            if (nearbyTooltips > 25) {
              densityClass = ' killa-tooltip--extremely-dense';
            } else if (nearbyTooltips > 15) {
              densityClass = ' killa-tooltip--very-dense';
            } else if (nearbyTooltips > 8) {
              densityClass = ' killa-tooltip--medium-dense';
            }

            let zoomClass = '';
            const currentZoom = map.getZoom();
            if (currentZoom <= 16) {
              zoomClass = ' killa-tooltip--zoom-low';
            } else if (currentZoom === 17) {
              zoomClass = ' killa-tooltip--zoom-medium';
            } else if (currentZoom >= 18) {
              zoomClass = ' killa-tooltip--zoom-high';
            }

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
          }
        });

        const updateKillaTooltipVisibility = () => {
          const zoom = map.getZoom();
          const shouldShowByZoom = zoom >= tooltipZoomThreshold;
          const mapBounds = isDenseMode ? map.getBounds() : null;

          let zoomClass = '';
          if (zoom <= 16) {
            zoomClass = ' killa-tooltip--zoom-low';
          } else if (zoom === 17) {
            zoomClass = ' killa-tooltip--zoom-medium';
          } else if (zoom >= 18) {
            zoomClass = ' killa-tooltip--zoom-high';
          }

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
                if (!el.hasAttribute('data-killa-click')) {
                  el.setAttribute('data-killa-click', 'true');
                  el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (tooltip._latlng) {
                      handleKillaClick({ latlng: L.latLng(tooltip._latlng) });
                    }
                  });
                }
                el.classList.remove('killa-tooltip--zoom-low', 'killa-tooltip--zoom-medium', 'killa-tooltip--zoom-high');
                if (zoomClass) {
                  el.classList.add(zoomClass.trim());
                }
                if (tooltip._densityClass && !el.classList.contains(tooltip._densityClass.trim())) {
                  el.classList.add(tooltip._densityClass.trim());
                }
              }
            }
          });
        };

        let isMapAnimating = false;

        const onMoveStart = () => {
          isMapAnimating = true;
          killaTooltipsRef.current.forEach(tooltip => {
            if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
          });
        };

        const onMoveEnd = () => {
          isMapAnimating = false;
          updateKillaTooltipVisibility();
        };

        if (tooltipListenersRef.current) {
          map.off('movestart', tooltipListenersRef.current.onMoveStart);
          map.off('moveend', tooltipListenersRef.current.onMoveEnd);
          map.off('zoomend', tooltipListenersRef.current.updateKillaTooltipVisibility);
          tooltipListenersRef.current = null;
        }

        map.on('movestart', onMoveStart);
        map.on('moveend', onMoveEnd);
        map.on('zoomend', updateKillaTooltipVisibility);

        tooltipListenersRef.current = { onMoveStart, onMoveEnd, updateKillaTooltipVisibility };

        map._hasKillaTooltips = true;
        map._completePMTilesLoaded = true;

        updateKillaTooltipVisibility();

        console.log(`✅ Created ${killaTooltipsRef.current.length} Killa tooltips (visible at zoom >= ${tooltipZoomThreshold}${isDenseMode ? ', viewport-filtered' : ''})`);
      } else {
        console.warn('⚠️ No Killa JSON data found from Metadata. Attempting tile-based Killa tooltip extraction...');
        try {
          const tooltipZoom = Math.min(header.maxZoom || 18, 16);
          const n = Math.pow(2, tooltipZoom);
          const minTileX = Math.floor((header.minLon + 180) / 360 * n);
          const maxTileX = Math.floor((header.maxLon + 180) / 360 * n);
          const minTileY = Math.floor((1 - Math.log(Math.tan(header.maxLat * Math.PI / 180) + 1 / Math.cos(header.maxLat * Math.PI / 180)) / Math.PI) / 2 * n);
          const maxTileY = Math.floor((1 - Math.log(Math.tan(header.minLat * Math.PI / 180) + 1 / Math.cos(header.minLat * Math.PI / 180)) / Math.PI) / 2 * n);

          const tilePromises = [];
          for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
              tilePromises.push(
                completePMTiles.getZxy(tooltipZoom, tileX, tileY)
                  .then(tileData => ({ tileData, tileX, tileY }))
                  .catch(() => null)
              );
            }
          }

          const tiles = await Promise.all(tilePromises);
          const processedKillas = new Map();

          for (const tile of tiles) {
            if (!tile || !tile.tileData) continue;
            const { tileData, tileX, tileY } = tile;
            const vectorTile = new VectorTile(new Pbf(tileData.data));

            Object.keys(vectorTile.layers).forEach(layerName => {
              const vectorLayer = vectorTile.layers[layerName];
              for (let i = 0; i < vectorLayer.length; i++) {
                const feature = vectorLayer.feature(i);
                const geom = feature.loadGeometry();
                const properties = feature.properties;
                const killaValue = properties?.Killa || properties?.Killa_No || properties?.killa || properties?.KILLA;

                if (killaValue) {
                  const coords = [];
                  geom.forEach(ring => {
                    ring.forEach(point => {
                      const x = point.x / vectorLayer.extent;
                      const y = point.y / vectorLayer.extent;
                      const lon = (tileX + x) / n * 360 - 180;
                      const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + y) / n)));
                      const lat = latRad * 180 / Math.PI;
                      coords.push([lat, lon]);
                    });
                  });

                  if (!processedKillas.has(String(killaValue))) {
                    processedKillas.set(String(killaValue), []);
                  }
                  processedKillas.get(String(killaValue)).push(...coords);
                }
              }
            });
          }

          if (processedKillas.size > 0) {
            if (!map.getPane('killaTooltipPane')) {
              map.createPane('killaTooltipPane');
              map.getPane('killaTooltipPane').style.zIndex = 620;
            }

            processedKillas.forEach((coords, killaVal) => {
              if (!coords || coords.length === 0) return;
              const poly = L.polygon(coords);
              const center = poly.getBounds().getCenter();

              const tooltip = L.tooltip({
                permanent: true,
                direction: 'center',
                className: 'killa-tooltip',
                opacity: 0.9,
                offset: L.point(0, 0),
                pane: 'killaTooltipPane'
              })
                .setLatLng(center)
                .setContent(String(killaVal));

              tooltip._killaNo = killaVal;
              tooltip._latlng = center;
              killaTooltipsRef.current.push(tooltip);
            });

            const updateExtractedTooltipVisibility = () => {
              const zoom = map.getZoom();
              const shouldShow = zoom >= 16;
              killaTooltipsRef.current.forEach(tooltip => {
                if (shouldShow && !map.hasLayer(tooltip)) {
                  tooltip.addTo(map);
                } else if (!shouldShow && map.hasLayer(tooltip)) {
                  map.removeLayer(tooltip);
                }
                if (map.hasLayer(tooltip)) {
                  const el = tooltip.getElement();
                  if (el && !el.hasAttribute('data-killa-click')) {
                    el.setAttribute('data-killa-click', 'true');
                    el.addEventListener('click', (e) => {
                      e.stopPropagation();
                      if (tooltip._latlng) {
                        handleKillaClick({ latlng: L.latLng(tooltip._latlng) });
                      }
                    });
                  }
                }
              });
            };

            if (tooltipListenersRef.current) {
              map.off('zoomend', tooltipListenersRef.current.updateExtractedTooltipVisibility);
            }
            map.on('zoomend', updateExtractedTooltipVisibility);
            tooltipListenersRef.current = { updateExtractedTooltipVisibility };

            map._hasKillaTooltips = true;
            map._completePMTilesLoaded = true;

            updateExtractedTooltipVisibility();
            console.log(`✅ Created ${killaTooltipsRef.current.length} tile-extracted Killa tooltips`);
          }
        } catch (tileErr) {
          console.warn('⚠️ Tile-based Killa extraction failed:', tileErr);
        }
      }

      console.log('✅ Complete PMTiles layer added to map with Killa tooltips');

    } catch (error) {
      console.error('Error loading complete PMTiles:', error);
    } finally {
      isCompleteLoadingRef.current = false;
    }
  }, [
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
  ]);

  return { loadCompletePMTiles };
}
