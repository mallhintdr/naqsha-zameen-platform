// Ported from legacy src/utils/locationUtils.js
// src/utils/locationUtils.js
// Shared location utilities for coordinate formatting, validation, and calculations

/**
 * Pakistan geographic bounds for validation
 */
export const PAKISTAN_BOUNDS = {
  north: 37.1,
  south: 23.6,
  east: 77.8,
  west: 60.8
};

/**
 * Validate if coordinates are within valid range
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export const validateCoordinates = (lat, lng) => {
  return !isNaN(lat) && !isNaN(lng) && 
         lat >= -90 && lat <= 90 && 
         lng >= -180 && lng <= 180;
};

/**
 * Check if coordinates are within Pakistan bounds
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export const isInPakistan = (lat, lng) => {
  return lat >= PAKISTAN_BOUNDS.south && 
         lat <= PAKISTAN_BOUNDS.north &&
         lng >= PAKISTAN_BOUNDS.west && 
         lng <= PAKISTAN_BOUNDS.east;
};

/**
 * Convert decimal degrees to DMS (Degrees Minutes Seconds)
 * @param {number} decimal - Decimal degree value
 * @param {boolean} isLatitude - True for latitude, false for longitude
 * @returns {string} DMS formatted string
 */
export const decimalToDMS = (decimal, isLatitude) => {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutesDecimal = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesDecimal);
  const seconds = ((minutesDecimal - minutes) * 60).toFixed(2);
  
  const direction = isLatitude 
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W');
  
  return `${degrees}°${minutes}'${seconds}"${direction}`;
};

/**
 * Convert DMS string to decimal degrees
 * @param {string} dms - DMS formatted string (e.g., "31°31'13.4"N" or "31 31 13.4 N")
 * @returns {number|null} Decimal degree value or null if invalid
 */
export const dmsToDecimal = (dms) => {
  // Match various DMS formats
  const patterns = [
    /(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["\s]*([NSEW])/i,
    /(\d+)[°]+(\d+)[']+(\d+(?:\.\d+)?)["]?([NSEW])/i,
    /(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([NSEW])/i
  ];
  
  for (const pattern of patterns) {
    const match = dms.match(pattern);
    if (match) {
      const degrees = parseFloat(match[1]);
      const minutes = parseFloat(match[2]);
      const seconds = parseFloat(match[3]);
      const direction = match[4].toUpperCase();
      
      let decimal = degrees + minutes / 60 + seconds / 3600;
      
      if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
      }
      
      return decimal;
    }
  }
  
  return null;
};

/**
 * Format coordinates in various formats
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} format - 'decimal', 'dms', 'compact'
 * @returns {string} Formatted coordinate string
 */
export const formatCoordinates = (lat, lng, format = 'decimal') => {
  switch (format) {
    case 'dms':
      return `${decimalToDMS(lat, true)} ${decimalToDMS(lng, false)}`;
    case 'compact':
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    case 'decimal':
    default:
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
};

/**
 * Parse coordinate string in multiple formats
 * @param {string} input - Coordinate string (comma-separated, DMS, etc.)
 * @returns {{lat: number, lng: number}|null} Parsed coordinates or null
 */
export const parseCoordinateString = (input) => {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim();
  
  // Try comma-separated decimal format first (most common)
  const decimalMatch = trimmed.match(/^([-+]?\d+\.?\d*)\s*,\s*([-+]?\d+\.?\d*)$/);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lng = parseFloat(decimalMatch[2]);
    if (validateCoordinates(lat, lng)) {
      return { lat, lng };
    }
  }
  
  // Try DMS format
  const dmsMatch = trimmed.match(/^(.+?)\s+(.+)$/);
  if (dmsMatch) {
    const lat = dmsToDecimal(dmsMatch[1]);
    const lng = dmsToDecimal(dmsMatch[2]);
    if (lat !== null && lng !== null && validateCoordinates(lat, lng)) {
      return { lat, lng };
    }
  }
  
  return null;
};

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - First point latitude
 * @param {number} lon1 - First point longitude
 * @param {number} lat2 - Second point latitude
 * @param {number} lon2 - Second point longitude
 * @returns {number} Distance in kilometers
 */
export const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Convert degrees to radians
 * @param {number} degrees
 * @returns {number}
 */
const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Format distance for display
 * @param {number} km - Distance in kilometers
 * @returns {string} Formatted distance string
 */
export const formatDistance = (km) => {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  } else if (km < 10) {
    return `${km.toFixed(2)} km`;
  } else {
    return `${Math.round(km)} km`;
  }
};

/**
 * Calculate total distance traveled across multiple locations
 * @param {Array} locations - Array of location objects with latitude/longitude
 * @returns {number} Total distance in kilometers
 */
export const calculateTotalDistance = (locations) => {
  if (!Array.isArray(locations) || locations.length < 2) return 0;
  
  let total = 0;
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1];
    const curr = locations[i];
    
    const lat1 = prev.latitude || prev.lat;
    const lon1 = prev.longitude || prev.lng || prev.lon;
    const lat2 = curr.latitude || curr.lat;
    const lon2 = curr.longitude || curr.lng || curr.lon;
    
    if (lat1 && lon1 && lat2 && lon2) {
      total += haversineDistance(lat1, lon1, lat2, lon2);
    }
  }
  
  return total;
};

