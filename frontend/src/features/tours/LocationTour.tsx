import TourRunner, { q, type TourStep } from './TourRunner';

const locBtn = () => q('#leaflet-location-control-btn', '.leaflet-location-icon');
const badge = () => {
  const el = q('#locate-accuracy-badge-btn', '.locate-accuracy-badge') as HTMLElement | null;
  if (el && el.style.display === 'none') el.style.display = 'flex';
  return el;
};

export default function LocationTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Live Location Tracking 🎯',
      text: 'This button shows where you are standing on the killa map. Press Next and we will switch it on. Your browser may ask for permission to use your location.',
      target: locBtn,
      circle: true,
      action: () => 1000,
    },
    {
      title: 'Acquiring GPS Position 🛰️',
      text: 'A blinking red dot marks your position and the blue circle shows how precise it is. The map follows you as you walk. Tap the button again to stop.',
      target: locBtn,
      action: () => {
        (locBtn() as HTMLElement | null)?.click();
        return 2500;
      },
    },
    {
      title: 'GPS Accuracy Indicator 📊',
      text: 'Below the compass, this badge shows the GPS accuracy in feet (for example ±15ft HIGH). Out in open fields it is usually best; near buildings and trees it may be lower.',
      target: () => badge() || locBtn(),
      circle: true,
      action: () => {
        window.dispatchEvent(new CustomEvent('locationAccuracyUpdate', { detail: { accuracy: 5, active: true } }));
        return 800;
      },
    },
  ];
  return <TourRunner steps={steps} actionMode="navigate" onEnd={onEnd} />;
}
