import React, { useEffect, useState, useRef } from "react";
import { useMap } from './mapContext';
import L from "leaflet";
import "./css/LayerControl.css";
import { useAppStore } from "@/app/store";
import { SATELLITE_BASEMAPS, LIMITED_DEFAULT_BASEMAP } from "@/shared/lib/featureAccess";

const LayerControlDropdown = ({ activeLayer = "Hybrid Satellite", setActiveLayer, currentMaxZoom = 21, satelliteLocked = false }) => {
  const map = useMap();

  // Limited users (expired / preview): satellite basemaps are locked, the map uses a street basemap.
  useEffect(() => {
    if (satelliteLocked && SATELLITE_BASEMAPS.has(activeLayer)) setActiveLayer(LIMITED_DEFAULT_BASEMAP);
  }, [satelliteLocked, activeLayer, setActiveLayer]);
  // Once the account is activated (locked -> unlocked), go back to the default Google Hybrid basemap.
  const wasLocked = useRef(satelliteLocked);
  useEffect(() => {
    if (wasLocked.current && !satelliteLocked) setActiveLayer("Google Hybrid Satellite");
    wasLocked.current = satelliteLocked;
  }, [satelliteLocked, setActiveLayer]);
  const choose = (name) => {
    if (satelliteLocked && SATELLITE_BASEMAPS.has(name)) {
      useAppStore.getState().set({ subscribeFeature: "satellite" });
      return;
    }
    setActiveLayer(name);
  };

  // Store the "currently active base layer" so we can remove it before adding the next.
  const baseLayerRef = useRef(null);

  // Define your base layers as Leaflet tile layers
  const layers = {
    // Google Maps
    "Google Hybrid Satellite": L.tileLayer(
      "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      { subdomains: ["mt0", "mt1", "mt2", "mt3"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Google Satellite": L.tileLayer(
      "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      { subdomains: ["mt0", "mt1", "mt2", "mt3"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Google Streets": L.tileLayer(
      "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      { subdomains: ["mt0", "mt1", "mt2", "mt3"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Google Terrain": L.tileLayer(
      "https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
      { subdomains: ["mt0", "mt1", "mt2", "mt3"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    
    // Esri Basemaps
    "Esri World Imagery": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Esri World Topo": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Esri World Streets": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: currentMaxZoom, minZoom: 5 }
    ),

    // CartoDB (Great for data visualization)
    "Carto Light (Positron)": L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { subdomains: ["a", "b", "c", "d"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "Carto Dark (Dark Matter)": L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains: ["a", "b", "c", "d"], maxZoom: currentMaxZoom, minZoom: 5 }
    ),

    // OpenStreetMap Family
    "OpenStreetMap (Standard)": L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: currentMaxZoom, minZoom: 5 }
    ),
    "OpenTopoMap": L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 17, minZoom: 5 } // Topo map maxes out at 17
    ),
  };

  useEffect(() => {
    // 1) Remove the old base layer if it exists
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    // 2) Add the newly selected base layer
    const wanted = satelliteLocked && SATELLITE_BASEMAPS.has(activeLayer) ? LIMITED_DEFAULT_BASEMAP : activeLayer;
    const newBaseLayer = layers[wanted] || layers[satelliteLocked ? LIMITED_DEFAULT_BASEMAP : "Google Hybrid Satellite"];
    newBaseLayer.addTo(map);

    // 3) Store it in our ref
    baseLayerRef.current = newBaseLayer;

    // CLEANUP: If this component unmounts entirely, remove the current base layer
    return () => {
      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current);
      }
    };
  }, [map, activeLayer, satelliteLocked, currentMaxZoom]);

  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  });

  return (
    <div className="dropdown-container" ref={containerRef}>
      <select
        id="map-base-layer-select"
        className="dropdown-select"
        value={activeLayer}
        onChange={(e) => choose(e.target.value)}
        style={{ width: `calc(${activeLayer.length * 0.95}ch + 32px)` }}
      >
        {Object.keys(layers).map((layerName) => (
          <option key={layerName} value={layerName}>
            {satelliteLocked && SATELLITE_BASEMAPS.has(layerName) ? `🔒 ${layerName}` : layerName}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LayerControlDropdown;

