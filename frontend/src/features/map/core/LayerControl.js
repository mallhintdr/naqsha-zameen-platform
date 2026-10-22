import React, { useEffect, useState, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "./css/LayerControl.css";

const LayerControlDropdown = ({ activeLayer = "Hybrid Satellite", setActiveLayer, currentMaxZoom = 21 }) => {
  const map = useMap();

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
    const newBaseLayer = layers[activeLayer] || layers["Google Hybrid Satellite"];
    newBaseLayer.addTo(map);

    // 3) Store it in our ref
    baseLayerRef.current = newBaseLayer;

    // CLEANUP: If this component unmounts entirely, remove the current base layer
    return () => {
      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current);
      }
    };
  }, [map, activeLayer]);

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
        onChange={(e) => setActiveLayer(e.target.value)}
        style={{ width: `calc(${activeLayer.length * 0.95}ch + 32px)` }}
      >
        {Object.keys(layers).map((layerName) => (
          <option key={layerName} value={layerName}>
            {layerName}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LayerControlDropdown;

