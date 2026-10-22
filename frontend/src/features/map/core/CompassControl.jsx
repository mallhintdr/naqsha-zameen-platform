import React, { useEffect } from "react";
import { useMap } from './mapContext';
import L from "leaflet";
import throttle from './throttle';
import "./css/CompassControl.css";

/**
 * Enhanced & Optimized Compass Control
 * - Reflects True North relative to the map view (syncs with map rotation)
 * - Click-to-reset map rotation to North
 * - Adaptive smoothing for jitter-free device orientation
 * - Hardware-accelerated SVG needle
 */

const COMPASS_SVG_HTML = `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="compass-svg">
    <defs>
      <linearGradient id="north-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ff4b4b" />
        <stop offset="100%" stop-color="#cc0000" />
      </linearGradient>
      <linearGradient id="south-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="100%" stop-color="#94a3b8" />
      </linearGradient>
      <filter id="needle-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.25"/>
      </filter>
    </defs>
    
    <!-- Outer precision dial track (transparent to allow glassmorphism through) -->
    <circle cx="50" cy="50" r="46" fill="transparent" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
    
    <!-- Cardinal & Sub-cardinal Tick Marks -->
    <path d="M 50 2 L 50 9 M 98 50 L 91 50 M 50 98 L 50 91 M 2 50 L 9 50" stroke="rgba(0,0,0,0.5)" stroke-width="3" stroke-linecap="round"/>
    <path d="M 16 16 L 21 21 M 84 16 L 79 21 M 84 84 L 79 79 M 16 84 L 21 79" stroke="rgba(0,0,0,0.3)" stroke-width="2" stroke-linecap="round"/>

    <!-- Compass Typography -->
    <g class="compass-markers" font-family="'Inter', -apple-system, sans-serif" dominant-baseline="central" text-anchor="middle">
      <text x="50" y="22" font-size="20" font-weight="900" fill="#dc2626" style="filter: drop-shadow(0px 1px 2px rgba(255,255,255,1))">N</text>
      <text x="79" y="50" font-size="15" font-weight="800" fill="#0f172a" style="filter: drop-shadow(0px 1px 2px rgba(255,255,255,1))">E</text>
      <text x="50" y="78" font-size="15" font-weight="800" fill="#0f172a" style="filter: drop-shadow(0px 1px 2px rgba(255,255,255,1))">S</text>
      <text x="21" y="50" font-size="15" font-weight="800" fill="#0f172a" style="filter: drop-shadow(0px 1px 2px rgba(255,255,255,1))">W</text>
    </g>

    <!-- Animated Needle with mechanical spring transition -->
    <g class="compass-needle" style="will-change: transform; transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
      <!-- North Half (Red) -->
      <polygon points="50,10 44,50 56,50" fill="url(#north-gradient)" filter="url(#needle-shadow)"/>
      <!-- South Half (Silver) -->
      <polygon points="50,90 44,50 56,50" fill="url(#south-gradient)" filter="url(#needle-shadow)"/>
      
      <!-- Central Pivot Cap -->
      <circle cx="50" cy="50" r="5" fill="#334155" filter="url(#needle-shadow)"/>
      <circle cx="50" cy="50" r="2" fill="#cbd5e1" />
    </g>
  </svg>
`;

