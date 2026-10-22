// Small raw-Leaflet helpers for the users screens (legacy used react-leaflet; not installed here).
import { useEffect, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

export { L };

export const defaultMarkerIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Creates an OSM Leaflet map in `ref` once; destroys it on unmount. */
export function useLeafletMap(ref: RefObject<HTMLDivElement | null>, center: [number, number], zoom: number) {
  const [map, setMap] = useState<L.Map | null>(null);
  const init = useRef({ center, zoom });
  useEffect(() => {
    if (!ref.current) return undefined;
    const m = L.map(ref.current, { center: init.current.center, zoom: init.current.zoom });
    L.tileLayer(OSM_URL, { attribution: OSM_ATTR }).addTo(m);
    setMap(m);
    // container may be laid out after mount (modals / tabs)
    const t = setTimeout(() => m.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      m.remove();
      setMap(null);
    };
  }, [ref]);
  return map;
}

let heatReady: Promise<any> | null = null;
/** leaflet.heat is a UMD plugin that patches the global `L`; load it once on demand. */
export function loadHeat(): Promise<any> {
  if (!heatReady) {
    heatReady = (async () => {
      const w = window as any;
      if (!w.L) w.L = L;
      await import('leaflet.heat');
      return w.L;
    })();
  }
  return heatReady;
}

/** Adds a heat layer of [lat,lng,intensity] points (radius 25, blur 15, maxZoom 17). */
export function useHeatLayer(map: L.Map | null, points: [number, number, number][]) {
  useEffect(() => {
    if (!map || !points.length) return undefined;
    let layer: any = null;
    let alive = true;
    loadHeat().then((GL) => {
      if (!alive || !GL?.heatLayer) return;
      layer = GL.heatLayer(points, { radius: 25, blur: 15, maxZoom: 17 }).addTo(map);
    }).catch(() => {});
    return () => {
      alive = false;
      if (layer) map.removeLayer(layer);
    };
  }, [map, points]);
}