/**
 * Get GPS accuracy level and styling
 * @param {number} accuracy - Accuracy in meters
 * @returns {{level: string, color: string, label: string, description: string}}
 */
export const getLocationAccuracyLevel = (accuracy) => {
  if (accuracy < 10) {
    return { 
      level: 'excellent', 
      color: '#10b981', // green
      label: 'Excellent', 
      description: 'GPS lock with high precision'
    };
  } else if (accuracy < 20) {
    return { 
      level: 'high', 
      color: '#3b82f6', // blue
      label: 'High', 
      description: 'Good GPS signal'
    };
  } else if (accuracy < 50) {
    return { 
      level: 'medium', 
      color: '#f59e0b', // amber
      label: 'Medium', 
      description: 'Fair GPS signal'
    };
  } else if (accuracy < 100) {
    return { 
      level: 'low', 
      color: '#ef4444', // red
      label: 'Low', 
      description: 'Weak GPS signal'
    };
  } else {
    return { 
      level: 'poor', 
      color: '#9ca3af', // gray
      label: 'Poor', 
      description: 'Very weak or no GPS'
    };
  }
};

/**
 * Smooth GPS location using weighted average (simple Kalman-like filter)
 * @param {Object} newPos - New position {latitude, longitude, accuracy}
 * @param {Object} prevPos - Previous smoothed position
 * @returns {Object} Smoothed position
 */
export const smoothGPSLocation = (newPos, prevPos) => {
  if (!prevPos) return newPos;
  
  // Weight based on accuracy: better accuracy = higher weight
  // Lower accuracy (higher meters) = lower weight
  const weight = Math.min(newPos.accuracy / 50, 0.7);
  
  return {
    latitude: prevPos.latitude * (1 - weight) + newPos.latitude * weight,
    longitude: prevPos.longitude * (1 - weight) + newPos.longitude * weight,
    accuracy: Math.min(prevPos.accuracy, newPos.accuracy)
  };
};

/**
 * Detect suspicious location changes (impossible travel)
 * @param {Object} from - Previous location with timestamp
 * @param {Object} to - Current location with timestamp
 * @returns {{suspicious: boolean, reason: string, speed: number}|null}
 */
export const detectSuspiciousTravel = (from, to) => {
  if (!from || !to) return null;
  
  const lat1 = from.latitude || from.lat;
  const lon1 = from.longitude || from.lng || from.lon;
  const lat2 = to.latitude || to.lat;
  const lon2 = to.longitude || to.lng || to.lon;
  
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  
  const distance = haversineDistance(lat1, lon1, lat2, lon2);
  const timeFrom = new Date(from.timestamp || from.loginTime);
  const timeTo = new Date(to.timestamp || to.loginTime);
  const timeDiffMinutes = (timeTo - timeFrom) / 1000 / 60;
  
  if (timeDiffMinutes <= 0) return null;
  
  const speedKmh = (distance / timeDiffMinutes) * 60;
  
  // Check for impossible travel speeds
  // Commercial airplane: ~900 km/h max
  // Consider >1000 km/h as impossible
  if (speedKmh > 1000) {
    return {
      suspicious: true,
      reason: 'Impossible travel speed (faster than airplane)',
      speed: speedKmh,
      distance,
      timeDiffMinutes
    };
  }
  
  // Check for unlikely travel (>500 km in <30 minutes)
  if (distance > 500 && timeDiffMinutes < 30) {
    return {
      suspicious: true,
      reason: 'Unlikely rapid long-distance travel',
      speed: speedKmh,
      distance,
      timeDiffMinutes
    };
  }
  
  return {
    suspicious: false,
    speed: speedKmh,
    distance,
    timeDiffMinutes
  };
};

