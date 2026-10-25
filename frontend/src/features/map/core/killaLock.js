// Killa area / side measurements on tap are a subscriber feature (expired and preview users
// are "limited", see shared/lib/featureAccess). The first tap each session explains why;
// later taps get a short note at most every 15 s, so tapping the map never becomes noisy.
import { isTilesOnly } from '@/features/map/config/pmtiles';
import { useAppStore } from '@/app/store';
import { toast } from '@/shared/ui';

let explained = false;
let lastNote = 0;

/** Returns true (and explains) when killa details are locked for this user. */
export function killaInfoLocked(e) {
  if (!isTilesOnly()) return false;
  if (e?.originalEvent) e.originalEvent._killaHandled = true;
  if (!explained) {
    explained = true;
    useAppStore.getState().set({ subscribeFeature: 'killa-info' });
  } else if (Date.now() - lastNote > 15000) {
    lastNote = Date.now();
    toast.info?.('Killa area and measurements need a subscription.');
  }
  return true;
}
