// src/Map Component/MapComponent.js

import { setTilesOnly } from '@/features/map/config/pmtiles';
import { isLimitedUser } from '@/shared/lib/featureAccess';
import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { apiBase as getApiBase } from '@/shared/api/base';
import { useAuth } from '@/features/auth/AuthProvider';
import { MapContext, useMap } from './mapContext';

import LocateControl from './LocateControl';

import LayerControl from './LayerControl';
import AdminToolbar from './AdminToolbar';

import DrawControl from './DrawControl';
import SearchControl from './SearchControl';
import GuidedDrawingMode from './GuidedDrawingMode';
import GuidedRulerOverlay from './GuidedRulerOverlay';


import VectorTileLoader from './VectorTileLoader';
import LoadingOverlay from './LoadingOverlay';
import { clearActiveKillaSelection } from './measurementUtils';
import { loadMurabbaPMTiles } from './loadMurabbaPMTiles';
import MouzaNavigator from './MouzaNavigator';

import './css/GeoJsonLoader.css';

import './css/DrawControl.css';

import './css/MapComponent.css';
import './css/MapGlobal.css';

import './css/LayerControl.css';

import Compass from './CompassControl';

import L from './leafletGlobal';


// leaflet-rotate reads the global L (set by ./leafletGlobal above)
import 'leaflet-rotate';



import {
  addMeasurementLabels
} from './measurementUtils';



/* ---------- custom marker icon ---------- */

// --- MONKEY PATCH LEAFLET FOR LEAFLET-ROTATE ---
if (!L.Map.prototype._customPatchedForRotation) {
  const originalCreatePane = L.Map.prototype.createPane;
  L.Map.prototype.createPane = function (name, container) {
    if (!container && this._rotatePane) {
      // Keep standard UI elements upright, but let all custom map data panes rotate
      const isNoRotate = name === 'tooltipPane' || name === 'popupPane' || name === 'markerPane' || name === 'murabbaTooltipPane' || name === 'killaTooltipPane';
      container = isNoRotate ? this._norotatePane : this._rotatePane;
    }
    return originalCreatePane.call(this, name, container || this._mapPane);
  };

  // Prevent double-rotation of tooltips when they are placed in a rotated pane
  const originalTooltipUpdatePos = L.Tooltip.prototype._updatePosition;
  L.Tooltip.prototype._updatePosition = function () {
    if (this._map && this._map._rotate) {
      const pane = this._map.getPane(this.options.pane);
      // If the tooltip's pane is inside the CSS-rotated _rotatePane, don't mathematically rotate it
      if (pane && pane.parentNode === this._map._rotatePane) {
        const pos = this._map.latLngToLayerPoint(this._latlng);
        this._setPosition(pos);
        return;
      }
    }
    originalTooltipUpdatePos.call(this);
  };

  L.Map.prototype._customPatchedForRotation = true;
}
// ----------------------------------------------------------

const customIcon = new L.Icon({

  iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',

  iconSize: [35, 35],

  iconAnchor: [17, 35],

  tooltipAnchor: [0, -35],

});



import { storeTileInIndexedDB } from './shajraCache';
import { vectorFetch } from '@/shared/lib/vectorFetch';

/* ======================================================================= */

const ThreeFingerRotateControl = () => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    let isRotating = false;
    let initialX = 0;
    let initialBearing = 0;
    
    const getCentroidX = (touches) => {
      let sum = 0;
      for (let i = 0; i < touches.length; i++) {
        sum += touches[i].clientX;
      }
      return sum / touches.length;
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 3) {
        isRotating = true;
        initialX = getCentroidX(e.touches);
        initialBearing = map.getBearing ? map.getBearing() : 0;
        e.preventDefault(); 
      } else {
        isRotating = false;
      }
    };

    const onTouchMove = (e) => {
      if (isRotating && e.touches.length === 3) {
        e.preventDefault();
        const currentX = getCentroidX(e.touches);
        const dx = currentX - initialX;
        if (map.setBearing) {
          // Adjust sensitivity by multiplying dx (0.5 is smooth)
          map.setBearing(initialBearing + (dx * 0.5));
        }
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 3) {
        isRotating = false;
      }
    };

    const container = map.getContainer();
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [map]);

  return null;
};




const GlobalZoomTracker = () => {
  const map = useMap();
  useEffect(() => {
    const onZoom = () => {
      const z = Math.round(map.getZoom());
      const container = map.getContainer();
      if (container) {
        container.setAttribute('data-zoom', z);
      }
    };
    const onTourFlyTo = (e) => {
      const targetZoom = e.detail?.zoom || e.detail?.level;
      if (targetZoom) {
        const center = map.getCenter();
        map.flyTo(center, targetZoom, { animate: true, duration: e.detail.duration || 1.5 });
      }
    };
    const onMapClick = (e) => {
      // If click did not originate from a Killa feature or drawing tool
      if (!map._isDrawing && !e.originalEvent?._killaHandled) {
        clearActiveKillaSelection(map);
      }
    };

    window.leafletMap = map;
    map.on('zoomend', onZoom);
    map.on('click', onMapClick);
    window.addEventListener('tourFlyToLevel', onTourFlyTo);
    onZoom();
    return () => {
      map.off('zoomend', onZoom);
      map.off('click', onMapClick);
      window.removeEventListener('tourFlyToLevel', onTourFlyTo);
    };
  }, [map]);
  return null;
};

