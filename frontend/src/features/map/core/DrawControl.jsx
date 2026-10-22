import { useEffect, useRef } from 'react';
import { useMap as useReactLeafletMap } from './mapContext';
import L from 'leaflet';
import './leafletGlobal';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { formatDistanceLabel, formatAreaCustomUnits as formatAreaUtil } from './measurementUtils';

// Fix for missing default icon issue with Leaflet
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Provide geodesicArea fallback formerly supplied by leaflet-draw
if (!L.GeometryUtil) {
  L.GeometryUtil = {};
}
L.GeometryUtil.geodesicArea = function (latLngs) {
  const R = 6378137; // Earth's radius in meters
  let area = 0.0;
  const len = latLngs.length;
  if (len > 2) {
    for (let i = 0; i < len; i++) {
      const p1 = latLngs[i];
      const p2 = latLngs[(i + 1) % len];
      area += ((p2.lng - p1.lng) * Math.PI / 180) *
              (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    area = area * R * R / 2.0;
  }
  return Math.abs(area);
};

window.L = L;

console.log('[DrawControl] Module loaded ✅');

const DrawControl = ({ drawnItemsRef, onDrawnChange, measurementLabelsRef, unitMode = 'imperial' }) => {
  const map = useReactLeafletMap();
  const localFeatureLabels = useRef(new Map());
  const featureLabels = measurementLabelsRef || localFeatureLabels;
  const unitModeRef = useRef(unitMode);
  unitModeRef.current = unitMode;
  const activeWorkingLayerRef = useRef(null);
  const guideLineLabelRef = useRef(null);

  const clearFeatureLabels = (layer) => {
    if (!layer || !featureLabels.current) return;
    const labels = featureLabels.current.get(layer);
    if (labels && Array.isArray(labels)) {
      labels.forEach((label) => {
        if (label) {
          if (map && map.hasLayer(label)) {
            map.removeLayer(label);
          }
          if (typeof label.remove === 'function') {
            label.remove();
          }
        }
      });
    }
    featureLabels.current.delete(layer);

    if (typeof layer.eachLayer === 'function') {
      layer.eachLayer((sub) => clearFeatureLabels(sub));
    }
  };

  const cleanOrphanedLabels = () => {
    if (!featureLabels.current || !map) return;

    // Collect all valid active layers currently in drawnItems
    const activeLayers = new Set();
    if (map.drawnItems && typeof map.drawnItems.eachLayer === 'function') {
      map.drawnItems.eachLayer((l) => {
        activeLayers.add(l);
        if (typeof l.eachLayer === 'function') {
          l.eachLayer((sub) => activeLayers.add(sub));
        }
      });
    }

    const deadEntries = [];
    featureLabels.current.forEach((labels, layer) => {
      const isDrawingLayer = (layer === activeWorkingLayerRef.current && map.hasLayer(layer));
      const isValidActiveLayer = activeLayers.has(layer) && map.hasLayer(layer);

      if (!isValidActiveLayer && !isDrawingLayer) {
        deadEntries.push({ layer, labels });
      }
    });

    deadEntries.forEach(({ layer, labels }) => {
      if (labels && Array.isArray(labels)) {
        labels.forEach((label) => {
          if (label) {
            if (map.hasLayer(label)) {
              map.removeLayer(label);
            }
            if (typeof label.remove === 'function') {
              label.remove();
            }
          }
        });
      }
      featureLabels.current.delete(layer);
    });

    // Sweep all labels if drawnItems is completely empty and not drawing
    if (activeLayers.size === 0 && !activeWorkingLayerRef.current) {
      const allLabels = Array.from(featureLabels.current.values());
      featureLabels.current.clear();
      allLabels.forEach((labels) => {
        if (labels && Array.isArray(labels)) {
          labels.forEach((label) => {
            if (label) {
              if (map.hasLayer(label)) {
                map.removeLayer(label);
              }
              if (typeof label.remove === 'function') {
                label.remove();
              }
            }
          });
        }
      });
    }

    // Sweep any orphaned measurement markers from the map that are not registered in active layers
    const allActiveLabelMarkers = new Set();
    featureLabels.current.forEach((labels) => {
      if (Array.isArray(labels)) {
        labels.forEach((lbl) => allActiveLabelMarkers.add(lbl));
      }
    });

    map.eachLayer((l) => {
      if (l instanceof L.Marker && l.options && l.options.icon && l.options.icon.options) {
        const cls = l.options.icon.options.className || '';
        if (
          cls.includes('distance-label-container') ||
          cls.includes('area-label-container') ||
          cls.includes('circle-label-container') ||
          cls.includes('marker-label-container') ||
          cls.includes('distance-label')
        ) {
          if (!allActiveLabelMarkers.has(l) && l !== guideLineLabelRef.current) {
            map.removeLayer(l);
            if (typeof l.remove === 'function') l.remove();
          }
        }
      }
    });
  };

  // Instantly re-render all existing measurement labels when unitMode toggles
  useEffect(() => {
    if (!map || !featureLabels.current) return;

    // Snapshot active layers to safely iterate without Map mutation recursion
    const activeLayersToRefresh = [];
    featureLabels.current.forEach((_, layer) => {
      if (layer && map.hasLayer(layer)) {
        activeLayersToRefresh.push(layer);
      }
    });

    activeLayersToRefresh.forEach((layer) => {
      const layerType = getLayerType(layer);
      clearFeatureLabels(layer);
      if (layerType === 'polyline') {
        showSegmentLengths(layer);
      } else if (layerType === 'polygon' || layerType === 'rectangle') {
        showPolygonArea(layer);
        showSegmentLengths(layer);
      } else if (layerType === 'circle') {
        showCircleDetails(layer);
      } else if (layerType === 'marker') {
        showMarkerCoordinates(layer);
      }
    });

    cleanOrphanedLabels();
  }, [unitMode]);

  useEffect(() => {
    console.log('[DrawControl] useEffect running, map:', !!map);
    const drawnItems = new L.FeatureGroup().addTo(map);

    if (drawnItemsRef) {
      drawnItemsRef.current = drawnItems;
    }
    if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());

    map.drawnItems = drawnItems;

    // Safeguard Geoman against internal rotateMode bugs on markers/labels without getLatLngs
    if (L.PM && L.PM.Map && L.PM.Map.prototype) {
      const origHandleLayerAddition = L.PM.Map.prototype.handleLayerAdditionInGlobalRotateMode;
      if (origHandleLayerAddition && !origHandleLayerAddition._safeguarded) {
        L.PM.Map.prototype.handleLayerAdditionInGlobalRotateMode = function() {
          const layers = this._addedLayersRotate;
          this._addedLayersRotate = {};
          if (this.globalRotateModeEnabled()) {
            for (const id in layers) {
              const layer = layers[id];
              if (this._isRelevantForRotate && this._isRelevantForRotate(layer)) {
                if (layer.pm && typeof layer.pm.enableRotate === 'function') {
                  layer.pm.enableRotate();
                }
              }
            }
          }
        };
        L.PM.Map.prototype.handleLayerAdditionInGlobalRotateMode._safeguarded = true;
      }
    }

    if (L.PM && L.PM.Edit && L.PM.Edit.Poly && L.PM.Edit.Poly.prototype) {
      const origEnableRotate = L.PM.Edit.Poly.prototype.enableRotate;
      if (origEnableRotate && !origEnableRotate._safeguarded) {
        L.PM.Edit.Poly.prototype.enableRotate = function() {
          if (!this._layer || typeof this._layer.getLatLngs !== 'function') return;
          return origEnableRotate.apply(this, arguments);
        };
        L.PM.Edit.Poly.prototype.enableRotate._safeguarded = true;
      }
    }

    // Ensure globalRotateMode is disabled if lingering in browser session
    if (map.pm && typeof map.pm.globalRotateModeEnabled === 'function' && map.pm.globalRotateModeEnabled()) {
      map.pm.disableGlobalRotateMode();
    }

    // Initialize Geoman Controls
    map.pm.addControls({
      position: 'bottomleft',
      drawMarker: true,
      drawPolyline: true,
      drawPolygon: true,
      drawRectangle: true,
      drawCircle: true,
      drawCircleMarker: false, // Disabled (matches current)
      drawText: false,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: true,
      oneBlock: true,
    });

    // Add compatibility class aliases for DrawingTour and TutorialTour selectors
    setTimeout(() => {
      const pmToolbar = map.getContainer()?.querySelector('.leaflet-pm-toolbar') || document.querySelector('.leaflet-pm-toolbar');
      if (pmToolbar) {
        pmToolbar.classList.add('leaflet-draw-toolbar');
        L.DomEvent.disableClickPropagation(pmToolbar);
        L.DomEvent.disableScrollPropagation(pmToolbar);
        const parentControl = pmToolbar.closest('.leaflet-control-container') || pmToolbar.closest('.leaflet-control');
        if (parentControl) {
          L.DomEvent.disableClickPropagation(parentControl);
          L.DomEvent.disableScrollPropagation(parentControl);
        }
        
        const mapClasses = [
          { selector: '.leaflet-pm-icon-polyline', legacy: 'leaflet-draw-draw-polyline' },
          { selector: '.leaflet-pm-icon-polygon', legacy: 'leaflet-draw-draw-polygon' },
          { selector: '.leaflet-pm-icon-rectangle', legacy: 'leaflet-draw-draw-rectangle' },
          { selector: '.leaflet-pm-icon-circle', legacy: 'leaflet-draw-draw-circle' },
          { selector: '.leaflet-pm-icon-marker', legacy: 'leaflet-draw-draw-marker' },
          { selector: '.leaflet-pm-icon-edit', legacy: 'leaflet-draw-edit-edit' },
          { selector: '.leaflet-pm-icon-drag', legacy: 'leaflet-draw-edit-drag' },
          { selector: '.leaflet-pm-icon-rotate', legacy: 'leaflet-draw-edit-rotate' },
          { selector: '.leaflet-pm-icon-delete', legacy: 'leaflet-draw-edit-remove' },
        ];
        
        mapClasses.forEach(({ selector, legacy }) => {
          const btnIcon = pmToolbar.querySelector(selector);
          const btn = btnIcon?.closest('a') || btnIcon?.closest('.leaflet-buttons-control-button');
          if (btn) {
            btn.classList.add(legacy);
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.disableScrollPropagation(btn);
          }
        });
      }
    }, 200);

    // Configure self-intersection and continuity options
    map.pm.setGlobalOptions({
      continueDrawing: false,
      allowSelfIntersection: false,
      allowSelfIntersectionEdit: false,
      clickTolerance: 15,
      snappable: true,
      snapDistance: 20,
    });

    // Configure shape-specific styles on initialization to prevent recursive styling calls
    if (map.pm.Draw.Line) {
      map.pm.Draw.Line.setPathOptions({
        color: '#FF0000',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0,
        templineStyle: { color: '#FF0000', weight: 2 },
        hintlineStyle: { color: '#FF0000', weight: 2, dashArray: [5, 5] }
      });
    }
    if (map.pm.Draw.Polygon) {
      map.pm.Draw.Polygon.setPathOptions({
        color: '#FFD700',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3,
        templineStyle: { color: '#FFD700', weight: 2 },
        hintlineStyle: { color: '#FFD700', weight: 2, dashArray: [5, 5] }
      });
    }
    if (map.pm.Draw.Rectangle) {
      map.pm.Draw.Rectangle.setPathOptions({
        color: '#32CD32',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3,
        templineStyle: { color: '#32CD32', weight: 2 },
        hintlineStyle: { color: '#32CD32', weight: 2, dashArray: [5, 5] }
      });
    }
    if (map.pm.Draw.Circle) {
      map.pm.Draw.Circle.setPathOptions({
        color: '#00FFFF',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3,
        templineStyle: { color: '#00FFFF', weight: 2 },
        hintlineStyle: { color: '#00FFFF', weight: 2, dashArray: [5, 5] }
      });
    }

    // Inject/remove a <style> block to override Leaflet's inline pointer-events on SVG paths
    // during drawing/editing, without changing z-index (layers stay fully visible).
    const DRAW_STYLE_ID = 'leaflet-draw-passthrough-style';

    const enableDrawPassthrough = () => {
      if (document.getElementById(DRAW_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = DRAW_STYLE_ID;
      style.textContent = `
        .leaflet-completePMTilesPane-pane path,
        .leaflet-completePMTilesPane-pane canvas,
        .leaflet-mouzaPMTilesPane-pane path,
        .leaflet-mouzaPMTilesPane-pane canvas,
        .leaflet-fallbackGeoJsonPane-pane path,
        .leaflet-murabbaPane-pane path,
        .leaflet-murabbaTooltipPane-pane *,
        .leaflet-killaTooltipPane-pane * {
          pointer-events: none !important;
          cursor: crosshair !important;
        }
      `;
      document.head.appendChild(style);

      const paneNames = [
        'completePMTilesPane', 'mouzaPMTilesPane',
        'fallbackGeoJsonPane', 'murabbaPane',
        'murabbaTooltipPane', 'killaTooltipPane'
      ];
      paneNames.forEach(paneName => {
        const pane = map.getPane(paneName);
        if (!pane) return;
        pane.style.pointerEvents = 'none';
        pane.querySelectorAll('path, canvas, div, span').forEach(el => {
          el.dataset.origPE = el.style.pointerEvents || '';
          el.style.setProperty('pointer-events', 'none', 'important');
        });
      });
    };

    const disableDrawPassthrough = () => {
      const style = document.getElementById(DRAW_STYLE_ID);
      if (style) style.remove();

      const paneNames = [
        'completePMTilesPane', 'mouzaPMTilesPane',
        'fallbackGeoJsonPane', 'murabbaPane',
        'murabbaTooltipPane', 'killaTooltipPane'
      ];
      paneNames.forEach(paneName => {
        const pane = map.getPane(paneName);
        if (!pane) return;
        pane.style.pointerEvents = '';
        pane.querySelectorAll('path, canvas, div, span').forEach(el => {
          const orig = el.dataset.origPE;
          el.style.removeProperty('pointer-events');
          if (orig !== undefined && orig !== '') {
            el.style.pointerEvents = orig;
          }
          delete el.dataset.origPE;
        });
      });
    };

    let activeWorkingLayer = null;
    let lastVertexLatLng = null;
    let guideLineLabel = null;

    const aliasActionsContainer = () => {
      setTimeout(() => {
        const actions = map.getContainer()?.querySelector('.leaflet-pm-actions') || document.querySelector('.leaflet-pm-actions');
        if (actions) {
          actions.classList.add('leaflet-draw-actions');
        }
      }, 100);
    };

    const handleDrawStart = ({ shape, workingLayer }) => {
      map.doubleClickZoom.disable();
      map._isDrawing = true;
      enableDrawPassthrough();
      aliasActionsContainer();
      lastVertexLatLng = null;
      activeWorkingLayer = workingLayer;
      activeWorkingLayerRef.current = workingLayer;
      cleanOrphanedLabels();
      if (guideLineLabel && map.hasLayer(guideLineLabel)) {
        map.removeLayer(guideLineLabel);
      }
      guideLineLabel = null;

      const colorMap = {
        'Line': '#FF0000',
        'Polygon': '#FFD700',
        'Rectangle': '#32CD32',
        'Circle': '#00FFFF',
      };
      const color = colorMap[shape] || '#FFD700';
      const fillOpacity = (shape === 'Line') ? 0 : 0.3;

      // Line: snap the cursor to the line's own vertices (Geoman only snaps to other
      // layers). Clicking on the first vertex closes the outline and finishes the line.
      if (shape === 'Line' && workingLayer) {
        const lineDraw = map.pm.Draw.Line;
        if (lineDraw && lineDraw.options) lineDraw.options.allowSelfIntersection = true; // closing touches the start
        const SNAP_PX = 20;
        const onLineSnapMove = (e) => {
          const hint = lineDraw && lineDraw._hintMarker;
          if (!hint) return;
          // Guided (crosshair) drawing keeps the cursor marker on the crosshair centre
          if (map.getContainer().classList.contains('guided-drawing-active')) return;
          const pts = ringPoints(workingLayer);
          if (pts.length < 2) return;
          const cursor = map.latLngToContainerPoint(e.latlng);
          let best = null, bestPx = SNAP_PX;
          // first vertex first (closing), then the others except the last one
          [pts[0], ...pts.slice(1, -1)].forEach((p) => {
            const d = map.latLngToContainerPoint(p).distanceTo(cursor);
            if (d < bestPx) { best = p; bestPx = d; }
          });
          // Geoman finishes the line when the first vertex is clicked (without adding it),
          // so remember that the outline should be closed when the line is created.
          closeNextLineRef.current = !!best && best === pts[0] && pts.length >= 3;
          if (best) {
            hint.setLatLng(best);
            hint._snapped = true;
            lineDraw._syncHintLine?.();
          }
        };
        closeNextLineRef.current = false;
        map.on('mousemove', onLineSnapMove);
        map.once('pm:drawend', () => map.off('mousemove', onLineSnapMove));
      }

      // Enable drag-to-draw (click-hold-release) for Rectangles and Circles
      if (shape === 'Rectangle' || shape === 'Circle') {
        map.dragging.disable(); // Prevent map panning
        let startLatLng = null;

        const onMouseDown = (e) => {
          startLatLng = e.latlng;
          // Trigger the initial Geoman click to place the starting marker
          setTimeout(() => map.fire('click', e), 10);
        };

        const onMouseUp = (e) => {
          if (startLatLng && e.latlng) {
            const pointStart = map.latLngToContainerPoint(startLatLng);
            const pointEnd = map.latLngToContainerPoint(e.latlng);
            const distance = pointStart.distanceTo(pointEnd);
            
            // If they dragged more than 5 pixels, consider it a drag-to-draw and finish the shape
            if (distance > 5) {
              setTimeout(() => map.fire('click', e), 10);
            }
          }
          startLatLng = null;
        };

        map.on('mousedown', onMouseDown);
        map.on('mouseup', onMouseUp);
        map._dragDrawHandlers = { down: onMouseDown, up: onMouseUp };
      }

      if (workingLayer) {
        workingLayer.setStyle?.({ color, weight: 2, opacity: 1.0, fillOpacity });
        
        // Listen to change, vertexadded, and vertexremoved events on workingLayer to update measurements in real-time
        workingLayer.on('pm:change pm:vertexadded pm:vertexremoved', () => {
          updateRealTimeMeasurements(workingLayer);
          
          if (typeof workingLayer.getLatLngs === 'function') {
            let pts = workingLayer.getLatLngs();
            while (Array.isArray(pts) && Array.isArray(pts[0])) {
              pts = pts[0];
            }
            if (pts && pts.length > 0) {
              lastVertexLatLng = L.latLng(pts[pts.length - 1]);
            }
          } else if (typeof workingLayer.getLatLng === 'function') {
            lastVertexLatLng = workingLayer.getLatLng();
          }
        });
      }
    };

    const handleDrawStop = () => {
      map.doubleClickZoom.enable();
      map.dragging.enable(); // Re-enable map panning

      setTimeout(() => {
        if (!map.pm.globalDrawModeEnabled()) {
          map._isDrawing = false;
          disableDrawPassthrough();
        }
      }, 300);

      if (map._dragDrawHandlers) {
        map.off('mousedown', map._dragDrawHandlers.down);
        map.off('mouseup', map._dragDrawHandlers.up);
        map._dragDrawHandlers = null;
      }

      if (activeWorkingLayer) {
        clearFeatureLabels(activeWorkingLayer);
        activeWorkingLayer = null;
      }
      if (activeWorkingLayerRef.current) {
        clearFeatureLabels(activeWorkingLayerRef.current);
        activeWorkingLayerRef.current = null;
      }
      cleanOrphanedLabels();
      lastVertexLatLng = null;
      if (guideLineLabel && map.hasLayer(guideLineLabel)) {
        map.removeLayer(guideLineLabel);
      }
      guideLineLabel = null;
    };

    const bindLayerEditEvents = (layer) => {
      if (!layer) return;
      const shapeType = getLayerType(layer);

      if (shapeType === 'marker') {
        bindMarkerDragEvents(layer);
      }

      layer.off('remove', layer._cleanLabelsHandler);
      layer._cleanLabelsHandler = () => {
        clearFeatureLabels(layer);
        cleanOrphanedLabels();
      };
      layer.on('remove', layer._cleanLabelsHandler);

      // Starting to drag a vertex / the shape shows its labels again (even if ✕ hid them)
      layer.off('pm:markerdragstart pm:dragstart', layer._unhideOnEditHandler);
      layer._unhideOnEditHandler = () => {
        if (!hiddenLayersRef.current.has(layer)) return;
        hiddenLayersRef.current.delete(layer);
        handleFeatureComplete(layer, getLayerType(layer));
      };
      layer.on('pm:markerdragstart pm:dragstart', layer._unhideOnEditHandler);

      layer.off('pm:change pm:edit pm:vertexadded pm:vertexremoved pm:markerdrag pm:drag pm:snap');
      layer.on('pm:change pm:edit pm:vertexadded pm:vertexremoved pm:markerdrag pm:drag pm:snap', () => {
        const currentShapeType = getLayerType(layer);
        updateRealTimeMeasurements(layer);
        handleFeatureComplete(layer, currentShapeType, true);
        if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
      });
    };

    drawnItems.on('layeradd', (e) => {
      if (e.layer) {
        if (e.layer.options) e.layer.options.clickTolerance = 15;
        bindLayerEditEvents(e.layer);
      }
      cleanOrphanedLabels();
    });

    drawnItems.on('layerremove', (e) => {
      if (e.layer) {
        clearFeatureLabels(e.layer);
      }
      cleanOrphanedLabels();
      if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
    });

    const isolateDrawnItemsFromGeoman = () => {
      map.eachLayer((layer) => {
        // Skip: the drawnItems group itself, any drawn shape inside it,
        // and any Geoman-internal temp layer (_rotatePoly, _markerGroup, etc.)
        // — those have _pmTempLayer = true and must remain functional.
        if (layer !== drawnItems && !drawnItems.hasLayer(layer) && !layer._pmTempLayer) {
          layer.options = layer.options || {};
          layer.options.pmIgnore = true;
          if (layer.pm) {
            layer.pm.disable();
          }
          if (typeof layer.eachLayer === 'function') {
            layer.eachLayer((subLayer) => {
              if (!subLayer._pmTempLayer) {
                subLayer.options = subLayer.options || {};
                subLayer.options.pmIgnore = true;
                if (subLayer.pm) {
                  subLayer.pm.disable();
                }
              }
            });
          }
        }
      });
    };

    const handleEditStart = () => {
      map.doubleClickZoom.disable();
      map._isDrawing = true;
      enableDrawPassthrough();
      aliasActionsContainer();
      isolateDrawnItemsFromGeoman();
      cleanOrphanedLabels();

      drawnItems.eachLayer((layer) => {
        bindLayerEditEvents(layer);
        handleFeatureComplete(layer, getLayerType(layer));
      });
      cleanOrphanedLabels();
    };

    const handleEditStop = () => {
      map.doubleClickZoom.enable();
      map._isDrawing = false;
      disableDrawPassthrough();
      cleanOrphanedLabels();
    };

    const handleRemovalStart = () => {
      map._isDrawing = true;
      map.getContainer()?.classList.add('pm-removal-active');
      enableDrawPassthrough();
      aliasActionsContainer();
      isolateDrawnItemsFromGeoman();
      cleanOrphanedLabels();
    };

    const handleRemovalStop = () => {
      map._isDrawing = false;
      map.getContainer()?.classList.remove('pm-removal-active');
      disableDrawPassthrough();
      cleanOrphanedLabels();
    };

    // Geoman event bindings
    map.on('pm:drawstart', handleDrawStart);
    map.on('pm:drawend', handleDrawStop);
    map.on('pm:globaleditmodetoggled', (e) => e.enabled ? handleEditStart() : handleEditStop());
    map.on('pm:globalremovalmodetoggled', (e) => e.enabled ? handleRemovalStart() : handleRemovalStop());
    map.on('pm:globaldragmodetoggled', (e) => {
      if (e.enabled) {
        isolateDrawnItemsFromGeoman();
      }
    });

    // ─── Rotate Mode: prevent map panning while rotating ─────────────────────
    // Root cause: Geoman's rotation vertex markers are created as standard
    // Leaflet { draggable: true } markers using L.Draggable. L.Draggable._onDown
    // does NOT call stopPropagation, so the native mousedown bubbles to the map
    // container, triggering Leaflet's pan handler in parallel with the rotation.
    //
    // Geoman's own DragMixin handles this for drag-mode layers by calling
    // map.dragging.disable() on the first mousemove (_dragMixinOnMouseMove).
    // But rotation markers bypass DragMixin entirely and use L.Marker's built-in
    // dragging, so no such protection exists.
    //
    // Fix: when rotation is enabled on a shape (pm:rotateenable), hook Leaflet's
    // 'dragstart' on each rotation vertex marker to disable map.dragging, and
    // re-enable it on 'dragend'. This is safe — it doesn't touch _originalMapDragState
    // (which DragMixin caches during enableLayerDrag) because rotation markers
    // never call enableLayerDrag() at all.
    map.on('pm:globalrotatemodetoggled', (e) => {
      if (e.enabled) {
        isolateDrawnItemsFromGeoman();
        aliasActionsContainer();
      } else {
        // Safeguard: re-enable map dragging in case it was left disabled
        // (e.g., user exited rotate mode mid-drag without a dragend)
        if (!map.dragging.enabled()) {
          map.dragging.enable();
        }
      }
    });

    map.on('pm:rotateenable', ({ layer, helpLayer }) => {
      // helpLayer IS the _rotatePoly (confirmed from Geoman source: helpLayer = this._rotatePoly)
      requestAnimationFrame(() => {
        try {
          const rotatePoly = helpLayer || layer?.pm?._rotatePoly;
          if (!rotatePoly?.pm) return;

          const allMarkers = rotatePoly.pm._markers;
          if (!allMarkers) return;

          // _markers can be [[m,m,...], ...] for polygons with holes, or [m,m,...] for polylines
          const flat = allMarkers.flat ? allMarkers.flat(Infinity) : [].concat(...allMarkers);

          flat.forEach((m) => {
            if (!m) return;
            // L.Marker { draggable: true } fires standard Leaflet drag events via L.Draggable.
            // Disable map pan on dragstart so the user rotates instead of panning.
            m.on('dragstart', () => {
              map.dragging.disable();
            });
            m.on('dragend', () => {
              // Only re-enable if rotate mode is still on (another handle might be used)
              if (map.pm.globalRotateModeEnabled()) {
                map.dragging.enable();
              }
            });
          });
        } catch (_) { /* Geoman internals may vary across versions */ }
      });
    });

    map.on('pm:rotateend', (e) => {
      if (e && e.layer) {
        const layer = e.layer;
        const shapeType = getLayerType(layer);
        clearFeatureLabels(layer);
        handleFeatureComplete(layer, shapeType, true);
        if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
      }
    });

    // Mousemove guide line distance label
    const onGuideMouseMove = (e) => {
      if (!map._isDrawing || !lastVertexLatLng) {
        if (guideLineLabelRef.current && map.hasLayer(guideLineLabelRef.current)) {
          map.removeLayer(guideLineLabelRef.current);
          guideLineLabelRef.current = null;
        }
        return;
      }

      const activeLatLng = L.latLng(lastVertexLatLng);
      const distanceInMeters = activeLatLng.distanceTo(e.latlng);
      const distanceInFeet = distanceInMeters * 3.28084;
      const midpoint = L.latLng(
        (activeLatLng.lat + e.latlng.lat) / 2,
        (activeLatLng.lng + e.latlng.lng) / 2
      );

      if (!guideLineLabelRef.current) {
        guideLineLabelRef.current = L.marker(midpoint, {
          icon: L.divIcon({
            className: 'distance-label',
            html: `<div class="distance-label">${distanceInFeet.toFixed(2)} Ft</div>`,
            iconSize: null,
            iconAnchor: [0, 0]
          })
        }).addTo(map);
      } else {
        guideLineLabelRef.current.setLatLng(midpoint);
        guideLineLabelRef.current.setIcon(L.divIcon({
          className: 'distance-label',
          html: `<div class="distance-label">${distanceInFeet.toFixed(2)} Ft</div>`,
          iconSize: null,
          iconAnchor: [0, 0]
        }));
      }
    };
    map.on('mousemove', onGuideMouseMove);

    // Helper: bind Geoman drag events on a marker layer so the coordinate
    // tooltip follows it in real-time (Geoman fires pm:drag on the layer during edit mode).
    const bindMarkerDragEvents = (layer) => {
      // Unbind first to prevent duplicate firing
      layer.off('pm:drag').off('pm:dragend');
      
      layer.on('pm:drag', (e) => {
        // e.layer or the layer itself can be used
        const latlng = layer.getLatLng();
        const tooltipText = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
        const existingLabels = featureLabels.current.get(layer);
        console.log('[DrawControl] marker pm:drag event, latlng:', tooltipText, 'existingLabels:', existingLabels?.length ?? 0);

        if (existingLabels && existingLabels.length > 0) {
          const existingLabel = existingLabels[0];
          existingLabel.setLatLng(latlng);
          existingLabel.setIcon(L.divIcon({
            className: 'marker-label-container',
            html: `<div class="marker-label" style="cursor:pointer;pointer-events:auto;text-align:center;">${tooltipText}</div>`,
            iconSize: [120, 20],
            iconAnchor: [60, -15]
          }));
        } else {
          const label = L.marker(latlng, {
            icon: L.divIcon({
              className: 'marker-label-container',
              html: `<div class="marker-label" style="cursor:pointer;pointer-events:auto;text-align:center;">${tooltipText}</div>`,
              iconSize: [120, 20],
              iconAnchor: [60, -15]
            }),
            interactive: false
          }).addTo(map);
          featureLabels.current.set(layer, [label]);
        }
      });

      layer.on('pm:dragend', () => {
        console.log('[DrawControl] marker pm:dragend event');
        clearFeatureLabels(layer);
        handleFeatureComplete(layer, 'marker', true);
        if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
      });
    };

    // Handle global edits on drawn features
    map.on('pm:edit', (e) => {
      const layer = e.layer;
      const shapeType = getLayerType(layer);
      console.log('[DrawControl] map pm:edit fired, shapeType:', shapeType);
      clearFeatureLabels(layer);
      handleFeatureComplete(layer, shapeType, true);
      if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
    });

    // Entering edit mode: show labels of every shape (including ones hidden with ✕)
    map.on('pm:globaleditmodetoggled', (e) => {
      if (!e.enabled) return;
      drawnItems.eachLayer((l) => {
        if (!hiddenLayersRef.current.has(l)) return;
        hiddenLayersRef.current.delete(l);
        handleFeatureComplete(l, getLayerType(l));
      });
    });

    // Click/touch inside a drawn shape → show its area box and side lengths again
    const mapContainer = map.getContainer();
    const onShapeAreaClick = (ev) => {
      if (map._isDrawing || (map.pm && (map.pm.globalDrawModeEnabled() || map.pm.globalRemovalModeEnabled?.()))) return;
      if (ev.target && ev.target.closest && ev.target.closest('.leaflet-control')) return;
      const hit = findShapeAt(map.mouseEventToLatLng(ev), drawnItems);
      if (!hit) return;
      hiddenLayersRef.current.delete(hit);
      handleFeatureComplete(hit, getLayerType(hit));
    };
    mapContainer.addEventListener('click', onShapeAreaClick, true);

    // Handle completed shape creation
    map.on('pm:create', (e) => {
      cleanOrphanedLabels();
      const layer = e.layer;
      if (layer && layer.options) {
        layer.options.clickTolerance = 15;
      }
      drawnItems.addLayer(layer);

      const shapeMap = {
        'Marker': 'marker',
        'Line': 'polyline',
        'Polygon': 'polygon',
        'Rectangle': 'rectangle',
        'Circle': 'circle'
      };
      const shapeType = shapeMap[e.shape] || getLayerType(layer);

      // A line whose last vertex ends on/near its first vertex is closed into an outline
      if (shapeType === 'polyline') closeLineIfNearStart(layer);

      // Bind native drag events for markers so tooltip tracks in real-time
      if (shapeType === 'marker') {
        bindMarkerDragEvents(layer);
      }

      // Bind pm:change event to the layer so it fires during vertex drag in edit mode
      layer.on('pm:change', () => {
        console.log('[DrawControl] layer pm:change fired (real-time edit)');
        updateRealTimeMeasurements(layer);
      });

      handleFeatureComplete(layer, shapeType);
      cleanOrphanedLabels();
      if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());

      // Cooloff period to prevent vertex clicks from triggering map underlying vector feature clicks
      map._isDrawing = true;
      setTimeout(() => {
        if (!map.pm.globalDrawModeEnabled()) {
          map._isDrawing = false;
        }
      }, 300);
    });

    // Handle global removals
    map.on('pm:remove', (e) => {
      const layer = e.layer;
      clearFeatureLabels(layer);
      cleanOrphanedLabels();
      if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());

      // Show temporary red X animation at removal location
      try {
        let latlng = null;
        if (typeof layer.getLatLng === 'function') {
          latlng = layer.getLatLng();
        } else if (typeof layer.getBounds === 'function') {
          latlng = layer.getBounds().getCenter();
        }
        if (latlng) {
          const deleteMarker = L.marker(latlng, {
            icon: L.divIcon({
              className: 'pm-delete-burst-container',
              html: `<div class="pm-delete-burst-icon"><svg width="32" height="32" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" fill="rgba(15,23,42,0.9)" stroke="%23ff2222" stroke-width="2.5"/><line x1="9" y1="9" x2="19" y2="19" stroke="%23ff2222" stroke-width="3" stroke-linecap="round"/><line x1="19" y1="9" x2="9" y2="19" stroke="%23ff2222" stroke-width="3" stroke-linecap="round"/></svg></div>`,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            }),
            interactive: false
          }).addTo(map);

          setTimeout(() => {
            if (map.hasLayer(deleteMarker)) {
              map.removeLayer(deleteMarker);
            }
          }, 600);
        }
      } catch (err) {}

      // Automatically exit removal mode so cursor returns to normal
      setTimeout(() => {
        if (map.pm && typeof map.pm.disableGlobalRemovalMode === 'function') {
          map.pm.disableGlobalRemovalMode();
        }
        map.getContainer()?.classList.remove('pm-removal-active');
      }, 50);
    });

    // Handle real-time change during drags/resizes
    map.on('pm:change', (e) => {
      const layer = e.layer;
      const shapeType = getLayerType(layer);
      console.log('[DrawControl] pm:change fired, shapeType:', shapeType, 'layer:', layer);
      updateRealTimeMeasurements(layer);
    });

    // Handle completed drag: finalize permanent tooltip with click-to-copy
    map.on('pm:dragend', (e) => {
      const layer = e.layer;
      const shapeType = getLayerType(layer);
      console.log('[DrawControl] pm:dragend fired, shapeType:', shapeType, 'latlng:', layer.getLatLng?.());
      clearFeatureLabels(layer);
      handleFeatureComplete(layer, shapeType, true);
      if (onDrawnChange) onDrawnChange(drawnItems.toGeoJSON());
    });

    // Handle real-time changes during dragging: for markers, move the label with the pin
    map.on('pm:drag', (e) => {
      const layer = e.layer;
      const shapeType = getLayerType(layer);
      console.log('[DrawControl] pm:drag fired, shapeType:', shapeType, 'layer instanceof L.Marker:', layer instanceof L.Marker);

      if (shapeType === 'marker') {
        // For markers, efficiently reuse/reposition the existing label marker
        const latlng = layer.getLatLng();
        const tooltipText = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
        const existingLabels = featureLabels.current.get(layer);
        console.log('[DrawControl] pm:drag marker - latlng:', tooltipText, '| existingLabels count:', existingLabels?.length ?? 0);

        if (existingLabels && existingLabels.length > 0) {
          // Reuse: just move and update icon text
          const existingLabel = existingLabels[0];
          existingLabel.setLatLng(latlng);
          existingLabel.setIcon(L.divIcon({
            className: 'marker-label-container',
            html: `<div class="marker-label" style="text-align: center;">${tooltipText}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          }));
          console.log('[DrawControl] pm:drag marker - REUSED existing label, moved to:', tooltipText);
        } else {
          // First drag event: create the initial drag label (no click handler yet)
          console.log('[DrawControl] pm:drag marker - CREATING new drag label at:', tooltipText);
          const label = L.marker(latlng, {
            icon: L.divIcon({
              className: 'marker-label-container',
              html: `<div class="marker-label" style="text-align: center;">${tooltipText}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0]
            }),
            interactive: false
          }).addTo(map);
          const labels = featureLabels.current.get(layer) || [];
          labels.push(label);
          featureLabels.current.set(layer, labels);
        }
      } else {
        updateRealTimeMeasurements(layer);
      }
    });

    return () => {
      map.off('pm:drawstart', handleDrawStart);
      map.off('pm:drawend', handleDrawStop);
      map.off('pm:globaleditmodetoggled');
      map.off('pm:globalremovalmodetoggled');
      map.off('pm:globaldragmodetoggled');
      map.off('pm:globalrotatemodetoggled');
      map.off('pm:rotateenable');
      map.off('pm:create');
      mapContainer.removeEventListener('click', onShapeAreaClick, true);
      map.off('pm:remove');
      map.off('pm:edit');
      map.off('pm:change');
      map.off('pm:dragend');
      map.off('pm:rotateend');
      map.off('pm:drag');
      map.off('mousemove', onGuideMouseMove); // gotcha 7 fix: only our own handler
      map.pm.removeControls();
      if (map.hasLayer(drawnItems)) {
        map.removeLayer(drawnItems);
      }
    };
  }, [map]);

  // Function to show marker coordinates as tooltip and allow copying to clipboard
  const showMarkerCoordinates = (layer) => {
    const latlng = layer.getLatLng();
    const tooltipText = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

    const label = L.marker(latlng, {
      icon: L.divIcon({
        className: 'marker-label-container',
        html: `<div class="marker-label" style="text-align: center;">${tooltipText}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      }),
      interactive: true,
      pmIgnore: true,
      snapIgnore: true
    }).addTo(map);

    label.on('click', (e) => {
      if (e && e.originalEvent) e.originalEvent.stopPropagation();
      navigator.clipboard.writeText(tooltipText)
        .then(() => {
          displayCopyNotification();
        })
        .catch(() => {});
    });

    const labels = featureLabels.current.get(layer) || [];
    labels.push(label);
    featureLabels.current.set(layer, labels);
  };

  function displayCopyNotification() {
    const notification = document.createElement('div');
    notification.textContent = 'Coordinates copied to clipboard!';
    notification.className = 'copy-notification';

    document.body.appendChild(notification);

    setTimeout(() => {
      document.body.removeChild(notification);
    }, 2000);
  }

  // ---- Area box (same look as the killa area box) ----
  // One box at a time; ✕ hides the box and the shape's segment labels,
  // clicking/touching the shape shows them again.
  const areaBoxRef = useRef(null);          // { control, owner, el }
  const hiddenLayersRef = useRef(new WeakSet());

  const removeAreaBox = (owner) => {
    const box = areaBoxRef.current;
    if (!box || (owner && box.owner !== owner)) return;
    try { box.control.remove(); } catch (e) {}
    areaBoxRef.current = null;
  };

  // Returns a holder kept in featureLabels (index 0) so clearFeatureLabels removes the box.
  const showAreaBox = (layer, title, valueHtml) => {
    const box = areaBoxRef.current;
    if (box && box.owner === layer && box.el && box.el.isConnected) {
      box.el.querySelector('.killa-area-title').textContent = title;
      box.el.querySelector('.killa-area-value').innerHTML = valueHtml;
    } else {
      removeAreaBox();
      const AreaControl = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function () {
          // Own class: killa clean-up removes every .killa-area-info-box on map click
          const container = L.DomUtil.create('div', 'drawn-area-info-box');
          container.innerHTML = `
            <button class="killa-area-close-btn" title="Close Measurements" aria-label="Close">&times;</button>
            <div class="killa-area-title"></div>
            <div class="killa-area-value"></div>
          `;
          container.querySelector('.killa-area-title').textContent = title;
          container.querySelector('.killa-area-value').innerHTML = valueHtml;
          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.disableScrollPropagation(container);
          L.DomEvent.on(container.querySelector('.killa-area-close-btn'), 'click', (e) => {
            L.DomEvent.stop(e);
            // Close = hide the labels of ALL drawn shapes; clicking a shape shows its own again
            const all = [layer];
            map.drawnItems?.eachLayer((l) => { if (getLayerType(l) !== 'marker') all.push(l); });
            all.forEach((l) => { hiddenLayersRef.current.add(l); hideShapeLabels(l); });
          });
          return container;
        }
      });
      const control = new AreaControl();
      control.addTo(map);
      areaBoxRef.current = { control, owner: layer, el: control.getContainer() };
    }
    return { _isAreaBoxHolder: true, remove: () => removeAreaBox(layer) };
  };

  // ✕: remove the area box and every side-length label of this shape, including
  // labels not (or no longer) registered for it, matched by segment midpoint.
  const hideShapeLabels = (layer) => {
    clearFeatureLabels(layer);
    removeAreaBox(layer);
    const pts = ringPoints(layer);
    if (pts.length >= 2) {
      const mids = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        mids.push(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2));
      }
      const stray = [];
      map.eachLayer((l) => {
        const cls = l instanceof L.Marker && l.options?.icon?.options?.className;
        if (cls && cls.includes('distance-label-container') &&
            mids.some(m => m.equals(l.getLatLng(), 1e-9))) stray.push(l);
      });
      stray.forEach(l => map.removeLayer(l));
    }
  };

  const ringPoints = (layer) => {
    let pts = layer && layer.getLatLngs ? layer.getLatLngs() : null;
    while (Array.isArray(pts) && Array.isArray(pts[0])) pts = pts[0];
    return pts || [];
  };

  // A drawn line whose last vertex sits on its first vertex encloses an area.
  const isClosedLine = (layer) => {
    if (getLayerType(layer) !== 'polyline') return false;
    const pts = ringPoints(layer);
    return pts.length >= 4 && pts[0].equals(pts[pts.length - 1], 1e-9);
  };

  const closeNextLineRef = useRef(false);   // set while drawing when the first vertex is clicked

  const closeLineIfNearStart = (layer) => {
    const pts = ringPoints(layer).slice();
    const closeOnFirst = closeNextLineRef.current;
    closeNextLineRef.current = false;
    if (pts.length < 3) return;
    const first = pts[0], last = pts[pts.length - 1];
    if (closeOnFirst && !first.equals(last, 1e-9)) {
      pts.push(L.latLng(first.lat, first.lng));          // clicked on the first vertex
    } else {
      const px = map.latLngToContainerPoint(first).distanceTo(map.latLngToContainerPoint(last));
      if (px > 20) return;
      pts[pts.length - 1] = L.latLng(first.lat, first.lng);
    }
    layer.setLatLngs(pts);
    // Fill (lightly) so a click/touch inside the outline reaches the layer
    layer.setStyle({ fill: true, fillOpacity: 0.08 });
  };

  // Drawn shapes sit below the murabba/killa panes, so their own click events rarely fire.
  // Instead, a click anywhere on the map is tested against the drawn shapes' outlines.
  const pointInRing = (latlng, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (((a.lat > latlng.lat) !== (b.lat > latlng.lat)) &&
          (latlng.lng < (b.lng - a.lng) * (latlng.lat - a.lat) / (b.lat - a.lat) + a.lng)) inside = !inside;
    }
    return inside;
  };

  const findShapeAt = (latlng, drawnItems) => {
    let hit = null;
    drawnItems.eachLayer((l) => {
      const type = getLayerType(l);
      if (type === 'circle') {
        if (map.distance(l.getLatLng(), latlng) <= l.getRadius()) hit = l;
      } else if (type === 'polygon' || type === 'rectangle' || isClosedLine(l)) {
        const pts = ringPoints(l);
        if (pts.length >= 3 && pointInRing(latlng, pts)) hit = l;
      }
    });
    return hit; // last match = topmost drawn
  };

  const handleFeatureComplete = (layer, layerType) => {
    if (!layer || !map || !map.hasLayer(layer)) return;
    clearFeatureLabels(layer);
    if (hiddenLayersRef.current.has(layer)) return;

    if (layerType === 'polyline' && isClosedLine(layer)) {
      showPolygonArea(layer);
      showSegmentLengths(layer);
    } else if (layerType === 'polyline') {
      showSegmentLengths(layer);
    } else if (layerType === 'polygon' || layerType === 'rectangle') {
      showPolygonArea(layer);
      showSegmentLengths(layer);
    } else if (layerType === 'circle') {
      showCircleDetails(layer);
    } else if (layerType === 'marker') {
      showMarkerCoordinates(layer);
    }
  };

  const updateRealTimeMeasurements = (layer) => {
    if (!layer || !map || !map.hasLayer(layer)) return;
    const layerType = getLayerType(layer);
    if (hiddenLayersRef.current.has(layer)) return;

    if (layerType === 'polyline' && isClosedLine(layer)) {
      showPolygonArea(layer, true);
      showSegmentLengths(layer, true);
    } else if (layerType === 'polyline') {
      showSegmentLengths(layer, true);
    } else if (layerType === 'polygon' || layerType === 'rectangle') {
      showPolygonArea(layer, true);
      showSegmentLengths(layer, true);
    } else if (layerType === 'circle') {
      showCircleDetails(layer, true);
    } else if (layerType === 'marker') {
      // Marker real-time updates are handled natively in bindMarkerDragEvents
    }
  };

  const showSegmentLengths = (layer, isRealTime = false) => {
    if (!layer || !map || !map.hasLayer(layer)) {
      clearFeatureLabels(layer);
      return;
    }
    const latlngs = layer.getLatLngs ? layer.getLatLngs() : null;
    if (!latlngs) return;
    
    // Safely flatten coordinates for polygons/polylines (get first ring)
    let pts = latlngs;
    while (Array.isArray(pts) && Array.isArray(pts[0])) {
      pts = pts[0];
    }
    
    if (!pts || pts.length < 2) {
      clearFeatureLabels(layer);
      return;
    }

    const existingLabels = featureLabels.current.get(layer) || [];
    const isPolygon = getLayerType(layer) === 'polygon' || getLayerType(layer) === 'rectangle';

    // For polygons (and closed lines), the area box holder is at index 0, so segments start at index 1
    const offset = (isPolygon || isClosedLine(layer)) ? 1 : 0;
    let requiredSegments = pts.length - 1;
    if (isPolygon && pts.length > 2) requiredSegments += 1;

    // Check if we can just reuse existing markers (much faster during drag)
    const canReuse = isRealTime && existingLabels.length === offset + requiredSegments;
    const newLabels = canReuse ? existingLabels : existingLabels.slice(0, offset);

    if (!canReuse) {
      // Clear old segment labels from map
      for (let i = offset; i < existingLabels.length; i++) {
        if (existingLabels[i] && map.hasLayer(existingLabels[i])) {
          map.removeLayer(existingLabels[i]);
        }
      }
    }

    let currentIndex = 0;
    const addOrUpdateLabel = (latlngA, latlngB) => {
      if (!latlngA || !latlngB) return;
      const distanceInMeters = latlngA.distanceTo(latlngB);
      const distanceText = formatDistanceLabel(distanceInMeters, unitModeRef.current);
      const midpoint = L.latLng((latlngA.lat + latlngB.lat) / 2, (latlngA.lng + latlngB.lng) / 2);
      const html = `<div class="distance-label">${distanceText}</div>`;

      if (canReuse) {
        const label = existingLabels[offset + currentIndex];
        if (label) {
          label.setLatLng(midpoint);
          label.setIcon(L.divIcon({ className: 'distance-label-container', html, iconSize: [0, 0], iconAnchor: [0, 0] }));
        }
      } else {
        const label = L.marker(midpoint, {
          icon: L.divIcon({ className: 'distance-label-container', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
          interactive: false,
          pmIgnore: true,
          snapIgnore: true
        }).addTo(map);
        newLabels.push(label);
      }
      currentIndex++;
    };

    pts.forEach((latlng, index) => {
      if (index < pts.length - 1) addOrUpdateLabel(latlng, pts[index + 1]);
    });
    if (isPolygon && pts.length > 2) {
      addOrUpdateLabel(pts[pts.length - 1], pts[0]);
    }

    if (!canReuse) {
      featureLabels.current.set(layer, newLabels);
    }
  };

  const addLengthLabel = (latlngA, latlngB, map) => {
    if (!latlngA || !latlngB) return null;
    const distanceInMeters = latlngA.distanceTo(latlngB);
    const distanceText = formatDistanceLabel(distanceInMeters, unitModeRef.current);
    const midpoint = L.latLng(
      (latlngA.lat + latlngB.lat) / 2,
      (latlngA.lng + latlngB.lng) / 2
    );

    const label = L.marker(midpoint, {
      icon: L.divIcon({
        className: 'distance-label-container',
        html: `<div class="distance-label">${distanceText}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      }),
      interactive: false,
      pmIgnore: true,
      snapIgnore: true
    }).addTo(map);

    return label;
  };

  const showPolygonArea = (layer, isRealTime = false) => {
    if (!layer || !map || !map.hasLayer(layer)) {
      clearFeatureLabels(layer);
      return;
    }
    const latlngs = layer.getLatLngs ? layer.getLatLngs() : null;
    if (!latlngs) return;

    let pts = latlngs;
    while (Array.isArray(pts) && Array.isArray(pts[0])) {
      pts = pts[0];
    }

    if (!pts || pts.length < 3) {
      // Not a valid polygon (fewer than 3 points), remove area label
      const existingLabels = featureLabels.current.get(layer) || [];
      if (existingLabels.length > 0 && existingLabels[0]) {
        if (existingLabels[0]._isAreaBoxHolder) existingLabels[0].remove();
        else if (map.hasLayer(existingLabels[0])) map.removeLayer(existingLabels[0]);
        featureLabels.current.set(layer, existingLabels.slice(1));
      }
      return;
    }

    const areaInMeters = L.GeometryUtil.geodesicArea(pts);
    const areaInSquareFeet = areaInMeters * 10.7639;
    const areaLabel = formatAreaUtil(areaInSquareFeet, unitModeRef.current, areaInMeters);

    const existingLabels = featureLabels.current.get(layer) || [];
    const title = getLayerType(layer) === 'rectangle' ? 'Rectangle Area' : 'Area';
    const holder = showAreaBox(layer, title, areaLabel);

    if (isRealTime && existingLabels.length > 0 && existingLabels[0] && existingLabels[0]._isAreaBoxHolder) {
      return; // box text already updated in place
    }
    const rest = existingLabels.length > 0 && existingLabels[0] && existingLabels[0]._isAreaBoxHolder
      ? existingLabels.slice(1) : existingLabels;
    featureLabels.current.set(layer, [holder, ...rest]);
  };

  const showCircleDetails = (layer, isRealTime = false) => {
    if (!layer || !map || !map.hasLayer(layer)) {
      clearFeatureLabels(layer);
      return;
    }
    if (typeof layer.getRadius !== 'function' || typeof layer.getLatLng !== 'function') return;
    const radiusInMeters = layer.getRadius();
    if (radiusInMeters === undefined || radiusInMeters === null || isNaN(radiusInMeters)) return;
    const areaInMeters = Math.PI * Math.pow(radiusInMeters, 2);
    const areaInSquareFeet = areaInMeters * 10.7639;
    const areaLabel = formatAreaUtil(areaInSquareFeet, unitModeRef.current, areaInMeters);
    const radiusText = formatDistanceLabel(radiusInMeters, unitModeRef.current);

    const holder = showAreaBox(layer, 'Circle Area', `${areaLabel}<br><small>Radius: ${radiusText}</small>`);
    const existingLabels = featureLabels.current.get(layer) || [];
    if (isRealTime && existingLabels[0] && existingLabels[0]._isAreaBoxHolder) return;
    featureLabels.current.set(layer, [holder]);
  };

  const getLayerType = (layer) => {
    if (!layer) return null;
    if (layer.pm && layer.pm._shape) {
      const shape = layer.pm._shape.toLowerCase();
      if (shape === 'line') return 'polyline';
      return shape;
    }
    if (layer instanceof L.Polygon) return 'polygon';
    // Duck typing fallbacks if pm._shape is missing
    if (typeof layer.getRadius === 'function') return 'circle';
    if (layer.getLatLngs) {
      const latlngs = layer.getLatLngs();
      if (Array.isArray(latlngs) && Array.isArray(latlngs[0])) return 'polygon';
      return 'polyline';
    }
    if (typeof layer.getLatLng === 'function') return 'marker';
    return null;
  };

  return null;
};

export default DrawControl;
