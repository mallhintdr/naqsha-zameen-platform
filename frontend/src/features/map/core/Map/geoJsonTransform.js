import * as turf from "@turf/turf";
import L from "leaflet";
import MustateelGeojson from "./MustateelGeojson";
import { bindKillaTooltip } from "./bindTooltips";
import { focusBounds } from "../utils/murabbaCamera";
import { vectorFetch } from '@/shared/lib/vectorFetch';

export const transformGeoJsonWithTurf = (geojsonData, topLeft, topRight, bottomRight, bottomLeft) => {
  const matrixSize = 5;
  const width = turf.distance(turf.point(topLeft), turf.point(topRight), { units: "meters" });
  const height = turf.distance(turf.point(topLeft), turf.point(bottomLeft), { units: "meters" });
  const cellWidth = width / matrixSize;
  const cellHeight = height / matrixSize;
  const bearingTop = turf.bearing(turf.point(topLeft), turf.point(topRight));
  const bearingLeft = turf.bearing(turf.point(topLeft), turf.point(bottomLeft));

  geojsonData.features.forEach((feature, index) => {
    const col = index % matrixSize;
    const row = Math.floor(index / matrixSize);
    const cellOrigin = turf.destination(
      turf.destination(turf.point(topLeft), col * cellWidth, bearingTop, { units: "meters" }),
      row * cellHeight,
      bearingLeft,
      { units: "meters" }
    );

    const cellTopLeft = cellOrigin;
    const cellTopRight = turf.destination(cellTopLeft, cellWidth, bearingTop, { units: "meters" });
    const cellBottomLeft = turf.destination(cellTopLeft, cellHeight, bearingLeft, { units: "meters" });
    const cellBottomRight = turf.destination(cellTopRight, cellHeight, bearingLeft, { units: "meters" });

    const newCoords = [
      [cellTopLeft.geometry.coordinates, cellTopRight.geometry.coordinates, cellBottomRight.geometry.coordinates, cellBottomLeft.geometry.coordinates, cellTopLeft.geometry.coordinates]
    ];

    feature.geometry.coordinates = newCoords;
  });

  return geojsonData;
};

