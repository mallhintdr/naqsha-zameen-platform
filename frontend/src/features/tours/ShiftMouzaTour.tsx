import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import TourRunner, { q, type TourStep } from './TourRunner';
import { changeTehsil, firstMouza, selectMouza } from './tourActions';

const shiftModal = () => q('.shift-mouza-modal .modal-content', '.shift-mouza-modal .modal-dialog', '.shift-mouza-modal');
const click = (sel: string) => (q(sel) as HTMLElement | null)?.click();
const tourValues = (detail: any) => window.dispatchEvent(new CustomEvent('setShiftTourValues', { detail }));

export default function ShiftMouzaTour({ onEnd }: { onEnd: () => void }) {
  const { user, setActiveTehsil } = useAuth();
  const steps: TourStep[] = [
    {
      title: 'Tehsil Selection 📍',
      text: 'Welcome to the Shift Mouza Offsets Tour! We highlight the Tehsil dropdown and select the first Tehsil.',
      target: () => q('#tehsil-dropdown', '#mauza-dropdown'),
      action: async () => {
        const t = user?.tehsilAccess?.[0]?.tehsil || (user as any)?.tehsilList?.[0] || user?.activeTehsil;
        if (t) await changeTehsil(setActiveTehsil, t);
        return 1500;
      },
    },
    {
      title: 'Mouza (Chak) Selection 🗺️',
      text: 'Next, we highlight the Mouza dropdown and select the first Mouza entry. Its vector layers load onto the map.',
      target: () => q('#mauza-dropdown'),
      action: () => {
        const m = firstMouza(user) || useAppStore.getState().selectedMauza;
        if (m) selectMouza(user, m);
        return 2200;
      },
    },
    {
      title: 'Zoom to Level 17 🔍',
      text: 'The map zooms to level 17 so you can view boundary offsets clearly across the Mouza.',
      target: () => q('#map', '.leaflet-container'),
      action: () => {
        window.dispatchEvent(new CustomEvent('tourFlyToLevel', { detail: { zoom: 17, level: 17, duration: 1.5 } }));
        return 1800;
      },
    },
    {
      title: 'Open Shift Mouza Dialog 🔄',
      text: 'Now, we open the Shift Mouza adjustment form modal to configure boundary coordinate offsets.',
      target: shiftModal,
      avoid: shiftModal,
      action: () => {
        useAppStore.getState().set({ showShiftForm: true });
        return 1000;
      },
    },
    {
      title: 'Compass Direction Controls 🧭',
      text: 'Select a cardinal direction (N, S, E, or W) to push the boundaries. We click East (E) for this demo.',
      target: () => q('.shift-compass'),
      avoid: shiftModal,
      action: () => {
        tourValues({ direction: 'East' });
        click('.btn-east');
        return 800;
      },
    },
    {
      title: 'Input Distance Offset 📏',
      text: 'We input an offset distance of 50 feet into the distance parameter field.',
      target: () => q('.shift-distance-input-wrap', '.shift-distance-group'),
      avoid: shiftModal,
      action: () => {
        tourValues({ distance: '50' });
        const input = q('.shift-distance-input-wrap input') as HTMLInputElement | null;
        if (input) {
          try {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, '50');
          } catch {
            input.value = '50';
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return 800;
      },
    },
    {
      title: 'Apply Coordinate Shift 🚀',
      text: 'Click "Apply Shift" to update the database adjustments. The boundaries immediately shift by 50 feet on the map!',
      target: () => q('.shift-btn-apply'),
      avoid: shiftModal,
      action: () => {
        tourValues({ distance: '50', direction: 'East' });
        click('.shift-btn-apply');
        return 2200;
      },
    },
    {
      title: 'Reset Original Position ↺',
      text: 'Finally, click "Reset" to restore the Mouza boundaries back to their original unmodified positions.',
      target: () => q('.shift-btn-reset'),
      avoid: shiftModal,
      action: () => {
        click('.shift-btn-reset');
        return 1500;
      },
    },
  ];
  return (
    <TourRunner
      steps={steps}
      onEnd={onEnd}
      onStop={() => {
        click('.shift-btn-reset');
        window.dispatchEvent(new CustomEvent('silentResetShiftMouza'));
      }}
    />
  );
}
