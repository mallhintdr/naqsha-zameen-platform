import TourRunner, { q, type TourStep } from './TourRunner';
import { setShowMenu } from './tourActions';

const brand = () => q('.navbar-brand-custom');
const clearLink = () => q('#nav-link-clear-cache') || brand();
const sidebar = () => q('.modern-sidebar');

export default function CacheTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Open Navigation Sidebar ☰',
      text: 'Welcome to the Cache & Performance Tour! We begin by opening the main navigation sidebar panel.',
      target: brand,
      action: () => setShowMenu(true),
    },
    {
      title: 'Clear App Cache Item 🧹',
      text: 'Here is the "Clear Cache" tool. Clicking this will delete all sessions, cookies, and local data on the device, logging you out cleanly.',
      target: clearLink,
      avoid: sidebar,
      action: () => setShowMenu(true),
    },
    {
      title: 'Clean Reset Ready! ✅',
      text: 'Whenever you click "Clear Cache", all device/browser sessions and cookies are purged and the app is reloaded cleanly to the login screen.',
      target: clearLink,
      avoid: sidebar,
      action: () => 600,
    },
  ];
  return <TourRunner steps={steps} sideOnDesktop onEnd={onEnd} />;
}