/**
 * Calculate center point (centroid) of multiple locations
 * @param {Array} locations - Array of location objects
 * @returns {{lat: number, lng: number}|null}
 */
export const calculateCentroid = (locations) => {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;
  
  locations.forEach(loc => {
    const lat = loc.latitude || loc.lat;
    const lng = loc.longitude || loc.lng || loc.lon;
    
    if (lat && lng) {
      sumLat += lat;
      sumLng += lng;
      count++;
    }
  });
  
  if (count === 0) return null;
  
  return {
    lat: sumLat / count,
    lng: sumLng / count
  };
};

/**
 * Get bounds (bounding box) for multiple locations
 * @param {Array} locations - Array of location objects
 * @returns {{north: number, south: number, east: number, west: number}|null}
 */
export const getLocationBounds = (locations) => {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  
  let north = -90, south = 90, east = -180, west = 180;
  
  locations.forEach(loc => {
    const lat = loc.latitude || loc.lat;
    const lng = loc.longitude || loc.lng || loc.lon;
    
    if (lat && lng) {
      north = Math.max(north, lat);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      west = Math.min(west, lng);
    }
  });
  
  if (north === -90 && south === 90) return null;
  
  return { north, south, east, west };
};

/**
 * Major cities in Pakistan as quick navigation presets
 */
export const PAKISTAN_CITIES = [
  { name: 'Lahore', lat: 31.5204, lng: 74.3587, zoom: 11 },
  { name: 'Karachi', lat: 24.8607, lng: 67.0011, zoom: 11 },
  { name: 'Islamabad', lat: 33.6844, lng: 73.0479, zoom: 11 },
  { name: 'Rawalpindi', lat: 33.5651, lng: 73.0169, zoom: 12 },
  { name: 'Faisalabad', lat: 31.4504, lng: 73.1350, zoom: 11 },
  { name: 'Multan', lat: 30.1575, lng: 71.5249, zoom: 11 },
  { name: 'Peshawar', lat: 34.0151, lng: 71.5249, zoom: 11 },
  { name: 'Quetta', lat: 30.1798, lng: 66.9750, zoom: 11 },
  { name: 'Sialkot', lat: 32.4945, lng: 74.5229, zoom: 12 },
  { name: 'Gujranwala', lat: 32.1617, lng: 74.1883, zoom: 12 },
  { name: 'Pakistan Center', lat: 30.3753, lng: 69.3451, zoom: 5 }
];

/**
 * Local storage helpers for recent locations
 */
export const LocationStorage = {
  KEY: 'recentLocations',
  MAX_ITEMS: 10,
  
  getRecent: () => {
    try {
      const stored = localStorage.getItem(LocationStorage.KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },
  
  addRecent: (lat, lng, label = null) => {
    try {
      const recent = LocationStorage.getRecent();
      const newItem = {
        lat,
        lng,
        label: label || formatCoordinates(lat, lng, 'compact'),
        timestamp: new Date().toISOString()
      };
      
      // Remove duplicates (within 0.001 degree tolerance)
      const filtered = recent.filter(item => 
        Math.abs(item.lat - lat) > 0.001 || Math.abs(item.lng - lng) > 0.001
      );
      
      // Add new item at the beginning
      filtered.unshift(newItem);
      
      // Keep only MAX_ITEMS
      const trimmed = filtered.slice(0, LocationStorage.MAX_ITEMS);
      
      localStorage.setItem(LocationStorage.KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      return [];
    }
  },
  
  clearRecent: () => {
    try {
      localStorage.removeItem(LocationStorage.KEY);
    } catch {
      // Silent fail
    }
  }
};

export default {
  validateCoordinates,
  isInPakistan,
  decimalToDMS,
  dmsToDecimal,
  formatCoordinates,
  parseCoordinateString,
  haversineDistance,
  formatDistance,
  calculateTotalDistance,
  getLocationAccuracyLevel,
  smoothGPSLocation,
  detectSuspiciousTravel,
  calculateCentroid,
  getLocationBounds,
  PAKISTAN_BOUNDS,
  PAKISTAN_CITIES,
  LocationStorage
};
