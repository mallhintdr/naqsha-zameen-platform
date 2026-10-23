import TourRunner, { q, type TourStep } from './TourRunner';
import { setShowMenu } from './tourActions';

const brand = () => q('.navbar-brand-custom');
const clearLink = () => q('#nav-link-clear-cache') || brand();
const sidebar = () => q('.modern-sidebar');

export default function CacheTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Open Navigation Sidebar ☰',
      text: 'If the map looks wrong, is slow, or shows old information, clearing the cache usually fixes it. It is in the menu.',
      target: brand,
      action: () => setShowMenu(true),
    },
    {
      title: 'Clear App Cache Item 🧹',
      text: 'This is "Clear Cache". It removes the data this browser has saved for the dashboard and logs you out.',
      target: clearLink,
      avoid: sidebar,
      action: () => setShowMenu(true),
    },
    {
      title: 'Clean Reset Ready! ✅',
      text: 'After clearing, the login page opens. Log in again and everything loads fresh. Your saved drawings and account are kept safely on our server.',
      target: clearLink,
      avoid: sidebar,
      action: () => 600,
    },
  ];
  return <TourRunner steps={steps} sideOnDesktop onEnd={onEnd} />;
}
