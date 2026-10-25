// src/Map Component/LocateControl.js

import React, { useEffect } from 'react';
import { useMap } from './mapContext';
import L from 'leaflet';
import { dialogs } from '@/shared/ui';
import locationIcon from './images/location.png';
import './css/LocateControl.css';
import { useAppStore } from '@/app/store';
import { isTilesOnly } from '@/features/map/config/pmtiles';

/**
 * LocateControl with toggle functionality:
 * - Clicking the button starts tracking and shows the user's live location.
 * - Clicking again stops tracking and removes the location marker.
 */

const LocateControl = L.Control.extend({
  onAdd: function (map) {
    this._userMarker = null;
    this._accuracyCircle = null;
    this._watchId = null;
    this._intervalId = null;
    this._hasZoomedToLocation = false;
    this._locatingMessage = null;

    const button = L.DomUtil.create('button', 'leaflet-location-icon');
    button.id = 'leaflet-location-control-btn';
    button.title = 'Track My Live Location';
    button.style.backgroundImage = `url('${locationIcon}')`;

    const calculateAverageLocation = (locations) => {
      const total = locations.reduce(
        (acc, loc) => ({
          latitude: acc.latitude + loc.latitude,
          longitude: acc.longitude + loc.longitude,
          accuracy: acc.accuracy + loc.accuracy,
        }),
        { latitude: 0, longitude: 0, accuracy: 0 }
      );
      const count = locations.length;
      return {
        latitude: total.latitude / count,
        longitude: total.longitude / count,
        accuracy: total.accuracy / count,
      };
    };

    const dispatchAccuracyEvent = (accuracy) => {
      window.dispatchEvent(new CustomEvent('locationAccuracyUpdate', { 
        detail: { accuracy, active: true } 
      }));
    };

    const updateLocationDisplay = (latitude, longitude, accuracy) => {
      if (this._userMarker) {
        this._userMarker.setLatLng([latitude, longitude]);
      } else {
        const blinkingCircle = L.divIcon({
          className: 'blinking-location',
          html: `<div class="blinking-circle"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        this._userMarker = L.marker([latitude, longitude], {
          icon: blinkingCircle,
        }).addTo(map);
      }

      if (this._accuracyCircle) {
        this._accuracyCircle.setLatLng([latitude, longitude]);
        this._accuracyCircle.setRadius(accuracy);
      } else {
        this._accuracyCircle = L.circle([latitude, longitude], {
          radius: accuracy,
          className: 'leaflet-accuracy-circle',
        }).addTo(map);
      }

      // Dispatch accuracy event to be caught by CompassControl
      dispatchAccuracyEvent(accuracy);

      if (!this._hasZoomedToLocation) {
        map.flyTo([latitude, longitude], 18, {
          animate: true,
          duration: 2
        });
        this._hasZoomedToLocation = true;
      }
    };

    let locationBuffer = [];

    const startTracking = () => {
      if (!('geolocation' in navigator)) {
        dialogs.alert('Geolocation is not supported by your browser.');
        return;
      }

      if (!this._locatingMessage) {
        this._locatingMessage = L.DomUtil.create('div', 'locating-message', map._container);
        this._locatingMessage.innerText = 'Acquiring location…';
      }

      const onLocationSuccess = (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        locationBuffer.push({ latitude, longitude, accuracy });

        if (this._locatingMessage) {
          try {
            if (this._locatingMessage.parentNode) {
              this._locatingMessage.parentNode.removeChild(this._locatingMessage);
            }
          } catch (e) {}
          this._locatingMessage = null;
        }

        updateLocationDisplay(latitude, longitude, accuracy);

        if (locationBuffer.length > 50) {
          locationBuffer.shift();
        }
      };

      // Tier 1: Immediate quick check (cached or network fix) for fast initial rendering
      navigator.geolocation.getCurrentPosition(
        onLocationSuccess,
        (err) => {
          console.warn('Quick initial location check skipped:', err?.message);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
      );

      const startLowAccuracyWatch = () => {
        if (this._watchId !== null) {
          try { navigator.geolocation.clearWatch(this._watchId); } catch (e) {}
        }
        this._watchId = navigator.geolocation.watchPosition(
          onLocationSuccess,
          (finalError) => {
            console.error('Final location error:', finalError?.message);
            if (this._locatingMessage) {
              try {
                if (this._locatingMessage.parentNode) {
                  this._locatingMessage.parentNode.removeChild(this._locatingMessage);
                }
              } catch (e) {}
              this._locatingMessage = null;
            }

            if (finalError?.code === 1) {
              dialogs.alert('Location permission denied. Please allow location access in your browser settings.');
            } else if (!this._hasZoomedToLocation && locationBuffer.length === 0) {
              dialogs.alert('Unable to retrieve location. Please check if device GPS / Location is turned on and try again.');
            }
            stopTracking();
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 }
        );
      };

      const onHighAccuracyError = (error) => {
        console.warn('High accuracy location timeout/error:', error?.message);
        if (error?.code === 1) { // Permission Denied
          if (this._locatingMessage) {
            try {
              if (this._locatingMessage.parentNode) {
                this._locatingMessage.parentNode.removeChild(this._locatingMessage);
              }
            } catch (e) {}
            this._locatingMessage = null;
          }
          dialogs.alert('Location permission denied. Please allow location access in your browser settings.');
          stopTracking();
          return;
        }

        // Tier 2 Fallback: Try cached/network single fix before starting low accuracy watch
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onLocationSuccess(pos);
            startLowAccuracyWatch();
          },
          () => {
            startLowAccuracyWatch();
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
        );
      };

      // Tier 3: Start High Accuracy watch with 15s timeout and 5s maximumAge
      this._watchId = navigator.geolocation.watchPosition(
        onLocationSuccess,
        onHighAccuracyError,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );

      this._intervalId = setInterval(() => {
        if (locationBuffer.length === 0) return;
        const { latitude, longitude, accuracy } = calculateAverageLocation(locationBuffer);
        updateLocationDisplay(latitude, longitude, accuracy);
        locationBuffer = [];
      }, 5000);
    };

    const stopTracking = () => {
      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
      }
      if (this._intervalId !== null) {
        clearInterval(this._intervalId);
        this._intervalId = null;
      }
      locationBuffer = [];
      if (this._userMarker) {
        map.removeLayer(this._userMarker);
        this._userMarker = null;
      }
      if (this._accuracyCircle) {
        map.removeLayer(this._accuracyCircle);
        this._accuracyCircle = null;
      }
      if (this._locatingMessage) {
        map._container.removeChild(this._locatingMessage);
        this._locatingMessage = null;
      }
      
      // Notify accuracy badge to hide
      window.dispatchEvent(new CustomEvent('locationAccuracyUpdate', { 
        detail: { active: false } 
      }));

      this._hasZoomedToLocation = false;
      L.DomUtil.removeClass(button, 'leaflet-location-icon-active');
      button.title = 'Track My Live Location';
    };

    this._stopTracking = stopTracking;

    const onButtonClick = () => {
      // Limited users (expired / preview): live location needs a subscription.
      if (this._watchId === null && isTilesOnly()) {
        useAppStore.getState().set({ subscribeFeature: 'live-location' });
        return;
      }
      if (this._watchId === null) {
        this._hasZoomedToLocation = false;
        L.DomUtil.addClass(button, 'leaflet-location-icon-active');
        button.title = 'Locating…';
        startTracking();
      } else {
        stopTracking();
      }
    };

    L.DomEvent.on(button, 'click', onButtonClick);

    return button;
  },

  onRemove: function (map) {
    if (this._stopTracking) {
      this._stopTracking();
    }
  },
});

const LocateControlComponent = () => {
  const map = useMap();
  useEffect(() => {
    const control = new LocateControl({ position: 'topleft' });
    map.addControl(control);
    return () => {
      map.removeControl(control);
    };
  }, [map]);

  return null;
};

export default LocateControlComponent;
