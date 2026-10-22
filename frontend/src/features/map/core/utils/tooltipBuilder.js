import L from 'leaflet';
import { fetchMurabbaJson } from '@/shared/lib/mouzaApi';
import { focusPoint, focusBounds, afterMove, wasClickSelection } from './murabbaCamera';

// Helper function to load individual murabba PMTiles
const loadMurabbaGeoJSON = async (murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, skipZoom = false) => {
  const { loadMurabbaPMTiles } = require('../loadMurabbaPMTiles');
  return loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, false, skipZoom);
};

export async function buildMurabbaBoundsMap(
  pmtiles,
  header,
  murabbaNumbers,
  {
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
  }
) {
  const cacheKey = `${tehsil}/${mouza}`;

  if (murabbaTooltipsRef.current.length > 0) {
    console.log('⏭️ Tooltips already created for current mouza, skipping...');
    return true;
  }

  const cached = mouzaCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    console.log(`🚀 Cache hit for ${cacheKey} - restoring ${cached.tooltips.length} tooltips (${Math.round((CACHE_DURATION - (Date.now() - cached.timestamp)) / 1000)}s remaining)`);

    murabbaBoundsMapRef.current = new Map(cached.boundsMap);

    cached.tooltips.forEach(tooltipData => {
      const marker = L.marker(tooltipData.position, {
        icon: L.divIcon({
          className: tooltipData.className,
          html: tooltipData.html,
          iconSize: tooltipData.iconSize
        }),
        interactive: false,
        pane: 'tooltipPane'
      });

      const tooltip = L.tooltip({
        permanent: true,
        direction: 'center',
        className: tooltipData.tooltipClassName,
        offset: tooltipData.offset,
        interactive: true,
        pane: 'murabbaTooltipPane'
      }).setContent(tooltipData.content);

      tooltip._murabbaNo = String(tooltipData.murabbaNo || tooltipData.content);
      tooltip._latlng = tooltipData.position;

      marker.bindTooltip(tooltip);
      murabbaTooltipsRef.current.push(marker);
    });

    const updateTooltips = () => {
      const bounds = map.getBounds();
      const currentZoom = map.getZoom();
      const visibleTooltips = [];
      
      const isZoomOk = currentZoom >= 15;

      murabbaTooltipsRef.current.forEach(marker => {
        const latlng = marker.getLatLng();
        if (isZoomOk && latlng && bounds.contains(latlng)) {
          visibleTooltips.push(marker);
        }
      });

      const showTooltips = isZoomOk && visibleTooltips.length <= 400;

      let zoomClass = '';
      if (currentZoom <= 14) {
        zoomClass = ' murabba-tooltip--zoom-low';
      } else if (currentZoom === 15) {
        zoomClass = ' murabba-tooltip--zoom-medium';
      } else if (currentZoom >= 18) {
        zoomClass = ' murabba-tooltip--zoom-high';
      }

      murabbaTooltipsRef.current.forEach(marker => {
        const latlng = marker.getLatLng();
        const shouldShow = showTooltips && latlng && bounds.contains(latlng);
        if (shouldShow) {
          if (!map.hasLayer(marker)) marker.addTo(map);
          const tooltip = marker.getTooltip();
          if (tooltip) {
            const el = tooltip.getElement();
            if (el) {
              if (!el.hasAttribute('data-click-handler')) {
                el.setAttribute('data-click-handler', 'true');
                el.addEventListener('click', async (e) => {
                  e.stopPropagation();
                  map._featureDblClicked = true;
                  map._clickTriggeredSelection = Date.now();
                  const murabbaNo = tooltip._murabbaNo || tooltip.getContent();
                  const murabbaCenter = tooltip._latlng || marker.getLatLng();

                  if (onSelect) {
                    onSelect(murabbaNo);
                  }

                  try {
                    await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
                  } catch (err) {
                    console.warn('Failed to load murabba boundaries on cached tooltip click:', err);
                  }

                  // One smooth move; complete PMTiles + highlight after it settles.
                  if (murabbaCenter) focusPoint(map, murabbaCenter, { zoom: 17 });
                  afterMove(map, () => {
                    console.log('🔨 Loading complete PMTiles for murabba:', murabbaNo);
                    loadCompletePMTiles(tehsil, mouza, map);
                    highlightMurabbaTooltip(murabbaNo);
                  });
                });
              }
              el.classList.remove('murabba-tooltip--zoom-low', 'murabba-tooltip--zoom-medium', 'murabba-tooltip--zoom-high');
              if (zoomClass) {
                el.classList.add(zoomClass.trim());
              }
            }
          }
        } else {
          if (map.hasLayer(marker)) map.removeLayer(marker);
        }
      });
    };

    updateTooltips();
    map.on('zoomend', updateTooltips);
    map.on('moveend', updateTooltips);
    console.log(`` + `✅ Restored ${murabbaTooltipsRef.current.length} tooltips from cache in <10ms`);
    return true;
  }

  console.log('💾 Cache miss - building new tooltips for', murabbaNumbers.length, 'murabbas...');

  murabbaBoundsMapRef.current.clear();

  let murabbaCentroids = new Map();

  try {
    const metadataJson = await fetchMurabbaJson(tehsil, mouza);
    if (metadataJson && metadataJson.murabba_centroids) {
      console.log('✅ Loading centroids from metadata JSON:', Object.keys(metadataJson.murabba_centroids).length, 'centroids');

      Object.entries(metadataJson.murabba_centroids).forEach(([murabbaNo, coords]) => {
        if (coords && Array.isArray(coords) && coords.length === 2) {
          murabbaCentroids.set(String(murabbaNo), [coords[1], coords[0]]);
        }
      });

      console.log(`✅ Loaded ${murabbaCentroids.size} centroids from metadata`);
    }
  } catch (metadataError) {
    console.warn('Failed to load metadata JSON, will extract from PMTiles:', metadataError);
  }

  if (murabbaCentroids.size === 0) {
    if (window.scannedMurabbaCentroids && Object.keys(window.scannedMurabbaCentroids).length > 0) {
      console.log('✅ Reusing centroids extracted during tile scanning phase:', Object.keys(window.scannedMurabbaCentroids).length);
      Object.entries(window.scannedMurabbaCentroids).forEach(([mNo, latlng]) => {
        murabbaCentroids.set(String(mNo), latlng);
      });
    }
    console.log(`✅ Extracted ${murabbaCentroids.size} centroids from PMTiles tiles`);
  }

  const isDenseMode = murabbaCentroids.size > 400;
  const tooltipZoomThreshold = 15;
  const debounceDelay = isDenseMode ? 120 : 0;

  const spatialDensityMap = new Map();
  const proximityThreshold = 0.001;

  const grid = new Map();
  murabbaCentroids.forEach((latlng, murabbaNo) => {
    const [lat, lon] = latlng;
    const cellX = Math.floor(lat / proximityThreshold);
    const cellY = Math.floor(lon / proximityThreshold);
    const key = `${cellX},${cellY}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push({ murabbaNo, lat, lon });
  });

  murabbaCentroids.forEach((latlng1, murabbaNo1) => {
    const [lat1, lon1] = latlng1;
    const cellX1 = Math.floor(lat1 / proximityThreshold);
    const cellY1 = Math.floor(lon1 / proximityThreshold);
    let nearbyCount = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX1 + dx},${cellY1 + dy}`;
        const cellPoints = grid.get(key);
        if (cellPoints) {
          cellPoints.forEach(pt => {
            if (pt.murabbaNo !== murabbaNo1) {
              const d2 = Math.pow(pt.lat - lat1, 2) + Math.pow(pt.lon - lon1, 2);
              if (d2 < proximityThreshold * proximityThreshold) {
                nearbyCount++;
              }
            }
          });
        }
      }
    }
    spatialDensityMap.set(murabbaNo1, nearbyCount);
  });

  console.log(`?? Tooltip mode: ${isDenseMode ? 'DENSE' : 'NORMAL'} (${murabbaCentroids.size} murabbas, zoom threshold: ${tooltipZoomThreshold})`);

  if (!map.getPane('murabbaTooltipPane')) {
    map.createPane('murabbaTooltipPane');
    const tooltipPane = map.getPane('murabbaTooltipPane');
    tooltipPane.style.zIndex = 640;
  }

  murabbaCentroids.forEach((latlng, murabbaNo) => {
    const nearbyTooltips = spatialDensityMap.get(murabbaNo) || 0;

    let densityClass = '';
    if (nearbyTooltips > 10) {
      densityClass = ' murabba-tooltip--very-dense';
    } else if (nearbyTooltips > 5) {
      densityClass = ' murabba-tooltip--medium-dense';
    }

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
      className: baseClass + densityClass + zoomClass,
      interactive: true,
      opacity: 1.0,
      offset: getMurabbaTooltipOffset(currentZoom, isDenseMode),
      pane: 'murabbaTooltipPane'
    })
      .setLatLng(latlng)
      .setContent(murabbaNo);

    tooltip._murabbaNo = murabbaNo;
    tooltip._latlng = latlng;
    tooltip._densityClass = densityClass;

    murabbaTooltipsRef.current.push(tooltip);
  });

  let updateDebounceTimer = null;

  const updateTooltips = () => {
    if (updateDebounceTimer) {
      clearTimeout(updateDebounceTimer);
    }

    const performUpdate = () => {
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const isZoomOk = zoom >= 15;

      let zoomClass = '';
      if (zoom <= 14) {
        zoomClass = ' murabba-tooltip--zoom-low';
      } else if (zoom === 15) {
        zoomClass = ' murabba-tooltip--zoom-medium';
      } else if (zoom >= 18) {
        zoomClass = ' murabba-tooltip--zoom-high';
      }
      const dynamicOffset = getMurabbaTooltipOffset(zoom, isDenseMode);

      const visibleTooltips = [];
      murabbaTooltipsRef.current.forEach(tooltip => {
        if (isZoomOk && tooltip._latlng && bounds.contains(tooltip._latlng)) {
          visibleTooltips.push(tooltip);
        }
      });

      const showTooltips = isZoomOk && visibleTooltips.length <= 400;

      murabbaTooltipsRef.current.forEach(tooltip => {
        const el = tooltip.getElement();
        const isSelected = el && el.classList.contains('murabba-tooltip--selected-displaced');
        if (!isSelected) {
          tooltip.options.offset = dynamicOffset;
          if (map.hasLayer(tooltip)) {
            tooltip.update();
          }
        }
        const shouldShow = showTooltips && tooltip._latlng && bounds.contains(tooltip._latlng);

        if (shouldShow && !map.hasLayer(tooltip)) {
          tooltip.addTo(map);
          const el = tooltip.getElement();
          if (el && !el.hasAttribute('data-click-handler')) {
            el.setAttribute('data-click-handler', 'true');
            el.addEventListener('click', async (e) => {
              e.stopPropagation();
              map._featureDblClicked = true;
              map._clickTriggeredSelection = Date.now();
              const murabbaNo = tooltip._murabbaNo;
              const murabbaCenter = tooltip._latlng;

              if (onSelect) {
                onSelect(murabbaNo);
              }

              // Load individual murabba mustateel/killa boundaries just like GeoJSON mode
              try {
                await loadMurabbaGeoJSON(murabbaNo, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
              } catch (err) {
                console.warn('Failed to load murabba boundaries on tooltip click:', err);
              }

              // One smooth move; complete PMTiles + highlight after it settles.
              if (murabbaCenter) focusPoint(map, murabbaCenter, { zoom: 17 });
              afterMove(map, () => {
                console.log('🔨 Loading complete PMTiles for murabba:', murabbaNo);
                loadCompletePMTiles(tehsil, mouza, map);
                highlightMurabbaTooltip(murabbaNo);
              });
            });
          }
        }

        if (shouldShow && map.hasLayer(tooltip)) {
          const el = tooltip.getElement();
          if (el) {
            el.classList.remove('murabba-tooltip--zoom-low', 'murabba-tooltip--zoom-medium', 'murabba-tooltip--zoom-high');
            if (zoomClass) {
              el.classList.add(zoomClass.trim());
            }
            if (tooltip._densityClass && !el.classList.contains(tooltip._densityClass.trim())) {
              el.classList.add(tooltip._densityClass.trim());
            }
          }
        } else if (!shouldShow && map.hasLayer(tooltip)) {
          map.removeLayer(tooltip);
        }
      });
    };

    if (debounceDelay > 0) {
      updateDebounceTimer = setTimeout(performUpdate, debounceDelay);
    } else {
      performUpdate();
    }
  };

  updateTooltips();
  map.on('zoomend', updateTooltips);
  map.on('moveend', updateTooltips);

  console.log(`? Created ${murabbaTooltipsRef.current.length} tooltips (visible when <= 400 in viewport)`);

  const tooltipDataToCache = murabbaTooltipsRef.current.map(tooltip => ({
    position: tooltip.getLatLng(),
    content: tooltip.getContent(),
    className: isDenseMode ? 'murabba-tooltip murabba-tooltip--dense clickable-tooltip' : 'murabba-tooltip clickable-tooltip',
    tooltipClassName: isDenseMode ? 'murabba-tooltip murabba-tooltip--dense clickable-tooltip' : 'murabba-tooltip clickable-tooltip',
    html: '',
    iconSize: [0, 0],
    offset: L.point(0, 0),
    murabbaNo: tooltip._murabbaNo
  }));

  mouzaCache.set(cacheKey, {
    tooltips: tooltipDataToCache,
    boundsMap: new Map(murabbaBoundsMapRef.current),
    timestamp: Date.now()
  });

  console.log(`💾 Cached ${tooltipDataToCache.length} tooltips for ${cacheKey}`);
}

