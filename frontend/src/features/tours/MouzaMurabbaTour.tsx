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
    text: 'Start by choosing a tehsil. The next list then shows every chak (mouza) you have access to in that tehsil.',
    target: () => q('#tehsil-dropdown'),
    action: async () => {
      const t = user?.tehsilAccess?.[0]?.tehsil || user?.activeTehsil;
      if (t) await changeTehsil(setActiveTehsil, t);
      return 1500;
    },
  };
  const mouzaStep: TourStep = {
    title: 'Mouza (Chak) Selection 🗺️',
    text: 'Now choose a chak. Type a few letters to search the list. The map flies to the chak and draws every murabba in red, with its number in green.',
    target: () => q('#mauza-dropdown'),
    action: () => {
      const m = useAppStore.getState().selectedMauza || firstMouza(user);
      if (m) selectMouza(user, m);
      return 2200;
    },
  };
  const murabbaStep: TourStep = {
    title: 'Murabba Search & Selection 🔢',
    text: 'Finally, choose a murabba number. The map zooms in and shows its killas as gold dotted lines with their numbers. You can also tap any murabba on the map to open it.',
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
