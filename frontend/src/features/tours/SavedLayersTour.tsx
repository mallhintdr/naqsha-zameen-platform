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
      text: 'You can save your drawings (lines, areas, markers) and open them again later on any device. First something must be drawn on the map. You can keep up to 10 saved drawings.',
      target: mapEl,
      action: () => {
        closeModals();
        set({ showMenu: false });
      },
    },
    {
      title: 'Zooming to Level 19 🔍',
      text: 'We zoom in close so the example shapes are easy to see.',
      target: mapEl,
      action: () => {
        const { map } = leaflet();
        map?.flyTo(map.getCenter(), 19, { animate: true, duration: 1.2 });
        return 1200;
      },
    },
    {
      title: 'Drawing Shapes on Canvas 🎨',
      text: 'We have drawn a few example shapes: a line, an area, a rectangle and a circle.',
      target: mapEl,
      action: () => {
        drawTourShapes();
        return 1000;
      },
    },
    {
      title: 'Open Navigation Sidebar ☰',
      text: 'Saving and opening drawings is done from the menu.',
      target: () => q('.navbar-brand-custom', '.modern-sidebar'),
      avoid: sidebar,
      action: () => {
        closeModals();
        set({ showMenu: true });
      },
    },
    {
      title: 'Save Layer is Ready 💾',
      text: '"Save Layer" can now be used because there are drawings on the map.',
      target: () => q('#nav-link-save-layer', '.modern-sidebar', '.navbar-brand-custom'),
      avoid: sidebar,
      action: () => {
        closeModals();
        set({ showMenu: true });
      },
    },
    {
      title: 'Name & Save Custom Layer 📝',
      text: 'Give the drawing a name you will recognise, for example the chak and the owner\'s name, then press Save. We use "Test Layer 101" here.',
      target: () => q('#layerName') || modalEl(),
      avoid: () => modalEl(),
      action: () => {
        set({ showMenu: false, showSavedLayersModal: false, saveLayerName: 'Test Layer 101', showSaveLayerModal: true });
        return 1000;
      },
    },
    {
      title: 'Access Saved Layers Catalog 📂',
      text: 'We cleared the map. "Open Saved Layers" in the menu lists everything you have saved.',
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
      text: "The folder button opens a saved drawing on the map, with all its measurements.",
      target: () => q('#btn-open-layer-0', '.btn-open-layer') || savedModal(),
      avoid: savedModal,
      action: () => {
        set({ showMenu: false, showSaveLayerModal: false, showSavedLayersModal: true });
        return 1000;
      },
    },
    {
      title: 'Delete Saved Layer Action 🗑️',
      text: 'The bin button deletes a saved drawing for good. You are asked to confirm first.',
      target: () => q('#btn-delete-layer-0', '.btn-delete-layer') || savedModal(),
      avoid: savedModal,
      action: () => {
        set({ showMenu: false, showSaveLayerModal: false, showSavedLayersModal: true });
        return 1000;
      },
    },
    {
      title: 'Saved Layer Loaded & Rendered! 🎉',
      text: 'Your saved drawing is back on the map. The example drawing is removed when this tour ends.',
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