export async function applyMurabbaSelection(
  murabbaValue,
  {
    map,
    tehsil,
    mouza,
    murabbaLayerRef,
    mustateelLayers,
    isFallbackMode,
    highlightMurabbaTooltip,
    loadCompletePMTiles,
    pmtilesBoundsRef
  }
) {
  if (!murabbaValue) {
    console.log('No murabba value provided for selection');
    return;
  }

  console.log('Applying programmatic murabba selection for vector tiles:', murabbaValue);

  try {
    await loadMurabbaGeoJSON(murabbaValue, tehsil, mouza, map, mustateelLayers, isFallbackMode, true);
  } catch (err) {
    console.warn('Failed to load detailed GeoJSON for selection:', err);
  }

  const murabbaCentroidsMap = new Map();
  let metadataJson = null;
  try {
    metadataJson = await fetchMurabbaJson(tehsil, mouza);
    if (metadataJson && metadataJson.murabba_centroids) {
      Object.entries(metadataJson.murabba_centroids).forEach(([murabbaNo, coords]) => {
        if (coords && Array.isArray(coords) && coords.length === 2) {
          murabbaCentroidsMap.set(String(murabbaNo), [coords[1], coords[0]]);
        }
      });
    }
  } catch (error) {
    console.warn('Could not load centroids from metadata:', error);
  }

  if (murabbaCentroidsMap.size === 0 && window.scannedMurabbaCentroids) {
    console.log('` + `✅ Loading selection centroids from scanned centroids');
    Object.entries(window.scannedMurabbaCentroids).forEach(([mNo, coords]) => {
      murabbaCentroidsMap.set(String(mNo), coords);
    });
  }

  const centroid = murabbaCentroidsMap.get(String(murabbaValue));

  if (centroid) {
    console.log('📍 Dropdown selection - Loading complete PMTiles');
    loadCompletePMTiles(tehsil, mouza, map);

    if (!wasClickSelection(map)) {
      // Dropdown selection: one smooth, distance-aware move; highlight once settled.
      console.log('🎯 Moving to murabba', murabbaValue, 'centroid:', centroid);
      focusPoint(map, centroid, { zoom: 17, onSettled: () => highlightMurabbaTooltip(murabbaValue) });
    } else {
      console.log('Skipping programmatic zoom because selection was triggered by map click');
      highlightMurabbaTooltip(murabbaValue);
    }

    if (murabbaLayerRef.current) {
      murabbaLayerRef.current.eachLayer((layer) => {
        const layerMurabbaNo = layer.feature?.properties?.Murabba_No;
        if (String(layerMurabbaNo) === String(murabbaValue)) {
          console.log('Firing programmaticSelect for mustateel loading');
          layer.fire('programmaticSelect');
        }
      });
    }
    return;
  } else {
    console.warn('? No centroid found for murabba:', murabbaValue);
  }

  if (!murabbaLayerRef.current) {
    console.warn('⚠️ No murabba interaction layer and no centroid available for murabba:', murabbaValue);
    const isClickTriggered = map._clickTriggeredSelection && (Date.now() - map._clickTriggeredSelection < 2000);
    // NEVER fall back to overall mouza bounds if a murabba was explicitly selected or click-triggered
    if (pmtilesBoundsRef.current && !isClickTriggered && !murabbaValue) {
      console.log('📍 Falling back to overall PMTiles bounds');
      map.flyToBounds(pmtilesBoundsRef.current, {
        duration: 1.5,
        easeLinearity: 0.25,
        padding: [20, 20],
        maxZoom: 16
      });
    }
    return;
  }

  let foundLayer = false;
  let totalLayers = 0;

  murabbaLayerRef.current.eachLayer((layer) => {
    totalLayers++;
    const layerMurabbaNo = layer.feature?.properties?.Murabba_No;

    if (String(layerMurabbaNo) === String(murabbaValue)) {
      console.log('? Using GeoJSON interaction layer bounds');
      foundLayer = true;

      layer.fire('programmaticSelect');

      try {
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
          if (wasClickSelection(map)) {
            // The click already moved the camera; a second move here caused the jerk.
            highlightMurabbaTooltip(murabbaValue);
          } else {
            console.log('? Framing murabba bounds:', murabbaValue);
            focusBounds(map, bounds, { padding: [30, 30], maxZoom: 18, onSettled: () => highlightMurabbaTooltip(murabbaValue) });
          }
        } else {
          console.warn('Murabba bounds are invalid');
        }
      } catch (err) {
        console.warn('Error zooming to murabba bounds:', err);
      }
    }
  });
}
