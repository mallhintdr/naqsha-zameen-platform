/** Reading a killa: select a murabba, tap a killa, read its area and karam side lengths. */
import { useAuth } from '@/features/auth/AuthProvider';
import TourRunner, { q, type TourStep } from './TourRunner';
import { ensureMouza, ensureMurabba, openKillaNearCentre, wait, waitFor } from './tourHelpers';
import { leaflet } from './tourActions';

const mapEl = () => q('.leaflet-container');
const areaBox = () => q('.killa-area-info-box');

export default function KillaTour({ onEnd }: { onEnd: () => void }) {
  const { user } = useAuth();

  const steps: TourStep[] = [
    {
      title: 'Killa Details 🌾',
      text: 'This tour shows how to find a killa and read its area and side lengths. We will open a chak for you first.',
      target: () => q('#mauza-dropdown'),
      action: async () => {
        await ensureMouza(user);
        return 2500;
      },
    },
    {
      title: 'Open a Murabba 🔢',
      text: 'Choosing a murabba zooms in and draws its killas: gold dotted lines, with the killa number inside each one. Murabba numbers are shown in green.',
      target: () => q('#murabba-dropdown'),
      action: async () => {
        await ensureMurabba();
        await waitFor(() => (leaflet().map?.getZoom?.() || 0) >= 16, 10000);
        await wait(2500);
        return 500;
      },
    },
    {
      title: 'Tap a Killa 👆',
      text: 'Tap inside any killa. It turns green and shows its details. We have tapped one near the centre of the map for you.',
      target: mapEl,
      action: async () => {
        await openKillaNearCentre();
        return 600;
      },
      placeTop: () => 70,
    },
    {
      title: 'Area in Acre, Kanal and Marla 📐',
      text: 'This box shows the killa area, for example 1A - 0K - 0M (acre, kanal, marla). The small labels on each side give the side length in karams.',
      target: () => areaBox() || mapEl(),
      avoid: areaBox,
    },
    {
      title: 'Clear the Selection ✖️',
      text: 'Tap the same killa again, tap elsewhere on the map, or press the × on the box to clear it. That is all there is to it.',
      target: () => q('.killa-area-close-btn') || areaBox() || mapEl(),
      circle: true,
      avoid: areaBox,
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} />;
}
