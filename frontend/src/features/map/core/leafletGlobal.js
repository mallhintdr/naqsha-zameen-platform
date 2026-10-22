// Leaflet plugins used here (leaflet-rotate, Geoman) read the global `L`.
// Import this module BEFORE any of those plugins so `window.L` exists when they evaluate.
import L from 'leaflet';

if (typeof window !== 'undefined') window.L = L;

export default L;
