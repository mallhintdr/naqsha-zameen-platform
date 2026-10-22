import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import polylabel from 'polylabel';
import { TbArrowBackUp, TbPlus, TbCheck, TbX } from 'react-icons/tb';
import { formatAreaCustomUnits, formatDistanceLabel } from './measurementUtils';
import './GuidedDrawingMode.css';

const GuidedDrawingMode = ({ forceMobileMode, unitMode = 'imperial', setUnitMode, hasDrawings = false }) => {
  const map = useMap();
  const [isActive, setIsActive] = useState(false);
  const [isNativeDrawing, setIsNativeDrawing] = useState(false);
  const [activeShape, setActiveShape] = useState(null); // 'Line', 'Polygon', 'Rectangle', 'Circle', 'Marker'
  const [points, setPoints] = useState([]);
  const [currentCenter, setCurrentCenter] = useState(null);

  // Refs for map layers and live label markers
  const previewLayerRef = useRef(null);
  const dashedLineRef = useRef(null);
  const liveLabelsRef = useRef([]);
  const unitToggleRef = useRef(null);
  const crosshairDotRef = useRef(null);   // centre dot of the crosshair (the anchor)

  // Dynamically position the units toggle button safely above the Geoman toolbar
  const updateUnitTogglePosition = useCallback(() => {
    if (!unitToggleRef.current || !map) return;
    const container = map.getContainer ? map.getContainer() : null;
    if (!container) return;

    const pmToolbar = container.querySelector('.leaflet-pm-toolbar');
    if (pmToolbar) {
      const tbRect = pmToolbar.getBoundingClientRect();
      const mapRect = container.getBoundingClientRect();
      const bottomGap = Math.round(mapRect.bottom - tbRect.top + 12);
      const leftOffset = Math.round(tbRect.left - mapRect.left + (tbRect.width / 2) - 18);
      
      unitToggleRef.current.style.bottom = `${bottomGap}px`;
      if (leftOffset > 0) {
        unitToggleRef.current.style.left = `${leftOffset}px`;
      }
    }
  }, [map]);

  // The point exactly under the crosshair. map.getCenter() uses Leaflet's cached
  // container size, which goes stale when the layout shifts (toolbar appearing,
  // panels opening when a new shape starts), putting the anchor off-centre.
  // Measuring the container itself always matches the CSS-centred crosshair.
  const crosshairLatLng = useCallback(() => {
    const el = map.getContainer();
    // Most exact: the on-screen centre of the crosshair dot itself, converted the
    // same way Leaflet converts a tap (handles any layout shift / CSS scaling).
    const dot = crosshairDotRef.current;
    if (dot && dot.isConnected) {
      const r = dot.getBoundingClientRect();
      if (r.width && r.height) {
        const size = map.getSize();
        if (size.x !== el.clientWidth || size.y !== el.clientHeight) map.invalidateSize({ animate: false, pan: false });
        return map.mouseEventToLatLng({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      }
    }
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return map.getCenter();
    const size = map.getSize();
    if (size.x !== w || size.y !== h) map.invalidateSize({ animate: false, pan: false }); // resync cache
    return map.containerPointToLatLng(L.point(w / 2, h / 2));
  }, [map]);

  // Keep Geoman's cursor marker, and the drawing line that ends on it, exactly on the
  // crosshair centre (no snapping away from it in guided mode).
  const pinHintToCrosshair = useCallback((center) => {
    try {
      Object.values(map.pm?.Draw || {}).forEach(d => {
        if (!d || !d._hintMarker || !d._hintMarker.setLatLng) return;
        d._hintMarker._snapped = false;
        d._hintMarker.setLatLng(center);
        if (typeof d._syncHintLine === 'function' && d._hintline) d._syncHintLine();
      });
    } catch (e) { /* ignore */ }
  }, [map]);

  const stopPropagation = (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
  };

  const toggleUnitMode = (e) => {
    stopPropagation(e);
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (setUnitMode) {
      setUnitMode(prev => {
        if (prev === 'imperial') return 'metric';
        if (prev === 'metric') return 'meters';
        return 'imperial';
      });
    }
  };

  const getUnitDisplay = () => {
    if (unitMode === 'metric') return { label: 'Km', class: 'metric-active', title: 'Km / Sq Km (Click for Meters / Sq Meters)' };
    if (unitMode === 'meters') return { label: 'm', class: 'meters-active', title: 'Meters / Sq Meters (Click for Feet / Acres)' };
    return { label: 'Ft', class: 'imperial-active', title: 'Feet / Acres (Click for Km / Sq Km)' };
  };

  useEffect(() => {
    updateUnitTogglePosition();
    const handleResize = () => updateUnitTogglePosition();
    window.addEventListener('resize', handleResize);
    if (map) {
      map.on('resize zoom moveend', handleResize);
      map.on('pm:globaleditmodetoggled pm:globaldragmodetoggled pm:globalrotatemodetoggled pm:drawstart pm:drawend', () => {
        setTimeout(updateUnitTogglePosition, 60);
      });
    }
    const timer = setTimeout(updateUnitTogglePosition, 250);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      if (map) {
        map.off('resize zoom moveend', handleResize);
      }
    };
  }, [map, updateUnitTogglePosition, hasDrawings, isActive]);

  useEffect(() => {
    const handleDrawStart = (e) => {
      let isMobile = forceMobileMode || false;
      if (!isMobile) {
        try {
          isMobile = window.innerWidth <= 1024 || L.Browser.mobile || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
        } catch (err) {
          isMobile = window.innerWidth <= 1024;
        }
      }
      if (isMobile && e.shape) {
        // Disable Geoman's native draw mode
        setTimeout(() => { map.pm.disableDraw(); }, 10);
        setTimeout(() => { if (map.pm.globalDrawModeEnabled && map.pm.globalDrawModeEnabled()) map.pm.disableDraw(); }, 150);
        
        // Mobile browsers resize the viewport (address bar show/hide, on-screen
        // keyboard, orientation change) without always firing an event Leaflet
        // reacts to -- its cached container size (_size), which map.getCenter()
        // is computed from, can silently drift out of sync with the real
        // on-screen box the CSS crosshair is centered in. Resync before reading center.
        map.invalidateSize({ animate: false, pan: false });
        setActiveShape(e.shape);
        setPoints([]);
        setCurrentCenter(crosshairLatLng());
        setIsActive(true);
      } else {
        setIsNativeDrawing(true);
      }
      map._isDrawing = true;
    };

    const handleDrawEnd = () => {
      setIsNativeDrawing(false);
      setTimeout(() => {
        if (!map.pm?.globalDrawModeEnabled()) {
          map._isDrawing = false;
        }
      }, 300);
    };

    map.on('pm:drawstart', handleDrawStart);
    map.on('pm:drawend', handleDrawEnd);
    map.on('pm:create', handleDrawEnd);

    return () => {
      map.off('pm:drawstart', handleDrawStart);
      map.off('pm:drawend', handleDrawEnd);
      map.off('pm:create', handleDrawEnd);
    };
  }, [map, forceMobileMode]);

  // Clear live label markers
  const clearLiveLabels = () => {
    liveLabelsRef.current.forEach(labelMarker => {
      if (map.hasLayer(labelMarker)) {
        map.removeLayer(labelMarker);
      }
    });
    liveLabelsRef.current = [];
  };

  // Update live on-map segment distance & area labels
  const updateLiveOnMapLabels = (allPts, shape, center) => {
    clearLiveLabels();

    if (!allPts || allPts.length < 1) return;

    // Helper to create distance marker matching DrawControl style
    const createDistanceMarker = (p1, p2) => {
      if (!p1 || !p2) return;
      const distM = p1.distanceTo(p2);
      const distText = formatDistanceLabel(distM, unitMode);
      const mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
      const marker = L.marker(mid, {
        icon: L.divIcon({
          className: 'distance-label-container',
          html: `<div class="distance-label">${distText}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false
      }).addTo(map);
      liveLabelsRef.current.push(marker);
    };

    // Helper to create area marker matching DrawControl style
    const createAreaMarker = (pos, areaM2) => {
      if (!pos) return;
      const areaSqFt = areaM2 * 10.7639;
      const areaLabelText = formatAreaCustomUnits(areaSqFt, unitMode, areaM2);
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: 'area-label-container',
          html: `<div class="area-label">${areaLabelText}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false
      }).addTo(map);
      liveLabelsRef.current.push(marker);
    };

    if (shape === 'Line') {
      for (let i = 0; i < allPts.length - 1; i++) {
        createDistanceMarker(allPts[i], allPts[i + 1]);
      }
    } else if (shape === 'Polygon') {
      for (let i = 0; i < allPts.length - 1; i++) {
        createDistanceMarker(allPts[i], allPts[i + 1]);
      }
      if (allPts.length >= 3) {
        // Closing segment preview back to first vertex
        createDistanceMarker(allPts[allPts.length - 1], allPts[0]);
        // Live Area label
        if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
          const areaM2 = L.GeometryUtil.geodesicArea(allPts);
          let pos = center;
          try {
            const polygonCoords = allPts.map(pt => [pt.lng, pt.lat]);
            polygonCoords.push([allPts[0].lng, allPts[0].lat]); // Close the ring for polylabel
            const visualCenter = polylabel([polygonCoords], 0.00001);
            pos = L.latLng(visualCenter[1], visualCenter[0]);
          } catch (e) {
            pos = L.latLngBounds(allPts).getCenter();
          }
          createAreaMarker(pos, areaM2);
        }
      }
    } else if (shape === 'Rectangle' && points.length > 0) {
      const sw = points[0];
      const ne = center;
      const nw = L.latLng(ne.lat, sw.lng);
      const se = L.latLng(sw.lat, ne.lng);
      createDistanceMarker(sw, nw);
      createDistanceMarker(nw, ne);
      createDistanceMarker(ne, se);
      createDistanceMarker(se, sw);

      if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
        const areaM2 = L.GeometryUtil.geodesicArea([sw, nw, ne, se]);
        const rectCenter = L.latLng((sw.lat + ne.lat) / 2, (sw.lng + ne.lng) / 2);
        createAreaMarker(rectCenter, areaM2);
      }
    } else if (shape === 'Circle' && points.length > 0) {
      const circleCenter = points[0];
      createDistanceMarker(circleCenter, center);
      const radiusM = circleCenter.distanceTo(center);
      const areaM2 = Math.PI * Math.pow(radiusM, 2);
      createAreaMarker(circleCenter, areaM2);
    }
  };

  // Handle map movement for real-time preview & metrics update
  useEffect(() => {
    if (!isActive) return;

    const updatePreview = () => {
      const center = crosshairLatLng();
      // Geoman's own cursor marker (the small anchor dot) otherwise stays where the
      // user last tapped, e.g. the draw button on the left: keep it on the crosshair.
      pinHintToCrosshair(center);
      setCurrentCenter(center);
      
      if (previewLayerRef.current && points.length > 0) {
        if (activeShape === 'Polygon' || activeShape === 'Line') {
          previewLayerRef.current.setLatLngs([...points, center]);
        } else if (activeShape === 'Rectangle') {
          previewLayerRef.current.setBounds(L.latLngBounds(points[0], center));
        } else if (activeShape === 'Circle') {
          const radius = points[0].distanceTo(center);
          previewLayerRef.current.setLatLng(points[0]);
          previewLayerRef.current.setRadius(radius);
        }
      }

      // Update dashed line (from last point to current center)
      if (dashedLineRef.current && points.length > 0) {
        const lastPoint = points[points.length - 1];
        dashedLineRef.current.setLatLngs([lastPoint, center]);
      }

      // Update on-map live labels (segment lengths & area)
      updateLiveOnMapLabels([...points, center], activeShape, center);
    };

    map.on('move', updatePreview);
    map.on('moveend', updatePreview);

    // Geoman moves its cursor marker (and the drawing line ending on it) to the
    // finger / snap point on every pointer move; put it back on the crosshair centre.
    let pinRaf = null;
    const repin = () => {
      if (pinRaf) cancelAnimationFrame(pinRaf);
      pinRaf = requestAnimationFrame(() => pinHintToCrosshair(crosshairLatLng()));
    };
    map.on('mousemove pm:snap pm:unsnap', repin);

    // Re-sync Leaflet's cached container size if the viewport chrome changes
    // mid-drawing (address bar show/hide, orientation change, on-screen
    // keyboard) so the crosshair and the placed vertex never drift apart.
    const resyncSize = () => { map.invalidateSize({ animate: false, pan: false }); updatePreview(); };
    window.addEventListener('resize', resyncSize);
    window.addEventListener('orientationchange', resyncSize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resyncSize()) : null;
    if (ro) ro.observe(map.getContainer());
    // Layout settles a moment after the new shape starts: re-sync once more then.
    const settle = setTimeout(resyncSize, 250);

    // Initial update
    updatePreview();

    return () => {
      map.off('move', updatePreview);
      map.off('moveend', updatePreview);
      map.off('mousemove pm:snap pm:unsnap', repin);
      if (pinRaf) cancelAnimationFrame(pinRaf);
      window.removeEventListener('resize', resyncSize);
      window.removeEventListener('orientationchange', resyncSize);
      if (ro) ro.disconnect();
      clearTimeout(settle);
    };
  }, [isActive, map, points, activeShape, crosshairLatLng, pinHintToCrosshair]);

  useEffect(() => {
    const el = map.getContainer();
    if (isActive) el.classList.add('guided-drawing-active');
    else el.classList.remove('guided-drawing-active');
    return () => el.classList.remove('guided-drawing-active');
  }, [isActive, map]);

  // Emit guided ruler updates for horizontal & vertical cross-screen reference lines
  useEffect(() => {
    if (!isActive) {
      window.dispatchEvent(new CustomEvent('guidedRulerUpdate', { detail: { active: false } }));
      return;
    }
    window.dispatchEvent(new CustomEvent('guidedRulerUpdate', {
      detail: {
        active: true,
        shape: activeShape
      }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('guidedRulerUpdate', { detail: { active: false } }));
    };
  }, [isActive, activeShape]);

  // Initialize/cleanup preview layers on map
  useEffect(() => {
    if (isActive) {
      if (activeShape === 'Polygon') {
        previewLayerRef.current = L.polygon([], {
          color: '#FFD700',
          weight: 2,
          opacity: 1.0,
          fillOpacity: 0.3,
          interactive: false
        }).addTo(map);
      } else if (activeShape === 'Line') {
        previewLayerRef.current = L.polyline([], {
          color: '#FF0000',
          weight: 2,
          opacity: 1.0,
          interactive: false
        }).addTo(map);
      } else if (activeShape === 'Rectangle') {
        previewLayerRef.current = L.rectangle([[0, 0], [0, 0]], {
          color: '#32CD32',
          weight: 2,
          opacity: 1.0,
          fillOpacity: 0.3,
          interactive: false
        }).addTo(map);
      } else if (activeShape === 'Circle') {
        previewLayerRef.current = L.circle([0, 0], {
          radius: 0,
          color: '#00FFFF',
          weight: 2,
          opacity: 1.0,
          fillOpacity: 0.3,
          interactive: false
        }).addTo(map);
      }

      dashedLineRef.current = L.polyline([], {
        color: activeShape === 'Line' ? '#FF0000' : '#FFD700',
        weight: 2,
        dashArray: '5, 5',
        interactive: false
      }).addTo(map);
    } else {
      if (previewLayerRef.current) {
        map.removeLayer(previewLayerRef.current);
        previewLayerRef.current = null;
      }
      if (dashedLineRef.current) {
        map.removeLayer(dashedLineRef.current);
        dashedLineRef.current = null;
      }
      clearLiveLabels();
    }

    return () => {
      if (previewLayerRef.current) map.removeLayer(previewLayerRef.current);
      if (dashedLineRef.current) map.removeLayer(dashedLineRef.current);
      clearLiveLabels();
    };
  }, [isActive, activeShape, map]);

  const handleAddVertex = () => {
    const center = crosshairLatLng();
    const newPoints = [...points, center];
    setPoints(newPoints);
    
    // Auto-finish single-point or 2-point shapes when completed
    if (activeShape === 'Marker') {
      finishDrawing([center]);
    } else if ((activeShape === 'Rectangle' || activeShape === 'Circle') && newPoints.length === 2) {
      finishDrawing(newPoints);
    }
  };

  const handleUndo = () => {
    if (points.length > 0) {
      setPoints(prev => prev.slice(0, -1));
    }
  };

  const handleCancel = () => {
    clearLiveLabels();
    setIsActive(false);
    setActiveShape(null);
    setPoints([]);
    setCurrentCenter(null);
  };

  const handleFinish = () => {
    finishDrawing(points);
  };

  const finishDrawing = (finalPoints) => {
    clearLiveLabels();

    if (!finalPoints || finalPoints.length === 0) {
      handleCancel();
      return;
    }

    let layer;
    if (activeShape === 'Polygon' && finalPoints.length >= 3) {
      layer = L.polygon(finalPoints, {
        color: '#FFD700',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3
      });
    } else if (activeShape === 'Line' && finalPoints.length >= 2) {
      layer = L.polyline(finalPoints, {
        color: '#FF0000',
        weight: 2,
        opacity: 1.0
      });
    } else if (activeShape === 'Rectangle' && finalPoints.length >= 2) {
      layer = L.rectangle([finalPoints[0], finalPoints[1]], {
        color: '#32CD32',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3
      });
    } else if (activeShape === 'Circle' && finalPoints.length >= 2) {
      const radius = finalPoints[0].distanceTo(finalPoints[1]);
      layer = L.circle(finalPoints[0], {
        radius,
        color: '#00FFFF',
        weight: 2,
        opacity: 1.0,
        fillOpacity: 0.3
      });
    } else if (activeShape === 'Marker') {
      layer = L.marker(finalPoints[0]);
    } else {
      alert(`Need more points to create a ${activeShape}`);
      return;
    }

    // Fire Geoman's pm:create event so DrawControl picks it up
    map.fire('pm:create', {
      layer: layer,
      shape: activeShape
    });

    handleCancel();
  };

  // Calculate live dynamic metrics for bottom HUD
  const getMetrics = () => {
    if (!currentCenter) return null;

    let segmentDistText = '';
    if (points.length > 0) {
      const lastPt = points[points.length - 1];
      const distM = lastPt.distanceTo(currentCenter);
      segmentDistText = formatDistanceLabel(distM, unitMode);
    }

    let totalLengthM = 0;
    let areaLabel = null;

    if (activeShape === 'Polygon' || activeShape === 'Line') {
      const allPts = [...points, currentCenter];
      for (let i = 0; i < allPts.length - 1; i++) {
        totalLengthM += allPts[i].distanceTo(allPts[i + 1]);
      }
      if (activeShape === 'Polygon' && allPts.length >= 3) {
        if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
          const areaM2 = L.GeometryUtil.geodesicArea(allPts);
          areaLabel = formatAreaCustomUnits(areaM2 * 10.7639, unitMode, areaM2);
        }
      }
    } else if (activeShape === 'Rectangle' && points.length > 0) {
      const sw = points[0];
      const ne = currentCenter;
      const nw = L.latLng(ne.lat, sw.lng);
      const se = L.latLng(sw.lat, ne.lng);
      if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
        const areaM2 = L.GeometryUtil.geodesicArea([sw, nw, ne, se]);
        areaLabel = formatAreaCustomUnits(areaM2 * 10.7639, unitMode, areaM2);
      }
    } else if (activeShape === 'Circle' && points.length > 0) {
      const radiusMeters = points[0].distanceTo(currentCenter);
      const areaM2 = Math.PI * Math.pow(radiusMeters, 2);
      areaLabel = formatAreaCustomUnits(areaM2 * 10.7639, unitMode, areaM2);
    }

    const totalLengthText = formatDistanceLabel(totalLengthM, unitMode);

    return {
      segmentDistText,
      totalLengthText,
      areaLabel
    };
  };

  const unitInfo = getUnitDisplay();

  if (!isActive) {
    const hasDrawnLayers = Boolean(
      hasDrawings || 
      (map.drawnItems && typeof map.drawnItems.getLayers === 'function' && map.drawnItems.getLayers().length > 0)
    );
    const isDrawingInitiated = isNativeDrawing;
    const shouldShowToggle = isDrawingInitiated || hasDrawnLayers;

    if (!shouldShowToggle) return null;

    return (
      <div 
        ref={node => {
          unitToggleRef.current = node;
          if (node) {
            L.DomEvent.disableClickPropagation(node);
            L.DomEvent.disableScrollPropagation(node);
            updateUnitTogglePosition();
          }
        }}
        className="circular-unit-toggle-container"
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
        onMouseUp={stopPropagation}
        onTouchStart={stopPropagation}
        onTouchEnd={stopPropagation}
        onPointerDown={stopPropagation}
        onPointerUp={stopPropagation}
      >
        <button
          className={`circular-unit-toggle-btn ${unitInfo.class}`}
          onClick={toggleUnitMode}
          title={`Current Units: ${unitInfo.title}`}
        >
          <span className="circular-unit-label">{unitInfo.label}</span>
        </button>
      </div>
    );
  }

  const metrics = getMetrics();
  const minRequiredPoints = {
    Polygon: 3,
    Line: 2,
    Rectangle: 2,
    Circle: 2,
    Marker: 1
  }[activeShape] || 2;

  return (
    <div className="guided-drawing-overlay">
      {/* Google Earth-style crosshair: a thin white ring + short tick marks
          and a small center dot, with a subtle dark halo underneath so it
          still reads clearly over bright satellite imagery. All shapes are
          centered on (20,20) in this 40x40 viewBox, matching this element's
          own CSS centering (top:50%/left:50% + translate(-50%,-50%) of the
          full-screen overlay), so the visual center this draws is exactly
          the point the map's real center (used to place the vertex) is. */}
      {/* Full-screen guide lines, drawn in this same overlay as the crosshair so they
          always pass through its centre (fading out towards the screen edges). */}
      <div className="guided-ruler-h" />
      <div className="guided-ruler-v" />

      <div className="guided-crosshair">
        <svg width="48" height="48" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Dark halo pass (contrast against light/bright terrain) */}
          <circle cx="20" cy="20" r="7" stroke="rgba(0,0,0,0.55)" strokeWidth="2.5" />
          <line x1="20" y1="9" x2="20" y2="13" stroke="rgba(0,0,0,0.55)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="20" y1="27" x2="20" y2="31" stroke="rgba(0,0,0,0.55)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="9" y1="20" x2="13" y2="20" stroke="rgba(0,0,0,0.55)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="27" y1="20" x2="31" y2="20" stroke="rgba(0,0,0,0.55)" strokeWidth="2.5" strokeLinecap="round" />

          {/* Thin white foreground (Google Earth's own crosshair styling) */}
          <circle cx="20" cy="20" r="7" stroke="#FFFFFF" strokeWidth="1.2" />
          <line x1="20" y1="9" x2="20" y2="13" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="20" y1="27" x2="20" y2="31" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="9" y1="20" x2="13" y2="20" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="27" y1="20" x2="31" y2="20" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />

          {/* Single centre dot: the exact point where the vertex is placed */}
          <circle ref={crosshairDotRef} cx="20" cy="20" r="1.5" fill="#FFFFFF" stroke="rgba(0,0,0,0.6)" strokeWidth="0.6" />
        </svg>
      </div>

      <div 
        ref={node => {
          if (node) {
            L.DomEvent.disableClickPropagation(node);
            L.DomEvent.disableScrollPropagation(node);
          }
        }}
        className="guided-controls-container"
        onClick={stopPropagation}
        onMouseDown={stopPropagation}
        onMouseUp={stopPropagation}
        onTouchStart={stopPropagation}
        onTouchEnd={stopPropagation}
        onPointerDown={stopPropagation}
        onPointerUp={stopPropagation}
      >
        {/* Compact Stylish Toolbar */}
        <div className="guided-toolbar">
          <button className="guided-btn btn-undo" onClick={handleUndo} disabled={points.length === 0} title="Undo">
            <TbArrowBackUp />
          </button>
          <button className="guided-btn btn-add" onClick={handleAddVertex} title="Add Point">
            <TbPlus />
          </button>
          <button className="guided-btn btn-finish" onClick={handleFinish} disabled={points.length < minRequiredPoints} title="Finish">
            <TbCheck />
          </button>
          <button className="guided-btn btn-cancel" onClick={handleCancel} title="Cancel">
            <TbX />
          </button>
          <button
            className={`guided-btn btn-unit-toggle ${unitInfo.class}`}
            onClick={toggleUnitMode}
            title={`Current Units: ${unitInfo.title}`}
          >
            <span className="unit-btn-text">{unitInfo.label}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuidedDrawingMode;
