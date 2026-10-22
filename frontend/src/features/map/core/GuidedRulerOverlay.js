import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import './css/GuidedRulerOverlay.css';

/**
 * GuidedRulerOverlay
 * 
 * Provides dynamic full-screen guided dotted crosshair lines (horizontal and vertical dotted white lines)
 * that smoothly track the active crosshair / cursor across the screen during drawing and editing
 * of Line, Polygon, and Rectangle in both Desktop/PC mode and Mobile mode.
 */
const GuidedRulerOverlay = () => {
  const map = useMap();
  const [rulerData, setRulerData] = useState({
    active: false,
    x: 0,
    y: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 1000,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  // Track active drawing & editing states
  const nativeDrawRef = useRef({
    active: false,
    shape: null,
    mouseLatLng: null
  });

  const nativeEditRef = useRef({
    active: false,
    dragLatLng: null,
    mouseLatLng: null
  });

  const guidedDrawRef = useRef({
    active: false,
    shape: null
  });

  const currentMousePtRef = useRef(null);
  const rafRef = useRef(null);

  // Compute screen line coordinates for the moving crosshair
  const computeRulerLines = useCallback(() => {
    if (!map) return;

    const container = map.getContainer();
    if (!container) return;

    const isNativeDrawing = nativeDrawRef.current.active;
    const isNativeEditing = nativeEditRef.current.active;
    // Guided crosshair on screen = guided drawing, whatever events were missed.
    // (Relying only on the guidedRulerUpdate event let the lines fall back to
    // following the finger when a second shape was started.)
    const isGuidedDrawing = container.classList.contains('guided-drawing-active') || guidedDrawRef.current.active;

    if (!isNativeDrawing && !isNativeEditing && !isGuidedDrawing) {
      setRulerData(prev => (prev.active ? { ...prev, active: false } : prev));
      return;
    }
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    let rx = null;
    let ry = null;

    // 1) Mobile Mode (Guided Drawing): Centered on the electric yellow guided crosshair
    if (isGuidedDrawing) {
      rx = Math.round(width / 2) + 0.5;
      ry = Math.round(height / 2) + 0.5;
    }
    // 2) Desktop/PC Mode (Native Geoman Drawing): Smoothly tracks the moving cursor across full screen
    else if (isNativeDrawing) {
      if (currentMousePtRef.current) {
        rx = currentMousePtRef.current.x;
        ry = currentMousePtRef.current.y;
      } else if (nativeDrawRef.current.mouseLatLng) {
        const pt = map.latLngToContainerPoint(nativeDrawRef.current.mouseLatLng);
        rx = Math.round(pt.x) + 0.5;
        ry = Math.round(pt.y) + 0.5;
      }
    }
    // 3) Native Geoman Editing Mode: Aligns directly to the vertex being edited/dragged or hovered
    else if (isNativeEditing) {
      if (nativeEditRef.current.dragLatLng) {
        // Actively dragging a vertex: lock directly to this vertex
        const pt = map.latLngToContainerPoint(nativeEditRef.current.dragLatLng);
        rx = Math.round(pt.x) + 0.5;
        ry = Math.round(pt.y) + 0.5;
      } else if (currentMousePtRef.current) {
        const mousePt = L.point(currentMousePtRef.current.x, currentMousePtRef.current.y);
        let closestVertexPt = null;
        let minDistance = 40; // 40px snap radius to lock onto vertex

        if (map.drawnItems) {
          map.drawnItems.eachLayer((layer) => {
            let isEligible = false;
            if (layer.pm && layer.pm._shape) {
              const s = layer.pm._shape.toLowerCase();
              if (['line', 'polyline', 'polygon', 'rectangle'].includes(s)) isEligible = true;
            } else if (layer instanceof L.Polygon || layer instanceof L.Polyline || layer instanceof L.Rectangle) {
              isEligible = true;
            }

            if (isEligible) {
              if (layer.pm && layer.pm._markers && layer.pm._markers.length > 0) {
                const checkMarkers = (item) => {
                  if (!item) return;
                  if (Array.isArray(item)) {
                    item.forEach(checkMarkers);
                  } else if (typeof item.getLatLng === 'function') {
                    const ll = item.getLatLng();
                    if (ll && typeof ll.lat === 'number' && typeof ll.lng === 'number') {
                      const pt = map.latLngToContainerPoint(ll);
                      const dist = mousePt.distanceTo(pt);
                      if (dist < minDistance) {
                        minDistance = dist;
                        closestVertexPt = pt;
                      }
                    }
                  }
                };
                checkMarkers(layer.pm._markers);
              } else if (typeof layer.getLatLngs === 'function') {
                const checkCoords = (coords) => {
                  if (!coords) return;
                  if (Array.isArray(coords)) {
                    coords.forEach(checkCoords);
                  } else if (typeof coords.lat === 'number' && typeof coords.lng === 'number') {
                    const pt = map.latLngToContainerPoint(coords);
                    const dist = mousePt.distanceTo(pt);
                    if (dist < minDistance) {
                      minDistance = dist;
                      closestVertexPt = pt;
                    }
                  }
                };
                checkCoords(layer.getLatLngs());
              }
            }
          });
        }

        if (closestVertexPt) {
          rx = Math.round(closestVertexPt.x) + 0.5;
          ry = Math.round(closestVertexPt.y) + 0.5;
        } else {
          rx = currentMousePtRef.current.x;
          ry = currentMousePtRef.current.y;
        }
      }
    }

    if (rx === null || ry === null) {
      setRulerData(prev => (prev.active ? { ...prev, active: false } : prev));
      return;
    }

    // Verify it is on or near screen bounds
    if (rx < -50 || rx > width + 50 || ry < -50 || ry > height + 50) {
      setRulerData(prev => (prev.active ? { ...prev, active: false } : prev));
      return;
    }

    setRulerData({
      active: true,
      x: rx,
      y: ry,
      width,
      height,
      guided: isGuidedDrawing // guided crosshair draws its own ring + dot
    });
  }, [map]);

  // Request Animation Frame throttled update
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      computeRulerLines();
    });
  }, [computeRulerLines]);

  useEffect(() => {
    if (!map) return;

    // A) Listen for Guided Drawing events dispatched from GuidedDrawingMode (Mobile mode)
    const handleGuidedRulerUpdate = (e) => {
      const { active, shape } = e.detail || {};
      const s = (shape || '').toLowerCase();
      if (active && ['line', 'polyline', 'polygon', 'rectangle'].includes(s)) {
        guidedDrawRef.current = {
          active: true,
          shape: s
        };
      } else {
        guidedDrawRef.current = { active: false, shape: null };
      }
      scheduleUpdate();
    };

    window.addEventListener('guidedRulerUpdate', handleGuidedRulerUpdate);

    // B) Listen for Native Geoman Drawing events (Desktop/PC mode)
    const handleNativeDrawStart = (e) => {
      const s = (e.shape || '').toLowerCase();
      if (['line', 'polyline', 'polygon', 'rectangle'].includes(s)) {
        nativeDrawRef.current = {
          active: true,
          shape: s,
          mouseLatLng: null
        };
        scheduleUpdate();
      }
    };

    const handleNativeDrawEnd = () => {
      nativeDrawRef.current = {
        active: false,
        shape: null,
        mouseLatLng: null
      };
      scheduleUpdate();
    };

    // C) Listen for Native Geoman Edit events
    const handleEditToggled = (e) => {
      nativeEditRef.current.active = !!e.enabled;
      nativeEditRef.current.dragLatLng = null;
      scheduleUpdate();
    };

    const handleMarkerDrag = (e) => {
      const latlng = (e.marker && typeof e.marker.getLatLng === 'function')
        ? e.marker.getLatLng()
        : (e.latlng || null);
      if (latlng) {
        nativeEditRef.current.dragLatLng = latlng;
        scheduleUpdate();
      }
    };

    const handleMarkerDragEnd = () => {
      nativeEditRef.current.dragLatLng = null;
      scheduleUpdate();
    };

    // Track mouse on container for Desktop/PC full-screen smooth lines
    const container = map.getContainer();
    let handleContainerMouseMove = null;
    if (container) {
      handleContainerMouseMove = (e) => {
        const rect = container.getBoundingClientRect();
        const x = Math.round(e.clientX - rect.left) + 0.5;
        const y = Math.round(e.clientY - rect.top) + 0.5;
        currentMousePtRef.current = { x, y };
        if (nativeDrawRef.current.active || nativeEditRef.current.active) {
          scheduleUpdate();
        }
      };
      container.addEventListener('mousemove', handleContainerMouseMove, { passive: true });
      container.addEventListener('pointermove', handleContainerMouseMove, { passive: true });
    }

    // Re-centre the lines as soon as guided drawing starts or stops (the map
    // container gets / loses the 'guided-drawing-active' class).
    const classObserver = container && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => scheduleUpdate())
      : null;
    if (classObserver) classObserver.observe(container, { attributes: true, attributeFilter: ['class'] });

    const handleMapMouseMove = (e) => {
      if (e.latlng) {
        if (nativeDrawRef.current.active) {
          nativeDrawRef.current.mouseLatLng = e.latlng;
        } else if (nativeEditRef.current.active) {
          nativeEditRef.current.mouseLatLng = e.latlng;
        }
      }
      scheduleUpdate();
    };

    // Map movement and resizing
    const handleMapTransform = () => {
      scheduleUpdate();
    };

    // Check initial Geoman state on mount
    if (map.pm) {
      if (typeof map.pm.globalDrawModeEnabled === 'function' && map.pm.globalDrawModeEnabled()) {
        const activeShape = typeof map.pm.Draw?.getActiveShape === 'function' ? map.pm.Draw.getActiveShape() : null;
        const s = (activeShape || '').toLowerCase();
        if (['line', 'polyline', 'polygon', 'rectangle'].includes(s)) {
          nativeDrawRef.current.active = true;
          nativeDrawRef.current.shape = s;
        }
      }
      if (typeof map.pm.globalEditModeEnabled === 'function' && map.pm.globalEditModeEnabled()) {
        nativeEditRef.current.active = true;
      }
      scheduleUpdate();
    }

    map.on('pm:drawstart', handleNativeDrawStart);
    map.on('pm:drawend', handleNativeDrawEnd);
    map.on('pm:create', handleNativeDrawEnd);
    map.on('pm:globaleditmodetoggled', handleEditToggled);
    map.on('pm:dragstart pm:markerdrag pm:drag', handleMarkerDrag);
    map.on('pm:dragend', handleMarkerDragEnd);
    map.on('mousemove', handleMapMouseMove);
    map.on('move zoom viewreset resize', handleMapTransform);

    return () => {
      window.removeEventListener('guidedRulerUpdate', handleGuidedRulerUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (classObserver) classObserver.disconnect();

      if (container && handleContainerMouseMove) {
        container.removeEventListener('mousemove', handleContainerMouseMove);
        container.removeEventListener('pointermove', handleContainerMouseMove);
      }

      map.off('pm:drawstart', handleNativeDrawStart);
      map.off('pm:drawend', handleNativeDrawEnd);
      map.off('pm:create', handleNativeDrawEnd);
      map.off('pm:globaleditmodetoggled', handleEditToggled);
      map.off('pm:dragstart pm:markerdrag pm:drag', handleMarkerDrag);
      map.off('pm:dragend', handleMarkerDragEnd);
      map.off('mousemove', handleMapMouseMove);
      map.off('move zoom viewreset resize', handleMapTransform);
    };
  }, [map, scheduleUpdate]);

  // Guided mode draws its own lines inside the crosshair overlay (GuidedDrawingMode),
  // so they can never drift off the crosshair ring.
  if (!rulerData.active || rulerData.guided) {
    return null;
  }

  const container = map.getContainer();
  if (!container) return null;

  const { x: cx, y: cy, width: w, height: h } = rulerData;
  const RING_R = 5.4;
  const RING_GAP = RING_R + 1;

  return ReactDOM.createPortal(
    <svg
      className="guided-ruler-overlay-container"
      width={w}
      height={h}
    >
      {/* Fade: solid at the cursor, transparent towards the screen edges */}
      <defs>
        <linearGradient id="ruler-fade-h" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={w} y2={0}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset={Math.min(Math.max(cx / w, 0), 1)} stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ruler-fade-v" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={h}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset={Math.min(Math.max(cy / h, 0), 1)} stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Horizontal / vertical dotted lines tracking the cursor; they stop at the
          ring so only the centre dot shows inside it */}
      <line x1={0} y1={cy} x2={cx - RING_GAP} y2={cy} className="guided-ruler-line" style={{ stroke: 'url(#ruler-fade-h)' }} />
      <line x1={cx + RING_GAP} y1={cy} x2={w} y2={cy} className="guided-ruler-line" style={{ stroke: 'url(#ruler-fade-h)' }} />
      <line x1={cx} y1={0} x2={cx} y2={cy - RING_GAP} className="guided-ruler-line" style={{ stroke: 'url(#ruler-fade-v)' }} />
      <line x1={cx} y1={cy + RING_GAP} x2={cx} y2={h} className="guided-ruler-line" style={{ stroke: 'url(#ruler-fade-v)' }} />

      {/* Target vertex indicator ring at the cursor, with a centre dot */}
      <circle cx={cx} cy={cy} r={RING_R} className="guided-ruler-intersection" />
      <circle cx={cx} cy={cy} r="1.5" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.6" />
    </svg>,
    container
  );
};

export default GuidedRulerOverlay;
