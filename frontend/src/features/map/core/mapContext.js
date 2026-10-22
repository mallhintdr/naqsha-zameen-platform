// Replaces react-leaflet's MapContainer context: MapPage creates the Leaflet map
// imperatively and provides it here; the ported controls keep calling useMap().
import { createContext, useContext } from 'react';

export const MapContext = createContext(null);

export const useMap = () => useContext(MapContext);
