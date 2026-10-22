import { useState } from 'react';
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import TourRunner, { q, type TourStep } from './TourRunner';
import { changeTehsil, firstMouza, selectMouza } from './tourActions';

export default function MouzaMurabbaTour({ onEnd }: { onEnd: () => void }) {
  const { user, setActiveTehsil } = useAuth();
  const [hasTehsil] = useState(() => Boolean(document.getElementById('tehsil-dropdown')));

  const tehsilStep: TourStep = {
    title: 'Tehsil Selection 📍',
    text: 'We highlight the Tehsil dropdown and select the first Tehsil. This populates all authorized Mouzas (Chaks) for this region.',
    target: () => q('#tehsil-dropdown'),
    action: async () => {
      const t = user?.tehsilAccess?.[0]?.tehsil || user?.activeTehsil;
      if (t) await changeTehsil(setActiveTehsil, t);
      return 1500;
    },
  };
  const mouzaStep: TourStep = {
    title: 'Mouza (Chak) Selection 🗺️',
    text: 'Next, we highlight the Mouza dropdown and select the first Mouza. The dashboard loads vector PMTiles/GeoJSON layers onto the map with smooth flyTo animation and renders Murabba tooltips.',
    target: () => q('#mauza-dropdown'),
    action: () => {
      const m = useAppStore.getState().selectedMauza || firstMouza(user);
      if (m) selectMouza(user, m);
      return 2200;
    },
  };
  const murabbaStep: TourStep = {
    title: 'Murabba Search & Selection 🔢',
    text: 'Finally, we highlight the Murabba dropdown and select a random Murabba number. The map immediately loads its GeoJSON / Killa PMTile layer and flies directly to its boundary!',
    target: () => q('#murabba-dropdown'),
    action: () => {
      const opts = useAppStore.getState().murabbaOptions;
      let pick: any = '1';
      if (Array.isArray(opts) && opts.length > 0) {
        const item: any = opts[Math.floor(Math.random() * opts.length)];
        pick = typeof item === 'object' ? item.value || item.label || item.murabba : item;
      }
      if (pick) useAppStore.getState().set({ selectedMurabba: String(pick) });
      return 1800;
    },
  };
  const steps = hasTehsil ? [tehsilStep, mouzaStep, murabbaStep] : [mouzaStep, murabbaStep];
  return <TourRunner steps={steps} actionMode="navigate" onEnd={onEnd} />;
}
