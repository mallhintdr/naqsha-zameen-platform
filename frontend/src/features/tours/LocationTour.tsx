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
      text: 'Welcome to the Location Tracking Tour! We highlight the GPS location control button on the map. Click Next to trigger live GPS tracking.',
      target: locBtn,
      circle: true,
      action: () => 1000,
    },
    {
      title: 'Acquiring GPS Position 🛰️',
      text: 'The app uses high-accuracy GPS to obtain your live coordinates, adds a pulsing location marker and accuracy circle, and flies to level 18.',
      target: locBtn,
      action: () => {
        (locBtn() as HTMLElement | null)?.click();
        return 2500;
      },
    },
    {
      title: 'GPS Accuracy Indicator 📊',
      text: 'Placed directly below the compass, this badge displays real-time GPS accuracy in feet (e.g. ±15ft HIGH) to confirm fix precision.',
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
