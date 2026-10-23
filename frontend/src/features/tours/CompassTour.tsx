/** Compass and map rotation. */
import TourRunner, { q, type TourStep } from './TourRunner';
import { leaflet } from './tourActions';

const compass = () => q('.compass-control-wrapper', '.leaflet-compass-icon');
const setBearing = (deg: number) => {
  const { map } = leaflet();
  if (map && typeof map.setBearing === 'function') map.setBearing(deg);
};

export default function CompassTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Compass 🧭',
      text: 'The red needle always points north, so you know which way the map is facing.',
      target: compass,
      circle: true,
    },
    {
      title: 'Rotate the Map 🔄',
      text: 'Sometimes a field is easier to read when the map faces the way you are standing. Drag the outer ring of the compass to rotate the map. On a phone you can also drag with three fingers. We have rotated it for you.',
      target: compass,
      circle: true,
      action: () => {
        setBearing(35);
        return 900;
      },
    },
    {
      title: 'Back to North ⬆️',
      text: 'Tap the compass once and the map turns back to north. We have done it for you.',
      target: compass,
      circle: true,
      action: () => {
        setBearing(0);
        return 700;
      },
    },
    {
      title: 'Phone Compass Mode 📱',
      text: 'When the map already faces north, tapping the compass switches on your phone’s own compass, so the needle follows the direction you are holding the phone. Tap again to switch it off.',
      target: compass,
      circle: true,
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={() => setBearing(0)} />;
}
