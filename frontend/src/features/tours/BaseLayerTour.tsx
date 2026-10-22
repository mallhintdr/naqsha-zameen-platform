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
    { title: 'Base Map Layers Tour 🗺️', text: "Let's explore how changing the base map layer updates the dashboard view. We've highlighted the selector dropdown in red." },
    { title: 'Street Map Style 🗺️', text: 'We have switched the map to the Street Map layer. This view uses vector street details, ideal for reading names and routes clearly.' },
    { title: 'Satellite Imagery Style 🛰️', text: 'Next, we switch to Satellite Imagery. This displays pure raw satellite photography of the land parcels.' },
    { title: 'Google Hybrid Satellite Style 🛰️', text: 'Finally, we switch back to Google Hybrid Satellite. This combines high-resolution satellite imagery with street outlines and place labels.' },
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