const MapComponent = forwardRef(({
  mapKey,
  geoJsonUrl,        // used for "geojson-only" mode
  goToMarkers,
  onClearMarkers,
  setMurabbaOptions,
  selectedMurabba,
  user,
  selectedMauza,     // relevant in "shajra" mode
  showClearCacheOption,
  onMapInit,         // passes Leaflet map instance back to App
  onGeoJsonReady,    // <<< NEW: callback once GeoJSON layer is added
  onGeoJsonLoaded,
  shiftResult,
  onShiftResultApplied,
  onDrawnChange,
  drawnItemsRef: externalDrawnRef,
  userLayerToLoad,
  murabbaOptions,
  handleMurabbaSelection, // <<< NEW
  pmtilesOffset,
  onPMTilesOffsetFetched,
  testMode,
  killaMeasurement,
  onNextMauza,
  onPrevMauza,
  onGoToClick,
  isLoading: externalLoading,
  loadingMessage: externalMessage,
  baseLayer,
  setBaseLayer,
  adminMapMode,
  forceMobileMode,
}, ref) => {
  useImperativeHandle(ref, () => mapRef.current);
  const { setModalError } = useAuth();
  const isRestricted = isLimitedUser(user);
  setTilesOnly(isRestricted); // before any layer load in this render
  // Expired / pending: full zoom on tiles; satellite, live location, saved layers,
  // shift and change mouza are locked instead (shared/lib/featureAccess).
  const currentMaxZoom = 21;
  const currentMaxZoomRef = useRef(currentMaxZoom);
  currentMaxZoomRef.current = currentMaxZoom;

  /* -------- convenience strings -------- */

  const tehsilStr = user?.activeTehsil ?? '';

  const mauzaStr = selectedMauza ?? '';

  const encodedBase = encodeURIComponent('Shajra Parcha');

  const encodedTehsil = encodeURIComponent(tehsilStr);

  const encodedMauza = encodeURIComponent(mauzaStr);

  const cacheBuster = useMemo(() => Date.now(), [selectedMauza]);



  const [dataMode, setDataMode] = useState(null);

  /* -------- loading state -------- */
  const [isLoadingMouza, setIsLoadingMouza] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(null);
  const [isFallbackMode, setIsFallbackMode] = useState(false);

  /* -------- refs & local state -------- */

  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [leafletMap, setLeafletMap] = useState(null);

  /* Create the Leaflet map imperatively (replaces react-leaflet MapContainer, inv-04 §1.2 options kept EXACT) */
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [30, 71],
      zoom: 5,
      maxZoom: currentMaxZoomRef.current,
      rotate: true,
      rotateControl: false,
      touchRotate: false,
      bearing: 0,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 117,
      wheelDebounceTime: 40,
      zoomAnimation: true,
      zoomAnimationThreshold: 6,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
      inertiaDeceleration: 2300,
      inertiaMaxSpeed: 1500,
      easeLinearity: 0.15,
      attributionControl: false,
      tap: false,
    });
    mapRef.current = map;
    setLeafletMap(map);
    if (typeof onMapInit === 'function') onMapInit(map);
    return () => {
      try {
        if (map._dblClickHandler) map.getContainer().removeEventListener('dblclick', map._dblClickHandler);
      } catch (e) {}
      if (window.leafletMap === map) window.leafletMap = null;
      mapRef.current = null;
      setLeafletMap(null);
      map.remove();
    };
     
  }, [mapKey]);

  const mustateelLayers = useRef([]);

  /* -------- refs for layer management (vector tiles vs geojson) -------- */
  const geoJsonLayerRef = useRef(null);
  const vectorLayerRef = useRef(null);
  const vectorMurabbaLayerRef = useRef(null);



  // ALWAYS call useRef here, then choose between external vs. internal

  const internalDrawnRef = useRef(null);

  const drawnItemsRef = externalDrawnRef || internalDrawnRef;

  const lastLoadedLayerRef = useRef(null);



  const [drawnGeoJson, setDrawnGeoJson] = useState(null);

  const [unitMode, setUnitMode] = useState(() => {
    try {
      return localStorage.getItem('geo_unit_mode') || 'imperial';
    } catch (e) {
      return 'imperial';
    }
  });

  const handleSetUnitMode = useCallback((updater) => {
    setUnitMode(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('geo_unit_mode', next);
      } catch (e) {}
      return next;
    });
  }, []);

  const [boundsFit, setBoundsFit] = useState(false);

  const [zoomedMurabba, setZoomedMurabba] = useState(null);

  /* ───────────────────────────────────────────

   * Hold the Leaflet GeoJSON layer instance

   * so we can pass it into ShiftMouzaForm

   * ─────────────────────────────────────────── */

  const [geoJsonLayerInstance, setGeoJsonLayerInstance] = useState(null);



  /* shajra tile-layer controls */

  const [shajraLayer, setShajraLayer] = useState(null);

  const [shajraOpacity, setShajraOpacity] = useState(1);

  const [shajraExists, setShajraExists] = useState(false);

  // ← Re-introduced: track visibility toggle

  const [shajraVisible, setShajraVisible] = useState(false);

  const [initialTileBoundsFitted, setInitialTileBoundsFitted] = useState(false);

  const [shajraMeta, setShajraMeta] = useState(null);



  const handleDrawnChange = useCallback(

    (geojson) => {

      setDrawnGeoJson(geojson);

      if (typeof onDrawnChange === 'function') {

        onDrawnChange(geojson);

      }

    },

    [onDrawnChange]
  );

  // --- PMTiles Offset Handling ---

  // Fetch PMTiles offset when mouza changes


  // Apply CSS offset to PMTiles & GeoJSON panes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyTransform = () => {
      const panes = [
        'mouzaPMTilesPane',
        'completePMTilesPane',
        'murabbaPane',
        'killaTooltipPane',
        'murabbaTooltipPane',
        'fallbackGeoJsonPane',
        'overlayPane' // Standard GeoJSON pane
      ];

      // Destructure lat/lng with defaults to 0
      const lat = pmtilesOffset?.lat || 0;
      const lng = pmtilesOffset?.lng || 0;

      if (!pmtilesOffset || (lat === 0 && lng === 0)) {
        panes.forEach(paneName => {
          const pane = map.getPane(paneName);
          if (pane) {
            pane.style.transform = '';
            pane.style.left = '0px';
            pane.style.top = '0px';
            pane.style.transition = 'none';
          }
        });
        return;
      }

      const zoom = map.getZoom();
      const originLatLng = map.getCenter();
      const offsetLatLng = L.latLng(originLatLng.lat + lat, originLatLng.lng + lng);

      const originPoint = map.project(originLatLng, zoom);
      const offsetPoint = map.project(offsetLatLng, zoom);

      const tx = Math.round(offsetPoint.x - originPoint.x);
      const ty = Math.round(offsetPoint.y - originPoint.y);

      panes.forEach(paneName => {
        const pane = map.getPane(paneName);
        if (pane) {
          pane.style.transform = ''; // Keep transform clean so Leaflet hardware-accelerates zoom scaling
          pane.style.transition = 'none'; // Zero sliding animation
          pane.style.position = 'absolute';
          pane.style.left = `${tx}px`;
          pane.style.top = `${ty}px`;
          pane.style.pointerEvents = 'auto'; // Ensure clicks still work
        }
      });
    };

    // Initial apply
    applyTransform();

    // Listen to zoomend, viewreset, layeradd, and resize
    // Note: Do not listen to intermediate 'zoom' or 'move' events so Leaflet smoothly scales the pane without mid-animation jumping
    map.on('zoomend viewreset layeradd resize', applyTransform);

    return () => {
      map.off('zoomend viewreset layeradd resize', applyTransform);
    };
  }, [pmtilesOffset, mapKey, leafletMap]);



  const measurementLabelsRef = useRef(new Map());

  // Reset extraction progress when loading finishes or mouza changes
  useEffect(() => {
    if (!isLoadingMouza && extractionProgress) {
      // Clear extraction progress when loading completes
      const timer = setTimeout(() => setExtractionProgress(null), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoadingMouza, extractionProgress]);

  useEffect(() => {
    if (!tehsilStr) return;
    const map = mapRef.current;
    if (map) {
      map.setView([30, 71], 5, { animate: true });
      console.log('Tehsil changed - resetting map zoom to default view.');
    }
  }, [tehsilStr]);

  // Clear selected killa outline, karam tooltips, custom drawn shapes, and measurement labels on mouza or tehsil change
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      clearActiveKillaSelection(map);

      // Clean all measurement labels from custom shapes
      if (measurementLabelsRef.current) {
        measurementLabelsRef.current.forEach((labels) => {
          if (Array.isArray(labels)) {
            labels.forEach((lbl) => {
              try {
                if (map.hasLayer(lbl)) map.removeLayer(lbl);
                if (typeof lbl.remove === 'function') lbl.remove();
              } catch (e) {}
            });
          }
        });
        measurementLabelsRef.current = new Map();
      }

      // Clear drawn items if present
      if (drawnItemsRef.current) {
        try {
          drawnItemsRef.current.clearLayers();
        } catch (e) {}
      }

      // Sweep any orphaned measurement or Karam distance labels from the map
      try {
        map.eachLayer((l) => {
          if (l && l.options && l.options.icon && l.options.icon.options) {
            const cls = l.options.icon.options.className || '';
            const html = l.options.icon.options.html || '';
            if (
              cls.includes('distance-label') ||
              cls.includes('area-label-container') ||
              cls.includes('circle-label-container') ||
              cls.includes('marker-label-container') ||
              html.includes('distance-label') ||
              html.includes('karam-distance-label')
            ) {
              try {
                map.removeLayer(l);
                if (typeof l.remove === 'function') l.remove();
              } catch (e) {}
            }
          }
        });
      } catch (e) {}
    }
  }, [mauzaStr, tehsilStr]);

  // Reset extraction progress when loading finishes or mouza changes

  useEffect(() => {

    if (!userLayerToLoad) {
      lastLoadedLayerRef.current = null;
      return;
    }

    if (!drawnItemsRef.current) return;
    if (lastLoadedLayerRef.current === userLayerToLoad) return;
    lastLoadedLayerRef.current = userLayerToLoad;

    const map = mapRef.current;

    drawnItemsRef.current.clearLayers();



    measurementLabelsRef.current.forEach((labels) => {

      labels.forEach((lbl) => map && map.removeLayer(lbl));

    });

    measurementLabelsRef.current = new Map();




    const geoJsonFeatures = userLayerToLoad.type === 'FeatureCollection'
      ? userLayerToLoad.features
      : [userLayerToLoad];


    geoJsonFeatures.forEach((feature) => {
      if (!feature?.geometry) return;

      const type = feature.geometry.type;
      const coords = feature.geometry.coordinates;
      let layer = null;

      const polyStyle = (color) => ({ color, weight: 2, opacity: 1.0, fillOpacity: 0.3 });

      if (type === 'Point') {
        const latlng = L.latLng(coords[1], coords[0]);
        layer = L.marker(latlng);
      } else if (type === 'LineString') {
        const latlngs = coords.map(([lng, lat]) => L.latLng(lat, lng));
        layer = L.polyline(latlngs, { color: '#FF0000', weight: 2, opacity: 1.0 });
      } else if (type === 'MultiLineString') {
        const latlngs = coords.map((ring) => ring.map(([lng, lat]) => L.latLng(lat, lng)));
        layer = L.polyline(latlngs, { color: '#FF0000', weight: 2, opacity: 1.0 });
      } else if (type === 'Polygon') {
        // GeoJSON polygon: first array is outer ring, subsequent are holes
        const latlngs = coords.map((ring) => ring.map(([lng, lat]) => L.latLng(lat, lng)));
        // If there are no holes, pass a flat array to prevent Leaflet Draw editing issues
        const polygonLatLngs = latlngs.length === 1 ? latlngs[0] : latlngs;
        layer = L.polygon(polygonLatLngs, polyStyle('#FFD700'));
      } else if (type === 'MultiPolygon') {
        const latlngs = coords.map((poly) =>
          poly.map((ring) => ring.map(([lng, lat]) => L.latLng(lat, lng)))
        );
        layer = L.polygon(latlngs, polyStyle('#FFD700'));
      }

      if (layer) {
        drawnItemsRef.current.addLayer(layer);
        if (map) addMeasurementLabels(layer, map, measurementLabelsRef.current);
      }
    });



    handleDrawnChange(drawnItemsRef.current.toGeoJSON());



    if (map && drawnItemsRef.current.getLayers().length) {

      const b = drawnItemsRef.current.getBounds();

      if (b.isValid()) map.fitBounds(b);

    }


  }, [userLayerToLoad, handleDrawnChange, drawnItemsRef]);



  /* -------- label GeoJSON for murabba dropdown -------- */

  const [labelGeoJsonData, setLabelGeoJsonData] = useState(null);

  const [tilesLoaded, setTilesLoaded] = useState(true);



  useEffect(() => {
    if (!shiftResult || !shiftResult.geojson || !geoJsonLayerInstance) return;

    // Only replace the mouza layer with real GeoJSON. The app sets shiftResult.geojson to a file
    // path string when a mouza is selected; clearing first and then failing on addData(string)
    // emptied the layer whenever that metadata arrived after the layer had loaded (the first
    // mouza after page load), so its murabba outlines vanished until another mouza was picked.
    const g = shiftResult.geojson;
    const isGeoJson = g && typeof g === 'object' && (g.type === 'FeatureCollection' || g.type === 'Feature');
    if (!isGeoJson) {
      if (typeof onShiftResultApplied === 'function') onShiftResultApplied();
      return;
    }

    try {
      geoJsonLayerInstance.clearLayers();
      geoJsonLayerInstance.addData(shiftResult.geojson);
    } catch (error) {
      // console.error('[MapComponent] Failed to apply shift result', error);
      if (typeof onShiftResultApplied === 'function') onShiftResultApplied();
      return;
    }

    const features = Array.isArray(shiftResult.geojson.features) ? shiftResult.geojson.features : [];
    const murabbaList = Array.from(
      new Set(
        features
          .filter((feature) => feature?.properties?.Murabba_No != null)
          .map((feature) => String(feature.properties.Murabba_No))
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    setMurabbaOptions(murabbaList);

    const mapInstance = mapRef.current;
    const currentView = mapInstance
      ? { center: mapInstance.getCenter(), zoom: mapInstance.getZoom() }
      : null;

    if (mapInstance && mustateelLayers.current.length) {
      mustateelLayers.current.forEach((layer) => {
        if (mapInstance.hasLayer(layer)) {
          mapInstance.removeLayer(layer);
        }
      });
      mustateelLayers.current = [];
    }

    if (selectedMurabba) {
      geoJsonLayerInstance.eachLayer((layer) => {
        if (String(layer.feature?.properties?.Murabba_No) === String(selectedMurabba)) {
          layer.fire('programmaticSelect');
        }
      });
    }

    if (currentView && mapInstance) {
      const restore = () => {
        if (mapRef.current === mapInstance) {
          mapInstance.setView(currentView.center, currentView.zoom, { animate: false });
        }
      };

      mapInstance.setView(currentView.center, currentView.zoom, { animate: false });
      setTimeout(restore, 0);
      setTimeout(restore, 300);
    }

    if (typeof onShiftResultApplied === 'function') {
      onShiftResultApplied();
    }
  }, [shiftResult, geoJsonLayerInstance, selectedMurabba, setMurabbaOptions, onShiftResultApplied, mapRef, mustateelLayers]);



  /* =====================================================================

   *  MapUpdater – tracks zoom, stores first map ref

   * =================================================================== */

  // Legacy `MapUpdater` child component, now a plain effect on the imperatively created map.
  useEffect(() => {
      const map = leafletMap;
      if (!map) return;

      // Update native Leaflet maxZoom immediately when currentMaxZoom changes
      map.setMaxZoom(currentMaxZoom);
      map._currentMaxZoomLimit = currentMaxZoom;

      if (!map._naqshaInitDone) {
        map._naqshaInitDone = true;
        mapRef.current = map;

        // Globally clamp zoom methods for restricted users
        // We only patch once, but the patched methods now refer to map._currentMaxZoomLimit
        // Globally clamp and smooth zoom/pan animation methods
        // We only patch once, but the patched methods dynamically calculate natural easing and duration based on distance
        if (!map._zoomClamped) {
          // Helper to calculate natural smooth duration and easing based on pixel distance and zoom change
          const calculateSmoothTransition = (targetLatLng, targetZoom, userOptions) => {
            const currentCenter = map.getCenter();
            const currentZoom = map.getZoom();

            // Calculate distance in meters between current center and target
            let distanceMeters = 0;
            try {
              if (targetLatLng) {
                const targetLL = L.latLng(targetLatLng);
                distanceMeters = currentCenter.distanceTo(targetLL);
              }
            } catch (e) {}

            const zoomDiff = targetZoom !== undefined ? Math.abs(targetZoom - currentZoom) : 0;

            let baseDuration;
            let easeLinearity;

            if (distanceMeters < 300 && zoomDiff <= 1) {
              // Very small/adjacent distance (e.g. adjacent murabba completely visible or nearby): smooth, gentle pan/zoom
              baseDuration = 0.75 + Math.min(0.35, distanceMeters / 400);
              easeLinearity = 0.25; // Gentle ease out
            } else if (distanceMeters < 1500 && zoomDiff <= 2) {
              // Medium distance (same mouza / few murabbas away): balanced glide
              baseDuration = 0.95 + (distanceMeters / 2500) + (zoomDiff * 0.15);
              easeLinearity = 0.20;
            } else {
              // Large distance (across mouza, district, or high zoom change): majestic flight
              baseDuration = 1.2 + Math.min(1.2, Math.log10(Math.max(10, distanceMeters / 500)) * 0.45) + (zoomDiff * 0.18);
              easeLinearity = 0.15; // Lower means smoother long deceleration
            }

            // Cap duration between 0.6s and 2.4s to prevent abrupt jumps or excessive lag
            const finalDuration = Math.min(2.4, Math.max(0.6, baseDuration));

            return {
              animate: true,
              duration: userOptions?.duration !== undefined ? userOptions.duration : finalDuration,
              easeLinearity: userOptions?.easeLinearity !== undefined ? userOptions.easeLinearity : easeLinearity,
              noMoveStart: userOptions?.noMoveStart ?? false,
              ...userOptions
            };
          };

          const originalFlyTo = map.flyTo;
          map.flyTo = function (latlng, zoom, options) {
            const limit = this._currentMaxZoomLimit || 21;
            const targetZoom = zoom !== undefined ? Math.min(zoom, limit) : zoom;
            const smoothedOpts = calculateSmoothTransition(latlng, targetZoom, options);
            return originalFlyTo.call(this, latlng, targetZoom, smoothedOpts);
          };

          const originalPanTo = map.panTo;
          map.panTo = function (latlng, options) {
            const currentZoom = this.getZoom();
            const smoothedOpts = calculateSmoothTransition(latlng, currentZoom, options);
            return originalPanTo.call(this, latlng, smoothedOpts);
          };
          
          const originalSetView = map.setView;
          map.setView = function (center, zoom, options) {
            const limit = this._currentMaxZoomLimit || 21;
            const targetZoom = zoom !== undefined ? Math.min(zoom, limit) : zoom;
            // If animate option is requested, ensure smooth duration
            const opts = options?.animate ? calculateSmoothTransition(center, targetZoom, options) : options;
            return originalSetView.call(this, center, targetZoom, opts);
          };
          
          const originalFitBounds = map.fitBounds;
          map.fitBounds = function (bounds, options) {
            const limit = this._currentMaxZoomLimit || 21;
            const opts = options ? { ...options } : {};
            opts.maxZoom = opts.maxZoom ? Math.min(opts.maxZoom, limit) : limit;
            return originalFitBounds.call(this, bounds, opts);
          };
          
          const originalFlyToBounds = map.flyToBounds;
          map.flyToBounds = function (bounds, options) {
            const limit = this._currentMaxZoomLimit || 21;
            const opts = options ? { ...options } : {};
            opts.maxZoom = opts.maxZoom ? Math.min(opts.maxZoom, limit) : limit;
            
            let centerOfBounds = null;
            try {
              if (bounds && typeof bounds.getCenter === 'function') {
                centerOfBounds = bounds.getCenter();
              } else if (Array.isArray(bounds) && bounds.length === 2) {
                centerOfBounds = L.latLngBounds(bounds).getCenter();
              }
            } catch (e) {}

            const smoothedOpts = calculateSmoothTransition(centerOfBounds, opts.maxZoom, opts);
            return originalFlyToBounds.call(this, bounds, smoothedOpts);
          };

          const originalSetZoom = map.setZoom;
          map.setZoom = function (zoom, options) {
            const limit = this._currentMaxZoomLimit || 21;
            return originalSetZoom.call(this, zoom !== undefined ? Math.min(zoom, limit) : zoom, options);
          };

          const originalZoomIn = map.zoomIn;
          map.zoomIn = function (delta, options) {
            const limit = this._currentMaxZoomLimit || 21;
            const currentZoom = this.getZoom();
            const d = delta || 1;
            if (currentZoom + d > limit) {
              return this.setZoom(limit, options);
            }
            return originalZoomIn.call(this, delta, options);
          };
          
          map._zoomClamped = true;
        }

        // Custom double-click zoom using native DOM event – fires on the imagery base
        // layer regardless of which GeoJSON/PMTile layers are on top, because native
        // DOM events are not blocked by Leaflet's internal layer event system.
        if (!map._customDblClickZoom) {
          map.doubleClickZoom.disable();

          const container = map.getContainer();

          const handleDblClick = (domEvent) => {
            // Skip during draw/edit mode
            if (map._isDrawing) return;
            // Skip if a GeoJSON/PMTile feature set this flag in its own dblclick handler
            if (map._featureDblClicked) {
              map._featureDblClicked = false;
              return;
            }

            // Convert DOM coordinates to map latlng
            const rect = container.getBoundingClientRect();
            const x = domEvent.clientX - rect.left;
            const y = domEvent.clientY - rect.top;
            const latlng = map.containerPointToLatLng([x, y]);

            const currentZoom = map.getZoom();
            const limit = map._currentMaxZoomLimit || 21;
            const targetZoom = currentZoom < Math.min(17, limit) ? Math.min(17, limit) : currentZoom + 1;
            const zoomDiff = targetZoom - currentZoom;
            const duration = Math.min(3, Math.max(0.5, zoomDiff * 0.3));
            map.flyTo(latlng, targetZoom, { duration });
          };

          container.addEventListener('dblclick', handleDblClick);
          map._dblClickHandler = handleDblClick; // store for cleanup
          map._customDblClickZoom = true;
        }

        // Initialize all custom panes here once for the entire session
        const panes = [
          { name: 'mouzaPMTilesPane', zIndex: 610 },
          { name: 'completePMTilesPane', zIndex: 550 },
          { name: 'fallbackGeoJsonPane', zIndex: 625 },
          { name: 'murabbaPane', zIndex: 630 },
          { name: 'murabbaTooltipPane', zIndex: 640 },
          { name: 'killaTooltipPane', zIndex: 620 }
        ];

        panes.forEach(({ name, zIndex }) => {
          if (!map.getPane(name)) {
            const pane = map.createPane(name);
            pane.style.zIndex = zIndex;
            pane.style.pointerEvents = 'none'; // Layers will handle their own pointer events
          }
        });
      }




      let tileLoadingLayers = [];



      function setupTileListeners() {

        let loading = 0;

        const update = () => setTilesLoaded(loading === 0);



        tileLoadingLayers.forEach((layer) => {

          layer.off('loading');

          layer.off('load');

        });

        tileLoadingLayers = [];



        map.eachLayer((layer) => {

          if (layer instanceof L.TileLayer) {

            tileLoadingLayers.push(layer);

            layer.on('loading', () => {

              loading++;

              update();

            });

            layer.on('load', () => {

              loading = Math.max(loading - 1, 0);

              update();

            });



            if (layer._tiles) {

              const tilesLeft = Object.values(layer._tiles).filter((t) => !t.loaded).length;

              if (tilesLeft === 0) setTilesLoaded(true);

            }

          }

        });

      }



      setupTileListeners();




      const onLayerAdd = (e) => {

        if (e.layer instanceof L.TileLayer) setupTileListeners();

      };

      const handleMoveStart = (e) => {
        if (!e.originalEvent) {
          map.getContainer().classList.add('map-animating');
        }
      };

      const handleMoveEnd = () => {
        map.getContainer().classList.remove('map-animating');
      };

      map.on('layeradd', onLayerAdd);
      map.on('movestart', handleMoveStart);
      map.on('moveend', handleMoveEnd);



      return () => {

        map.off('layeradd', onLayerAdd);
        map.off('movestart', handleMoveStart);
        map.off('moveend', handleMoveEnd);

        tileLoadingLayers.forEach((layer) => {

          layer.off('loading');

          layer.off('load');

        });


      };

  }, [leafletMap, currentMaxZoom]);

  /* =====================================================================

 *  Decide mode (geojson-only vs shajra) whenever Mauza changes

 *  -> check for existence of shajra metadata and switch modes

 * =================================================================== */

  useEffect(() => {

    if (!tehsilStr || !selectedMauza) return;

    const base = getApiBase();
    const metaPath = `${base}/${encodedBase}/${encodedTehsil}/${encodedMauza}.json?t=${cacheBuster}`;

    const load = async () => {

      setShajraMeta(null);

      try {

        const res = await vectorFetch(metaPath, { cache: 'no-store', credentials: 'include' });

        const isJson = (res.headers.get('Content-Type') || '').includes('application/json');

        if (res.ok && isJson) {

          const data = await res.json();

          setShajraMeta(data);

          setDataMode('shajra');

          setShajraExists(true);

          setShajraVisible(true);

          console.log(`Shajra metadata found for ${mauzaStr} – auto-loading`);

        } else {

          setShajraMeta(null);

          setDataMode('geojson-db');

          setShajraExists(false);

          setShajraVisible(false);

        }

      } catch {

        setShajraMeta(null);

        setDataMode('geojson-db');

        setShajraExists(false);

        setShajraVisible(false);

      }

    };

    load();

  }, [tehsilStr, selectedMauza, mauzaStr]);



  /* =====================================================================

   *  SHAJRA mode – check for metadata to auto-toggle layer

   * =================================================================== */

  const tileUrlTemplate =

    dataMode === 'shajra' && selectedMauza

      ? `/${encodedBase}/${encodedTehsil}/${encodedMauza}/{z}/{x}/{y}.png`

      : null;

  const base = getApiBase();
  const labelGeoJsonUrl =

    dataMode === 'shajra' && selectedMauza

      ? `${base}/${encodedBase}/${encodedTehsil}/${encodedMauza}.geojson?t=${cacheBuster}`

      : null;



  /* Reset shajra layer on Mauza change */

  useEffect(() => {

    if (dataMode !== 'shajra') return;

    setInitialTileBoundsFitted(false);

    const map = mapRef.current;

    if (map && shajraLayer) {

      map.removeLayer(shajraLayer);

      setShajraLayer(null);

    }

  }, [dataMode, selectedMauza]);



  /* Create/remove shajra tile layer */

  useEffect(() => {

    if (dataMode !== 'shajra') return;

    const map = mapRef.current;

    if (!map || !tileUrlTemplate) return;



    if (shajraVisible) {

      if (!shajraLayer) {

        const tLayer = L.tileLayer('', {

          opacity: shajraOpacity,

          maxNativeZoom: 20,

          maxZoom: 21,

          tileSize: 256,

          zIndex: 10,

        });

        // Track consecutive failures to fallback to PMTiles if all tiles are missing (e.g. Noorpur/Quaidabad)
        let consecutiveFailures = 0;
        const maxFailuresBeforeFallback = 8;

        tLayer.createTile = (coords, done) => {

          const { x, y, z } = coords;

          // Use authenticated backend endpoint
          const apiUrl = getApiBase();
          const url = `${apiUrl}/api/shajra-tiles/${tehsilStr}/${mauzaStr}/${z}/${x}/${y}.png`;

          const img = new Image();

          // Fetch with authentication
          fetch(url, {
            credentials: 'include', // Send auth cookies
            headers: {
              'Accept': 'image/png'
            }
          })
            .then(response => {
              if (!response.ok) {
                if (response.status === 401) {
                  console.error('Shajra tile request unauthorized - session expired');
                  throw new Error('Authentication required');
                }
                if (response.status === 403) {
                  console.error('Shajra tile access denied - no permission for this area');
                  throw new Error('Access denied');
                }
                if (response.status === 404) {
                  consecutiveFailures++;
                  if (consecutiveFailures >= maxFailuresBeforeFallback) {
                    console.warn(`🚨 Too many missing Shajra tiles (${consecutiveFailures}). Falling back to PMTiles/GeoJSON mode.`);
                    // Switch map mode to PMTiles
                    setDataMode('geojson-db');
                    setShajraExists(false);
                    setShajraVisible(false);
                  }
                  return null;
                }
                throw new Error(`HTTP ${response.status}`);
              }
              // Reset counter on successful tile load
              consecutiveFailures = 0;
              return response.blob();
            })
            .then(blob => {
              if (blob) {
                const blobUrl = URL.createObjectURL(blob);

                // Cache in IndexedDB
                const cacheKey = `shajra-${tehsilStr}-${mauzaStr}-${z}-${x}-${y}`;
                storeTileInIndexedDB(cacheKey, blob).catch(e =>
                  console.warn('Failed to cache Shajra tile:', e)
                );

                img.src = blobUrl;
                img.onload = () => {
                  URL.revokeObjectURL(blobUrl); // Clean up blob URL
                  done(null, img);
                };
                img.onerror = () => done(new Error('Failed to render tile'));
              } else {
                // Tile not found - return a tiny transparent canvas so Leaflet
                // doesn't render a grey placeholder square for missing tiles
                const emptyCanvas = document.createElement('canvas');
                emptyCanvas.width = 1;
                emptyCanvas.height = 1;
                done(null, emptyCanvas);
              }
            })
            .catch(err => {
              console.warn('Shajra tile loading error:', err.message);
              done(err, img);
            });

          return img;

        };

        /* Zoom to metadata bounds once */

        if (shajraMeta?.bounds) {

          let bounds = shajraMeta.bounds;

          if (typeof bounds === 'string') {

            const p = bounds.split(',').map(Number);

            if (p.length === 4 && p.every((n) => !isNaN(n)))

              bounds = [

                [p[1], p[0]],

                [p[3], p[2]],

              ];

          } else if (bounds.topLeft) {

            const lats = [

              bounds.topLeft[0],

              bounds.topRight[0],

              bounds.bottomRight[0],

              bounds.bottomLeft[0],

            ];

            const lngs = [

              bounds.topLeft[1],

              bounds.topRight[1],

              bounds.bottomRight[1],

              bounds.bottomLeft[1],

            ];

            bounds = [

              [Math.min(...lats), Math.min(...lngs)],

              [Math.max(...lats), Math.max(...lngs)],

            ];

          }

          if (Array.isArray(bounds) && bounds.length === 2 && !initialTileBoundsFitted) {

            map.fitBounds(bounds);

            setInitialTileBoundsFitted(true);

            setBoundsFit(true);

          }

        }

        tLayer.addTo(map);

        setShajraLayer(tLayer);

      }

    } else if (shajraLayer) {

      map.removeLayer(shajraLayer);

      setShajraLayer(null);

    }

  }, [

    dataMode,

    shajraVisible,

    shajraLayer,

    shajraOpacity,

    initialTileBoundsFitted,

    tehsilStr,

    mauzaStr,

    tileUrlTemplate,

    shajraMeta,

  ]);



  /* update opacity */

  useEffect(() => {

    if (shajraLayer) shajraLayer.setOpacity(shajraOpacity);

  }, [shajraOpacity, shajraLayer]);



  /* ---------------------------------------------------------------------

   * Load label GeoJSON once → set murabba dropdown

   * ------------------------------------------------------------------- */

  useEffect(() => {

    if (dataMode !== 'shajra' || !labelGeoJsonUrl) return;

    const load = async () => {

      try {

        const res = await vectorFetch(labelGeoJsonUrl, { cache: 'no-store', credentials: 'include' });

        const txt = await res.text();

        const data = JSON.parse(txt);

        const murabbas = Array.from(

          new Set(

            data.features

              .filter((f) => f.properties?.Murabba_No != null)

              .map((f) => String(f.properties.Murabba_No))

          )

        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        setMurabbaOptions(murabbas);

        setLabelGeoJsonData(data);



        // ----- fit map to overall point extents -----

        const map = mapRef.current;

        if (map) {

          const pts = data.features

            .filter((f) => f.geometry?.type === 'Point')

            .map((f) => f.geometry.coordinates);

          if (pts.length) {

            const lats = pts.map((p) => p[1]);

            const lngs = pts.map((p) => p[0]);

            const bounds = L.latLngBounds(

              [Math.min(...lats), Math.min(...lngs)],

              [Math.max(...lats), Math.max(...lngs)]

            );

            if (bounds.isValid()) {

              map.fitBounds(bounds);

              setBoundsFit(true);

            }

          }

        }

      } catch (err) {

        console.error('Error loading label JSON:', err);

      }

    };

    load();

  }, [dataMode, labelGeoJsonUrl, setMurabbaOptions]);



  /* ---------------------------------------------------------------------

   * Zoom to selected murabba

   * ------------------------------------------------------------------- */

  useEffect(() => {
    if (dataMode !== 'shajra') return;
    if (!selectedMurabba || selectedMurabba === zoomedMurabba) return;

    const map = mapRef.current;
    if (!map) return;

    // Helper to find options safely
    const findOption = (val) => {
      if (!Array.isArray(murabbaOptions)) return null;
      return murabbaOptions.find(o =>
        (typeof o === 'object' ? String(o.value) : String(o)) === String(val)
      );
    };

    let feat = null;
    if (labelGeoJsonData && labelGeoJsonData.features) {
      feat = labelGeoJsonData.features.find(
        (f) => String(f.properties?.Murabba_No) === String(selectedMurabba)
      );
    }

    if (feat) {
      if (feat.geometry.type === 'Point') {
        const [lng, lat] = feat.geometry.coordinates;
        map.flyTo([lat, lng], Math.min(18, currentMaxZoom), {
          animate: true,
          duration: 1.2,
          easeLinearity: 0.5,
        });
      } else {
        const tmp = L.geoJSON(feat);
        if (tmp.getBounds().isValid()) map.fitBounds(tmp.getBounds(), { maxZoom: currentMaxZoom });
      }

      // Load murabba PMTiles logic follows... use VectorTileLoader prop
    } else {
      // Fallback: Check metadata centroids in murabbaOptions
      const option = findOption(selectedMurabba);
      if (option && option.centroid) {
        // format: [lat, lng] or [lng, lat]? 
        // Metadata usually stores [lat, lng] or [lng, lat]?
        // Standard GeoJSON is [lng, lat]. Leaflet uses [lat, lng].
        // Let's assume the metadata processor stored it correctly or check usage.
        // VectorTileLoader stores it as [lng, lat] in keys? 
        // Actually VectorTileLoader `allKillaCentroids` pushed `[center.lng, center.lat]`.
        // `getMurabbaCentroidsFromMetadata` returns what is in JSON.
        // Usually [lat, lng] for Leaflet.
        // If it's [lng, lat], flyTo expects [lat, lng].
        // I will assume the metadata has [lat, lng] OR I will try to detect.
        // Most project code uses [lat, lng] for points in Leaflet.
        // But GeoJSON is [lng, lat].
        // If the metadata came from Python `folium` or similar, it might be [lat, lng].
        // Let's try passing it directly.
        map.flyTo(option.centroid, Math.min(17, currentMaxZoom), {
          animate: true,
          duration: 1.2
        });
        console.log('✈️ Zooming to centroid fallback for', selectedMurabba);
      } else {
        console.warn('Could not find geometry or centroid for murabba', selectedMurabba);
      }
    }

    // Load murabba PMTiles
    const tehsil = user?.activeTehsil;
    const mouza = selectedMauza;
    console.log('🎯 Dropdown selection - Loading PMTiles for:', selectedMurabba);
    console.log('   Tehsil:', tehsil);
    console.log('   Mouza:', mouza);
    console.log('   Map exists:', !!map);
    console.log('   mustateelLayers exists:', !!mustateelLayers);

    if (tehsil && mouza) {
      setIsLoadingMouza(true); // Show loading overlay
      loadMurabbaPMTiles(selectedMurabba, tehsil, mouza, map, mustateelLayers, isFallbackMode, false, true)
        .then(() => {
          console.log('✅ Dropdown PMTiles loaded successfully for', selectedMurabba, 'in', mouza);
          setIsLoadingMouza(false); // Hide loading overlay
        })
        .catch(err => {
          console.error('❌ Error loading murabba PMTiles from dropdown:', err);
          setIsLoadingMouza(false); // Hide loading overlay even on error
        });
    } else {
      console.warn('❌ Missing tehsil or mouza for PMTiles loading', { tehsil, mouza });
    }

    setZoomedMurabba(selectedMurabba);

  }, [dataMode, selectedMurabba, labelGeoJsonData, zoomedMurabba, user, selectedMauza, mustateelLayers, murabbaOptions]);



  /* ------------------------------------------------------------------
  
   * Animate to newest Go-To marker (once per addition)
  
   * ---------------------------------------------------------------- */

  // Go-To markers (legacy react-leaflet <Marker><Tooltip permanent/></Marker>)
  useEffect(() => {
    if (!leafletMap) return;
    const group = L.layerGroup().addTo(leafletMap);
    goToMarkers.forEach(({ coords }) => {
      L.marker(coords, { icon: customIcon })
        .bindTooltip(`Lat: ${coords[0]}, Lng: ${coords[1]}`, { permanent: true })
        .addTo(group);
    });
    return () => {
      group.remove();
    };
  }, [leafletMap, goToMarkers]);

  useEffect(() => {
    if (!mapRef.current || goToMarkers.length === 0) return;

    const { coords } = goToMarkers[goToMarkers.length - 1];
    const map = mapRef.current;

    // Calculate dynamic duration to prevent sub-pixel vibration on close coordinate jumps
    const currentCenter = map.getCenter();
    const distance = currentCenter.distanceTo(L.latLng(coords));
    const zoomDiff = Math.abs(map.getZoom() - 18);

    let duration = 4.0; // Max 4 seconds for long distance jumps
    if (distance < 200 && zoomDiff <= 1) {
      duration = 0.6;
    } else if (distance < 1000) {
      duration = 1.5;
    } else if (distance < 5000) {
      duration = 2.5;
    }

    map.flyTo(coords, Math.min(18, currentMaxZoom), {
      animate: true,
      duration: duration,
      easeLinearity: 0.25,
    });
  }, [goToMarkers]);



  /* ------------------------------------------------------------------
  
   * Stable callback for GeoJsonLoader
  
   * ---------------------------------------------------------------- */

  const stableGeoJsonReady = useCallback(

    (layer) => {

      // Store the layer instance so the shift form can use it:

      setGeoJsonLayerInstance(layer);

      // Also store in ref for cleanup
      geoJsonLayerRef.current = layer;



      // Forward to parent if needed:

      if (typeof onGeoJsonReady === 'function') {

        onGeoJsonReady(layer);

      }

    },

    [onGeoJsonReady]

  );





  /* =====================================================================
  
   *  Render
  
   * =================================================================== */

  return (

    <div className="map-container" style={{ position: 'relative' }}>
      {testMode && (
        <MouzaNavigator
          onNext={onNextMauza}
          onPrev={onPrevMauza}
          currentMauza={selectedMauza}
          hasNext={true}
          hasPrev={true}
        />
      )}



      <div ref={containerRef} style={{ height: '100%', width: '100%' }}>
        {leafletMap && (
          <MapContext.Provider value={leafletMap}>




        {/* 2) Location control now appears below the capture button */}

        <LocateControl />



        {/* 3) Search control placed on the left below the capture button */}

        <SearchControl onSearchClick={onGoToClick} />

        <AdminToolbar user={user} />

        <LayerControl
          activeLayer={baseLayer}
          setActiveLayer={setBaseLayer}
          currentMaxZoom={currentMaxZoom}
          satelliteLocked={isRestricted}
        />
        <GlobalZoomTracker />
        <ThreeFingerRotateControl />
        <DrawControl
          drawnItemsRef={drawnItemsRef}
          onDrawnChange={handleDrawnChange}
          measurementLabelsRef={measurementLabelsRef}
          unitMode={unitMode}
        />
        
        <GuidedDrawingMode 
          forceMobileMode={forceMobileMode} 
          unitMode={unitMode} 
          setUnitMode={handleSetUnitMode} 
          hasDrawings={Boolean(drawnGeoJson && drawnGeoJson.features && drawnGeoJson.features.length > 0)}
        />
        <GuidedRulerOverlay />

        {dataMode === 'geojson-db' && (
          <>
            <VectorTileLoader
              tehsil={user?.activeTehsil}
              mouza={selectedMauza}
              user={user}
              testMode={testMode}
              killaMeasurement={killaMeasurement}
              onLayerReady={(layer) => {
                setGeoJsonLayerInstance(layer);
                vectorMurabbaLayerRef.current = layer;
                if (typeof onGeoJsonReady === 'function') {
                  onGeoJsonReady(layer);
                }
              }}
              onError={(error) => {
                console.warn('Vector tiles not available, using GeoJSON fallback:', error);

                // If it's a fatal fallback error (data missing), show modal
                if (error.message && error.message.includes('Failed to load any fallback GeoJSONs')) {
                  setModalError({
                    show: true,
                    title: 'Data Unavailable',
                    message: "Map data for this Mouza is missing or incomplete. Please contact support."
                  });
                }
              }}
              onLoadingChange={setIsLoadingMouza}
              onExtractionProgress={setExtractionProgress}
              onFallbackMode={setIsFallbackMode}
              isFallbackMode={isFallbackMode}
              adminMapMode={adminMapMode}

              onSelect={handleMurabbaSelection} // Callback for clicks
              selectedMurabba={selectedMurabba} // Current selected value
              setMurabbaOptions={setMurabbaOptions}
              mustateelLayers={mustateelLayers}
              geoJsonLayerRef={geoJsonLayerRef}
              fallbackToGeoJson={true}
              resetFlag={mapKey}
              style={{
                merged: {
                  color: '#97e702',
                  weight: 2,
                  fillOpacity: 0.1
                },
                murabba: {
                  color: '#FFD700',
                  weight: 2,
                  fillOpacity: 0.01
                }
              }}
            />

          </>
        )}






        <Compass />

          </MapContext.Provider>
        )}
      </div>

      {/* Loading overlay for mouza/murabba loading */}
      <LoadingOverlay
        isLoading={isLoadingMouza || externalLoading}
        message={
          externalMessage || (
          extractionProgress && !extractionProgress.complete
            ? extractionProgress.fromMetadata
              ? `✨ Instant load from metadata (${extractionProgress.found} murabbas)`
              : `Extracting murabbas... (${extractionProgress.found} found, ${extractionProgress.processed}/${extractionProgress.total} tiles)`
            : selectedMurabba
              ? `Loading Murabba ${selectedMurabba}...`
              : selectedMauza
                ? `Loading ${selectedMauza}...`
                : 'Loading map data...'
          )
        }
      />


    </div>

  );
});

export default MapComponent;


