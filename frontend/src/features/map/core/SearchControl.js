import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import './css/SearchControl.css';

const SearchControl = L.Control.extend({
  options: {
    onSearchClick: null
  },
  onAdd: function (map) {
    const container = L.DomUtil.create('div', 'leaflet-search-container');

    const button = L.DomUtil.create('button', 'search-btn', container);
    button.innerHTML = '🔍';
    button.title = 'Go to coordinates';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof this.options.onSearchClick === 'function') {
        this.options.onSearchClick();
      }
    });

    L.DomEvent.disableClickPropagation(container);
    return container;
  },
});

const SearchControlComponent = ({ onSearchClick }) => {
  const map = useMap();
  useEffect(() => {
    const control = new SearchControl({
      position: 'topleft',
      onSearchClick
    });
    map.addControl(control);
    return () => {
      map.removeControl(control);
    };
  }, [map, onSearchClick]);
  return null;
};

export default SearchControlComponent;