const CompassControl = L.Control.extend({
  onAdd: function (map) {
    this._map = map;
    this._isActive = false;
    this._magneticDeclination = 0;
    this._lastDeviceHeading = 0;
    this._lastMapBearing = 0;
    this._orientationHandler = null;

    const wrapper = L.DomUtil.create("div", "compass-control-wrapper");
    
    // Rotate ring
    const rotateRing = L.DomUtil.create("div", "compass-rotate-ring", wrapper);
    
    // Compass icon
    const compassDiv = L.DomUtil.create("div", "leaflet-compass-icon", wrapper);
    this._compassDiv = compassDiv;

    const accuracyBadge = L.DomUtil.create("div", "locate-accuracy-badge", wrapper);
    accuracyBadge.id = 'locate-accuracy-badge-btn';
    this._accuracyBadge = accuracyBadge;
    accuracyBadge.style.display = 'none';

    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);

    compassDiv.innerHTML = COMPASS_SVG_HTML;
    this._needle = compassDiv.querySelector('.compass-needle');

    let lastBearing = 0;
    let continuousBearing = 0;

    // Sync needle & rotate ring with map rotation using shortest-path continuous angles
    const updateNeedle = () => {
      // map.getBearing() is provided by leaflet-rotate
      const bearing = (typeof map.getBearing === 'function') ? map.getBearing() : 0;
      this._lastMapBearing = bearing;
      
      let diff = bearing - lastBearing;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      continuousBearing += diff;
      lastBearing = bearing;
      
      const rotation = this._isActive 
        ? (continuousBearing - this._lastDeviceHeading) 
        : continuousBearing;
      
      if (this._needle) {
        this._needle.style.transform = `rotate(${rotation}deg) translateZ(0)`;
      }

      // Rotate the outer ring handle so it perfectly tracks the camera orientation
      if (rotateRing) {
        rotateRing.style.transform = `rotate(${continuousBearing}deg)`;
      }

      // Show reset indicator if map is rotated
      if (Math.abs(bearing) > 0.5 || Math.abs(continuousBearing) > 0.5) {
        compassDiv.classList.add('map-rotated');
        compassDiv.title = 'Click to reset map rotation to North';
      } else {
        compassDiv.classList.remove('map-rotated');
        compassDiv.title = this._isActive ? 'Compass active - click to disable' : 'Click to enable compass';
      }
    };

    map.on('rotate move zoom', updateNeedle);
    this._updateNeedle = updateNeedle;

    // Drag-to-rotate logic for the outer ring
    let isDragging = false;
    let startAngle = 0;
    let startBearing = 0;
    let center = { x: 0, y: 0 };

    const getCenter = () => {
      const rect = wrapper.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    };

    const getAngle = (clientX, clientY) => {
      const dx = clientX - center.x;
      const dy = clientY - center.y;
      return Math.atan2(dy, dx) * (180 / Math.PI);
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      isDragging = true;
      center = getCenter();
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      startAngle = getAngle(clientX, clientY);
      
      rotateRing.classList.add('is-dragging');
      
      document.addEventListener('mousemove', onPointerMove, { passive: false });
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const currentAngle = getAngle(clientX, clientY);
      let angleDiff = currentAngle - startAngle;
      
      // Normalize angle difference to prevent violent backwards spinning 
      // when crossing the -180/180 degree boundary on the left side of the dial.
      while (angleDiff > 180) angleDiff -= 360;
      while (angleDiff < -180) angleDiff += 360;
      
      if (typeof map.setBearing === 'function') {
        const currentBearing = map.getBearing ? map.getBearing() : 0;
        // Use incremental delta. +angleDiff ensures dragging clockwise rotates map clockwise.
        map.setBearing(currentBearing + angleDiff);
      }
      
      // Reset startAngle for the next incremental move
      startAngle = currentAngle;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      rotateRing.classList.remove('is-dragging');
      
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchmove', onPointerMove);
      document.removeEventListener('touchend', onPointerUp);
    };

    rotateRing.addEventListener('mousedown', onPointerDown);
    rotateRing.addEventListener('touchstart', onPointerDown, { passive: false });

    const handleAccuracyUpdate = (e) => {
      const { accuracy, active } = e.detail;
      if (!active) { accuracyBadge.style.display = 'none'; return; }
      const feet = Math.round(accuracy * 3.28084);
      let bg, label;
      if (feet <= 50) { bg = '#16a34a'; label = 'HIGH'; }
      else if (feet <= 150) { bg = '#d97706'; label = 'MED'; }
      else { bg = '#dc2626'; label = 'LOW'; }
      accuracyBadge.style.background = bg;
      accuracyBadge.innerHTML = `<span class="lac-val">±${feet}ft</span><span class="lac-lbl">${label}</span>`;
      accuracyBadge.style.display = 'flex';
    };

    window.addEventListener('locationAccuracyUpdate', handleAccuracyUpdate);
    this._handleAccuracyUpdate = handleAccuracyUpdate;

    const getHeadingFromEvent = (evt) => {
      if (typeof evt.webkitCompassHeading === 'number' && !isNaN(evt.webkitCompassHeading)) return evt.webkitCompassHeading;
      if (typeof evt.alpha === 'number') {
        const screenAngle = (window.screen?.orientation?.angle) ?? (window.orientation ?? 0);
        return (evt.alpha - (screenAngle || 0) + 360) % 360;
      }
      return null;
    };

    const onDeviceOrientation = (evt) => {
      const raw = getHeadingFromEvent(evt);
      if (raw == null) return;
      let heading = (raw + this._magneticDeclination + 360) % 360;

      // Adaptive smoothing
      if (this._lastDeviceHeading !== 0) {
        let diff = heading - this._lastDeviceHeading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const alpha = Math.abs(diff) > 10 ? 0.3 : 0.12;
        heading = this._lastDeviceHeading + diff * alpha;
      }
      this._lastDeviceHeading = heading;
      updateNeedle();

      if (typeof evt.absolute === 'boolean' && !evt.absolute) {
        compassDiv.classList.add('compass-calibrating');
      } else {
        compassDiv.classList.remove('compass-calibrating');
      }
    };

    const fetchDeclination = async () => {
      try {
        if (!navigator.geolocation) return;
        
        // Try with high accuracy, fallback to low accuracy if timeout/failure
        const pos = await new Promise((res, rej) => 
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 4000, maximumAge: 3600000 })
        ).catch(() => null);
        
        if (!pos) return;
        const { latitude, longitude } = pos.coords;
        
        // Use a controller to abort if it takes too long
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        try {
          const res = await fetch(
            `https://api.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${latitude}&lon1=${longitude}&resultFormat=json`,
            { signal: controller.signal }
          );
          clearTimeout(timeoutId);
          
          if (res.ok) {
            const json = await res.json();
            this._magneticDeclination = json.result[0]?.declination || 0;
            return;
          }
        } catch {
          clearTimeout(timeoutId);
        }
        
        // FALLBACK: If API fails, provide a rough estimate for Pakistan region (approx +1.5 to +2.5 degrees)
        if (latitude > 23 && latitude < 38 && longitude > 60 && longitude < 80) {
          this._magneticDeclination = 2.0; 
        }
      } catch (e) {
        // Silent fail - accuracy is secondary to stability
      }
    };

    const startOrientation = async () => {
      compassDiv.classList.add('compass-loading');
      fetchDeclination().catch(() => {});
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === "function") {
        const perm = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
        if (perm !== "granted") { compassDiv.classList.remove('compass-loading'); return; }
      }
      this._isActive = true;
      this._lastDeviceHeading = 0;
      const isMobile = /Mobi|Android/i.test(navigator.userAgent);
      this._orientationHandler = throttle(onDeviceOrientation, isMobile ? 80 : 32);
      this._eventName = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(this._eventName, this._orientationHandler, true);
      compassDiv.classList.remove('compass-loading');
      compassDiv.classList.add('compass-active');
    };

    const stopOrientation = () => {
      this._isActive = false;
      if (this._orientationHandler) window.removeEventListener(this._eventName, this._orientationHandler, true);
      this._orientationHandler = null;
      compassDiv.classList.remove('compass-active', 'compass-calibrating', 'compass-loading');
      updateNeedle();
    };

    this._toggle = () => {
      // Normalize continuous bearing to the shortest angular path in [-180, 180] relative to North (0)
      let shortestBearing = ((continuousBearing % 360) + 360) % 360;
      if (shortestBearing > 180) {
        shortestBearing -= 360;
      }

      // If map is rotated, first click resets rotation smoothly to North (0°) via shortest direction
      if (Math.abs(shortestBearing) > 0.5) {
        if (typeof map.setBearing === 'function') {
          // Instantly sync continuous bearing to the shortest equivalent angle (zero visual jump)
          continuousBearing = shortestBearing;
          lastBearing = shortestBearing;
          map.setBearing(shortestBearing);

          const startAngle = shortestBearing;
          // Responsive duration (180ms - 280ms) for fast and crisp reset
          const duration = Math.min(280, Math.max(180, Math.abs(shortestBearing) * 1.3));
          const startTime = performance.now();
          const animateReset = (time) => {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            const currentAngle = startAngle * (1 - ease);
            map.setBearing(currentAngle);
            if (progress < 1) {
              requestAnimationFrame(animateReset);
            } else {
              map.setBearing(0);
              continuousBearing = 0;
              lastBearing = 0;
              updateNeedle();
            }
          };
          requestAnimationFrame(animateReset);
          return;
        }
      }
      
      if (this._isActive) stopOrientation();
      else startOrientation().catch(stopOrientation);
    };

    L.DomEvent.on(compassDiv, 'click', this._toggle);
    updateNeedle();

    return wrapper;
  },

  onRemove: function () {
    if (this._orientationHandler) window.removeEventListener(this._eventName, this._orientationHandler, true);
    window.removeEventListener('locationAccuracyUpdate', this._handleAccuracyUpdate);
    this._map.off('rotate move zoom', this._updateNeedle);
  }
});

const CompassControlComponent = () => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const control = new CompassControl({ position: "topright" });
    map.addControl(control);
    return () => map.removeControl(control);
  }, [map]);
  return null;
};

export default CompassControlComponent;

