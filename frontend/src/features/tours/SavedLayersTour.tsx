import { useRef } from 'react';
import { useAppStore } from '@/app/store';
import TourRunner, { modalEl, q, type TourStep } from './TourRunner';
import { leaflet } from './tourActions';

const set = (p: Parameters<ReturnType<typeof useAppStore.getState>['set']>[0]) => useAppStore.getState().set(p);
const closeModals = () => set({ showSaveLayerModal: false, showSavedLayersModal: false });
const mapEl = () => q('#map', '.leaflet-container', '.navbar-brand-custom');
const sidebar = () => q('.modern-sidebar');
const savedModal = () => q('.saved-layers-modal .modal-content', '.saved-layers-modal');

export default function SavedLayersTour({ onEnd }: { onEnd: () => void }) {
  const refs = useRef<any[]>([]);

  const removeTourLayers = () => {
    const { map } = leaflet();
    const g = map?.drawnItems;
    if (map && g) refs.current.forEach((l) => l && g.removeLayer(l));
    refs.current = [];
    set({ drawnLayerData: null });
  };

  const drawTourShapes = () => {
    const { L, map } = leaflet();
    if (!map || !L) return;
    const g = map.drawnItems || new L.FeatureGroup().addTo(map);
    if (!refs.current.length) {
      const c = map.getCenter();
      refs.current = [
        L.polyline([L.latLng(c.lat + 0.0003, c.lng - 0.0004), L.latLng(c.lat + 0.0005, c.lng), L.latLng(c.lat + 0.0003, c.lng + 0.0004)], { color: '#00ffff', weight: 4 }).addTo(g),
        L.polygon(
          [L.latLng(c.lat + 0.0001, c.lng + 0.0006), L.latLng(c.lat + 0.0004, c.lng + 0.0009), L.latLng(c.lat + 0.0001, c.lng + 0.0012), L.latLng(c.lat - 0.0002, c.lng + 0.0009)],
          { color: '#ffd700', fillColor: '#ffd700', fillOpacity: 0.35 },
        ).addTo(g),
        L.rectangle(L.latLngBounds(L.latLng(c.lat - 0.0005, c.lng - 0.0003), L.latLng(c.lat - 0.0002, c.lng + 0.0003)), { color: '#32cd32', fillColor: '#32cd32', fillOpacity: 0.35 }).addTo(g),
        L.circle(L.latLng(c.lat - 0.0003, c.lng - 0.0007), { radius: 35, color: '#00ffff', fillColor: '#00ffff', fillOpacity: 0.35 }).addTo(g),
      ];
    }
    // Expose features so Save Layer becomes ENABLED
    if (g.toGeoJSON) set({ drawnLayerData: g.toGeoJSON() });
  };

  const steps: TourStep[] = [
    {
      title: 'Save & Open Custom Layers Tour 💾',
      text: 'Welcome! Before saving a spatial layer, you MUST first draw vector shapes on the map canvas. Each user account can save up to 30 custom layers in database storage.',
      target: mapEl,
      action: () => {
        closeModals();
        set({ showMenu: false });
      },
    },
    {
      title: 'Zooming to Level 19 🔍',
      text: 'Zooming map camera to Level 19 for high-resolution vector precision.',
      target: mapEl,
      action: () => {
        const { map } = leaflet();
        map?.flyTo(map.getCenter(), 19, { animate: true, duration: 1.2 });
        return 1200;
      },
    },
    {
      title: 'Drawing Shapes on Canvas 🎨',
      text: 'Drawing vector shapes (Line, Polygon, Rectangle, Circle) on screen so that active spatial features exist on the map.',
      target: mapEl,
      action: () => {
        drawTourShapes();
        return 1000;
      },
    },
    {
      title: 'Open Navigation Sidebar ☰',
      text: 'Opening the navigation menu where layer management actions reside.',
      target: () => q('.navbar-brand-custom', '.modern-sidebar'),
      avoid: sidebar,
      action: () => {
        closeModals();
        set({ showMenu: true });
      },
    },
    {
      title: 'Save Layer Option ENABLED! 💾',
      text: 'Notice that "Save Layer" is now ENABLED in the sidebar menu because vector shapes exist on the map canvas!',
      target: () => q('#nav-link-save-layer', '.modern-sidebar', '.navbar-brand-custom'),
      avoid: sidebar,
      action: () => {
        closeModals();
        set({ showMenu: true });
      },
    },
    {
      title: 'Name & Save Custom Layer 📝',
      text: 'Opening the Save Layer dialog box. Entering "Test Layer 101" as the layer name. Click Save to store it in your cloud library!',
      target: () => q('#layerName') || modalEl(),
      avoid: () => modalEl(),
      action: () => {
        set({ showMenu: false, showSavedLayersModal: false, saveLayerName: 'Test Layer 101', showSaveLayerModal: true });
        return 1000;
      },
    },
    {
      title: 'Access Saved Layers Catalog 📂',
      text: 'Canvas cleared behind scenes! Re-opened sidebar menu highlighting "Saved Layers". Click to view your stored library of spatial parcels.',
      target: () => q('#nav-link-saved-layers', '.modern-sidebar', '.navbar-brand-custom'),
      avoid: sidebar,
      action: () => {
        closeModals();
        removeTourLayers();
        set({ showMenu: true });
        return 1000;
      },
    },
    {
      title: 'Open Saved Layer Action 📂',
      text: "Highlighting the OPEN action button! Clicking this folder icon loads the saved layer's vector shapes directly onto the map canvas.",
      target: () => q('#btn-open-layer-0', '.btn-open-layer') || savedModal(),
      avoid: savedModal,
      action: () => {
        set({ showMenu: false, showSaveLayerModal: false, showSavedLayersModal: true });
        return 1000;
      },
    },
    {
      title: 'Delete Saved Layer Action 🗑️',
      text: 'Highlighting the DELETE action button! Clicking this trash icon permanently removes unwanted spatial layers from your cloud storage library.',
      target: () => q('#btn-delete-layer-0', '.btn-delete-layer') || savedModal(),
      avoid: savedModal,
      action: () => {
        set({ showMenu: false, showSaveLayerModal: false, showSavedLayersModal: true });
        return 1000;
      },
    },
    {
      title: 'Saved Layer Loaded & Rendered! 🎉',
      text: 'Your custom layer has been loaded and rendered back onto the map canvas! (Canvas is purged on tour finish).',
      target: () => q('#map', '.leaflet-container'),
      action: () => {
        closeModals();
        drawTourShapes();
        return 1000;
      },
    },
  ];
  return (
    <TourRunner
      steps={steps}
      onEnd={onEnd}
      onStop={() => {
        closeModals();
        removeTourLayers();
      }}
    />
  );
}
