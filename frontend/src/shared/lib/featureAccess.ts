/**
 * Who gets the limited dashboard: expired / pending customers now, preview users later
 * (docs/PUBLIC-BROWSE-PLAN.md). Mirrors backend services/accessPolicy.subscriptionState.
 * Limited users see the map (tiles, street basemaps) but not satellite imagery, live
 * location, saved layers, shift mouza or change mouza.
 */
export type LockedFeature = 'satellite' | 'live-location' | 'saved-layers' | 'save-layer' | 'shift-mouza' | 'change-mouza' | 'killa-info';

export const LOCKED_FEATURE_LABEL: Record<LockedFeature, string> = {
  satellite: 'Satellite imagery',
  'live-location': 'Live location',
  'saved-layers': 'Saved layers',
  'save-layer': 'Saving layers',
  'shift-mouza': 'Shift mouza',
  'change-mouza': 'Change mouza',
  'killa-info': 'Killa area & measurements',
};

export function isLimitedUser(user: any): boolean {
  if (!user || user.userType === 'admin' || user.userType === 'subadmin') return false;
  return user.status === 'Expired' || user.status === 'Pending' || user.status === 'AwaitingActivation'
    || (user.daysRemaining !== undefined && user.daysRemaining <= 0);
}

/** Basemaps that are satellite / aerial imagery (locked for limited users). */
export const SATELLITE_BASEMAPS = new Set(['Google Hybrid Satellite', 'Google Satellite', 'Esri World Imagery']);
export const LIMITED_DEFAULT_BASEMAP = 'Google Streets';
