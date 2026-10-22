// src/Map Component/tileStyles.js
// Centralized styling for both vector tiles and GeoJSON

export const MAP_STYLES = {
  murabba: {
    vector: {
      'fill-color': 'transparent',
      'fill-opacity': 0,
      'stroke-color': '#FF0000',
      'stroke-width': 3,
      'stroke-opacity': 1
    },
    geojson: {
      color: '#FFD700', // Golden highlight
      weight: 3,
      fillOpacity: 0,
      opacity: 1,
      fillColor: 'transparent'
    }
  },
  musteel: {
    vector: {
      'fill-color': 'transparent',
      'fill-opacity': 0,
      'stroke-color': '#FFFF00', // Bright Yellow
      'stroke-width': 2,
      'stroke-opacity': 1,
      'stroke-dasharray': [5, 5] // Dotted line style
    },
    geojson: {
      color: '#FFFF00', // Bright Yellow
      weight: 2,
      fillOpacity: 0,
      opacity: 1,
      dashArray: '5, 5', // Dotted line style
      fillColor: '#FFFF00'
    }
  },
  selected: {
    vector: {
      'fill-color': '#FF0000',
      'fill-opacity': 0.3,
      'stroke-color': '#FF0000',
      'stroke-width': 3,
      'stroke-opacity': 1
    },
    geojson: {
      color: '#FF0000',
      weight: 3,
      fillOpacity: 0.3,
      opacity: 1,
      fillColor: '#FF0000'
    }
  },
  merged: {
    vector: {
      'fill-color': 'transparent',
      'fill-opacity': 0,
      'stroke-color': '#FF0000',
      'stroke-width': 2,
      'stroke-opacity': 1
    },
    geojson: {
      color: '#FF0000',        // Red outline
      weight: 2,
      fillOpacity: 0,          // Transparent background
      opacity: 1,
      fillColor: 'transparent' // Transparent fill
    }
  }
};

export const applyVectorStyle = (layer, styleType, zoom = 15) => {
  const style = MAP_STYLES[styleType]?.vector;
  if (!style || !layer) return;

  // Apply zoom-dependent styling
  const zoomFactor = Math.max(0.5, Math.min(2, zoom / 15));

  try {
    if (layer.setStyle) {
      layer.setStyle({
        ...style,
        'stroke-width': style['stroke-width'] * zoomFactor
      });
    }
  } catch (error) {
    console.warn('Failed to apply vector style:', error);
  }
};

export const applyGeoJsonStyle = (feature, styleType, zoom = 15) => {
  const style = MAP_STYLES[styleType]?.geojson;
  if (!style) return {};

  const zoomFactor = Math.max(0.5, Math.min(2, zoom / 15));

  return {
    ...style,
    weight: style.weight * zoomFactor
  };
};

// Tooltip styles that match existing CSS
export const TOOLTIP_STYLES = {
  murabba: {
    className: 'murabba-tooltip',
    permanent: true,
    direction: 'center',
    opacity: 1
  },
  killa: {
    className: 'killa-tooltip',
    permanent: true,
    direction: 'center',
    opacity: 1
  }
};

// Dense label handling for zoom levels
export const getDenseStyle = (zoom, featureCount) => {
  const DENSE_LABEL_THRESHOLD = 400;
  const DENSE_FEATURE_THRESHOLD = 800;

  if (zoom < 12 || featureCount > DENSE_FEATURE_THRESHOLD) {
    return 'murabba-tooltip--dense';
  }

  return '';
};

export default MAP_STYLES;