/**
 * First-time overview of the dashboard: where everything is, in plain language.
 * Starts automatically once for each browser after the first login (see TourManager),
 * and from Menu → Guided Tutorials at any time. Does not change any data.
 */
import { useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import TourRunner, { q, type TourStep } from './TourRunner';
import { WELCOME_TOUR_KEY } from './tourKeys';
import { setShowMenu } from './tourActions';

export default function WelcomeTour({ onEnd }: { onEnd: () => void }) {
  const { user } = useAuth();
  const [hasTehsil] = useState(() => Boolean(document.getElementById('tehsil-dropdown')));
  const name = user?.userName ? `, ${user.userName.split(' ')[0]}` : '';

  const steps: TourStep[] = [
    {
      title: `Welcome to Naqsha Zameen${name} 👋`,
      text: 'This short tour shows where everything is. It takes about a minute and changes nothing. Use Next and Back, or Skip at any time.',
      target: () => q('.navbar-tech-theme', 'header'),
    },
    ...(hasTehsil
      ? [{
          title: 'Choose a Tehsil 🏛️',
          text: 'You have access to more than one tehsil. Pick one here, and its chaks appear in the next list.',
          target: () => q('#tehsil-dropdown'),
        } as TourStep]
      : []),
    {
      title: 'Choose a Chak (Mouza) 🗺️',
      text: 'Open this list and type a few letters to search. The map flies to the chak and draws every murabba in red.',
      target: () => q('#mauza-dropdown'),
    },
    {
      title: 'Choose a Murabba 🔢',
      text: 'Pick a murabba number to zoom in. Its killas appear as gold dotted lines with their numbers. You can also tap a murabba directly on the map.',
      target: () => q('#murabba-dropdown'),
    },
    {
      title: 'Zoom In and Out ➕➖',
      text: 'Use these buttons, pinch with two fingers on a phone, or double-tap the map to zoom in.',
      target: () => q('.leaflet-control-zoom'),
    },
    {
      title: 'Your Live Location 📍',
      text: 'Tap here to see where you are standing on the killa map. Very useful while walking the field.',
      target: () => q('#leaflet-location-control-btn', '.leaflet-location-icon'),
      circle: true,
    },
    {
      title: 'Go to Coordinates 🔍',
      text: 'Have GPS coordinates from a document or a WhatsApp location? Tap here and enter them to drop a marker on the map.',
      target: () => q('.search-btn', '.leaflet-search-container'),
      circle: true,
    },
    {
      title: 'Compass 🧭',
      text: 'Shows north. If the map has been rotated, tap it once to turn the map back to north.',
      target: () => q('.compass-control-wrapper', '.leaflet-compass-icon'),
      circle: true,
    },
    {
      title: 'Drawing and Measuring ✏️',
      text: 'Draw lines, areas, rectangles, circles and markers to measure distance and area in acres, kanal and marla. You can save your drawings to open later.',
      target: () => q('.leaflet-draw-toolbar', '.leaflet-pm-toolbar'),
    },
    {
      title: 'Map Background 🛰️',
      text: 'Switch between satellite, street and terrain maps here.',
      target: () => q('#map-base-layer-select', '.dropdown-container'),
    },
    {
      title: 'Notifications and Profile 🔔',
      text: 'The red number shows new messages, such as renewal confirmations. Tap here to read them and to open your profile and subscription details.',
      target: () => q('#profile-notification-btn', '.profile-container'),
      circle: true,
    },
    {
      title: 'Menu and More Tutorials 📚',
      text: 'The menu has everything else: go to coordinates, saved drawings, mouza change requests, password and logout. Open "Guided Tutorials" there for a step-by-step tour of each feature.',
      target: () => q('.modern-sidebar', '.navbar-brand-custom'),
      avoid: () => q('.modern-sidebar'),
      action: () => {
        setShowMenu(true);
        return 600;
      },
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={() => setShowMenu(false)} dontShowAgainKey={WELCOME_TOUR_KEY} />;
}
