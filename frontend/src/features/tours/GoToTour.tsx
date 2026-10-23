/** Go to coordinates: open the form, enter a point, drop a marker. */
import { useAppStore } from '@/app/store';
import TourRunner, { q, type TourStep } from './TourRunner';
import { click, typeInto, wait, waitFor } from './tourHelpers';
import { leaflet } from './tourActions';

const form = () => q('#goto-location-modal');

export default function GoToTour({ onEnd }: { onEnd: () => void }) {
  const close = () => useAppStore.getState().set({ showGoToForm: false });

  const steps: TourStep[] = [
    {
      title: 'Go to Coordinates 🔍',
      text: 'Use this when you have GPS coordinates, for example from a property document, a survey report or a WhatsApp location.',
      target: () => q('.search-btn', '.leaflet-search-container'),
      circle: true,
    },
    {
      title: 'Choose the Format 🧾',
      text: 'Pick Decimal Degrees (31.5204), Degrees-Minutes-Seconds (31° 31′ 13″), or "Paste Coordinates" to paste text like "31.5204, 74.3587" directly.',
      target: () => q('#goto-format') || form(),
      avoid: form,
      action: async () => {
        useAppStore.getState().set({ showGoToForm: true });
        await waitFor(form, 3000);
        return 400;
      },
    },
    {
      title: 'Enter Latitude and Longitude ✍️',
      text: 'We have filled in the centre of your current map view as an example. Coordinates must be inside Pakistan.',
      target: () => q('#goto-lat') || form(),
      avoid: form,
      action: async () => {
        const { map } = leaflet();
        const c = map?.getCenter?.() || { lat: 30.375, lng: 69.345 };
        const fmt = q('#goto-format') as HTMLSelectElement | null;
        if (fmt && fmt.value !== 'decimal') typeInto(fmt, 'decimal');
        await wait(150);
        typeInto(q('#goto-lat'), c.lat.toFixed(6));
        typeInto(q('#goto-lng'), c.lng.toFixed(6));
        return 500;
      },
    },
    {
      title: 'Drop the Marker 📌',
      text: 'Press "Go To Location". The map flies there and places a marker labelled with the coordinates. You can add several markers; "Clear" in this form removes them.',
      target: () => q('#goto-submit-btn') || form(),
      avoid: form,
      action: async () => {
        click(q('#goto-submit-btn'));
        await wait(2500);
        return 400;
      },
    },
    {
      title: 'Done ✅',
      text: 'The marker shows exactly where the point is on the killa map. Open this again from the 🔍 button or from Menu → Go To Location.',
      target: () => q('.leaflet-marker-icon') || q('.leaflet-container'),
      action: () => {
        close();
        return 300;
      },
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={close} />;
}