export const handleMurabbaClick = async (
  murabbaFeature,
  map,
  mustateelLayers,
  murabbaBaseUrl,
  animateToBounds
) => {
  // Add defensive guard at function entry
  if (!mustateelLayers || !mustateelLayers.current) {
    console.warn('mustateelLayers ref is undefined or not initialized');
    return;
  }

  // Ensure mustateelLayers.current is an array
  if (!Array.isArray(mustateelLayers.current)) {
    console.warn('mustateelLayers.current is not an array, initializing to []');
    mustateelLayers.current = [];
  }

  const murabbaNo = murabbaFeature.properties?.Murabba_No;
  const goToBounds = (bounds, options = {}) => {
    if (!bounds || !bounds.isValid()) return 0;
    if (typeof animateToBounds === 'function') {
      const result = animateToBounds(bounds, options);
      if (typeof result === 'number' && Number.isFinite(result)) {
        return result;
      }
    } else {
      focusBounds(map, bounds, { padding: options.padding || [30, 30], maxZoom: options.maxZoom || 18 });
    }
    return 0;
  };

  // Killa-bandi plot (a killa used as the murabba): nothing to sub-divide, and the
  // 25-killa template grid would be wrong. Just zoom to the plot itself.
  if (murabbaFeature.properties?._killaBandi) {
    goToBounds(L.geoJSON(murabbaFeature).getBounds(), { padding: [40, 40], maxZoom: 19 });
    return;
  }

  // Avoid loading the same murabba multiple times
  if (murabbaNo != null) {
    const existing = mustateelLayers.current.find((layer) => layer.murabbaNo === murabbaNo);
    if (existing) {
      // If already loaded, simply zoom to it
      goToBounds(existing.getBounds());
      return;
    }
  }

  if (murabbaBaseUrl && murabbaNo != null) {
    // Some murabba numbers contain "/" which cannot appear in file names.
    // Replace all slashes with dashes so the URL matches the stored
    // "<murabba>.geojson" naming convention.
    const sanitizedMurabba = String(murabbaNo).replace(/\//g, "-");

    // Properly encode the base URL and murabba number
    // murabbaBaseUrl format: /JSON Murabba/<Tehsil>/<Mouza>/
    // Split by / and encode each segment
    const pathParts = murabbaBaseUrl.split('/').filter(p => p);
    const encodedPath = pathParts.map(part => encodeURIComponent(part)).join('/');
    const murabbaUrl = `/${encodedPath}/${encodeURIComponent(sanitizedMurabba)}.geojson?t=${Date.now()}`;

    console.log('🔍 Fetching murabba GeoJSON:', murabbaUrl);
    try {
      const res = await vectorFetch(murabbaUrl, { cache: 'no-store', credentials: 'include' });
      if (res.ok) {
        const murabbaGeo = await res.json();
        console.log('✅ Murabba GeoJSON loaded successfully:', {
          murabbaNo,
          featureCount: murabbaGeo.features?.length || 0,
          url: murabbaUrl
        });

        // Create a dedicated pane for murabba layers with high z-index
        if (!map.getPane('murabbaPane')) {
          map.createPane('murabbaPane');
          map.getPane('murabbaPane').style.zIndex = 700; // Well above complete PMTiles (620)
          map.getPane('murabbaPane').style.pointerEvents = 'auto';
        }

        const layer = L.geoJSON(murabbaGeo, {
          pane: 'murabbaPane', // Use dedicated pane
          style: {
            color: "#FFFF00", // Bright Yellow
            weight: 1.5, // Half the width of mouza-level murabba (3 / 2 = 1.5)
            fillOpacity: 0.001, // Clickable invisible fill
            fillColor: "#FFFF00",
            fill: true,
            opacity: 1,
            dashArray: '5, 5' // Dotted line style
          },
          onEachFeature: (feature, l) => {
            bindKillaTooltip(feature, l, map);
          },
        });

        console.log('🎨 Created Leaflet layer with', layer.getLayers().length, 'sub-layers for murabba:', murabbaNo);

        const addLayer = () => {
          console.log('🟡 Adding murabba layer to map:', murabbaNo);
          layer.addTo(map);
          layer.murabbaNo = murabbaNo;

          // Force higher z-index to ensure visibility over vector tiles
          if (layer.setZIndex) {
            layer.setZIndex(1000);
          }

          // Bring to front multiple times to ensure visibility
          setTimeout(() => {
            layer.bringToFront();
            console.log('🔝 Brought murabba layer to front:', murabbaNo);
          }, 100);

          setTimeout(() => {
            layer.bringToFront();
            console.log('🔝 Second bring to front for murabba layer:', murabbaNo);

            // Debug layer visibility
            const isOnMap = map.hasLayer(layer);
            const paneZIndex = map.getPane('murabbaPane').style.zIndex;
            console.log('🔍 Layer visibility check:', {
              murabbaNo,
              isOnMap,
              paneZIndex,
              layerCount: layer.getLayers().length
            });

            // Force redraw
            map.invalidateSize(false);
          }, 500);

          mustateelLayers.current.push(layer);
          console.log('✅ Murabba layer added successfully with', layer.getLayers().length, 'features:', murabbaNo);
        };

        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
          console.log('🎯 Murabba has valid bounds, animating to bounds:', murabbaNo);
          let fallbackTimer = null;
          const handleMoveEnd = () => {
            console.log('🏁 Map moveend event fired, adding murabba layer:', murabbaNo);
            map.off('moveend', handleMoveEnd);
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            addLayer();
          };
          map.once('moveend', handleMoveEnd);

          const travelSeconds = goToBounds(bounds, {
            animate: true,
            duration: 1.2,
            easeLinearity: 0.5,
            padding: [30, 30],
            maxZoom: 18
          }) ?? 0;
          const fallbackDelay =
            travelSeconds > 0
              ? Math.ceil(travelSeconds * 1000 + 500)
              : 600;

          console.log('⏱️ Setting fallback timer for', fallbackDelay, 'ms for murabba:', murabbaNo);
          if (fallbackDelay > 0) {
            fallbackTimer = setTimeout(() => {
              console.log('⏰ Fallback timer fired, adding murabba layer:', murabbaNo);
              handleMoveEnd();
            }, fallbackDelay);
          }
        } else {
          console.log('⚠️ Murabba has invalid bounds, adding immediately:', murabbaNo);
          addLayer();
        }
        return;
      } else {
        console.warn('❌ Failed to fetch murabba GeoJSON:', res.status, murabbaUrl);
        console.log('⚠️ Falling back to template grid transformation for murabba:', murabbaNo);
      }
    } catch (err) {
      console.warn("❌ Murabba file fetch failed:", err.message, 'URL:', murabbaUrl);
      console.log('⚠️ Falling back to template grid transformation for murabba:', murabbaNo);
    }
  }

  console.log('🔧 Using template grid transformation for murabba:', murabbaNo);
  const murabbaCoordinates = murabbaFeature.geometry.coordinates[0];
  const topLeft = murabbaCoordinates[0];
  const topRight = murabbaCoordinates[1];
  const bottomRight = murabbaCoordinates[2];
  const bottomLeft = murabbaCoordinates[3];

  const transformedGeojson = transformGeoJsonWithTurf(
    { ...MustateelGeojson },
    topLeft,
    topRight,
    bottomRight,
    bottomLeft
  );

  // Ensure murabbaPane exists so the template killa SVG renders above the complete
  // PMTiles canvas layer (z-index ~620) and click events reach the polygons.
  if (!map.getPane('murabbaPane')) {
    map.createPane('murabbaPane');
    map.getPane('murabbaPane').style.zIndex = 700;
    map.getPane('murabbaPane').style.pointerEvents = 'auto';
  }

  const mustateelLayer = L.geoJSON(transformedGeojson, {
    pane: 'murabbaPane',
    style: { color: "#FFFF00", weight: 2, fillOpacity: 0.001, fillColor: "#FFFF00", fill: true, dashArray: '5, 5' },
    onEachFeature: (feature, layer) => {
      bindKillaTooltip(feature, layer, map);
    },
  });

  const addTemplateLayer = () => {
    mustateelLayer.addTo(map);
    mustateelLayer.murabbaNo = murabbaNo;
    mustateelLayers.current.push(mustateelLayer);
  };

  const templateBounds = mustateelLayer.getBounds();
  if (templateBounds && templateBounds.isValid()) {
    let fallbackTimer = null;
    const handleMoveEnd = () => {
      map.off('moveend', handleMoveEnd);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      addTemplateLayer();
    };
    map.once('moveend', handleMoveEnd);

    const travelSeconds = goToBounds(templateBounds, {
      animate: true,
      duration: 1.2,
      easeLinearity: 0.5,
      padding: [30, 30],
      maxZoom: 18
    }) ?? 0;
    const fallbackDelay =
      travelSeconds > 0
        ? Math.ceil(travelSeconds * 1000 + 500)
        : 600;

    if (fallbackDelay > 0) {
      fallbackTimer = setTimeout(() => {
        handleMoveEnd();
      }, fallbackDelay);
    }
  } else {
    addTemplateLayer();
  }
};



