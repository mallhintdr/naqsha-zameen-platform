import { useAppStore } from '@/app/store';
import TourRunner, { q, type TourStep } from './TourRunner';

const LAYERS = ['Google Hybrid Satellite', 'Google Streets', 'Google Satellite', 'Google Hybrid Satellite'];

function apply(layer: string) {
  useAppStore.getState().set({ baseLayer: layer });
  const sel = document.getElementById('map-base-layer-select') as HTMLSelectElement | null;
  if (sel) sel.value = layer;
}

export default function BaseLayerTour({ onEnd }: { onEnd: () => void }) {
  const target = () => q('#map-base-layer-select');
  const content = [
    { title: 'Base Map Layers Tour 🗺️', text: "This list, at the bottom right, changes the map background under your land boundaries. Watch the map change as we try a few." },
    { title: 'Street Map Style 🗺️', text: 'Street Map: roads, towns and place names are easy to read. Useful for finding your way to a field.' },
    { title: 'Satellite Imagery Style 🛰️', text: 'Satellite: a clear photo of the ground with no labels, best for seeing crops, buildings and field edges.' },
    { title: 'Google Hybrid Satellite Style 🛰️', text: 'Google Hybrid Satellite (the default): the satellite photo with road and place names on top. Your choice stays until you change it.' },
  ];
  const steps: TourStep[] = content.map((c, i) => ({
    ...c,
    target,
    action: () => {
      apply(LAYERS[i]);
      return 1000;
    },
  }));
  return <TourRunner steps={steps} actionMode="navigate" onEnd={onEnd} onStop={() => apply('Google Hybrid Satellite')} />;
}
