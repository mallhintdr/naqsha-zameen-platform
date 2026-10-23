/** Requesting a mouza change (customers). Opens the real request window but submits nothing. */
import TourRunner, { q, type TourStep } from './TourRunner';
import { setShowMenu } from './tourActions';
import { click, pressEscape, waitFor } from './tourHelpers';

const link = () => q('#nav-link-change-mouzas');
const dialog = () => q('#change-mouzas-modal');
const linkDisabled = () => {
  const el = link() as HTMLElement | null;
  return !el || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled') || (el as HTMLButtonElement).disabled;
};

export default function ChangeMouzaTour({ onEnd }: { onEnd: () => void }) {
  const close = () => {
    if (dialog()) pressEscape();
    setShowMenu(false);
  };

  const steps: TourStep[] = [
    {
      title: 'Change Your Mouza 🔁',
      text: 'If you need a different chak, or one more, you can request it yourself. Find "Change Mouza" in the menu.',
      target: () => link() || q('.modern-sidebar'),
      avoid: () => q('.modern-sidebar'),
      action: async () => {
        setShowMenu(true);
        await waitFor(link, 2000);
        return 400;
      },
    },
    {
      title: 'Choose Mouzas to Add or Remove ✅',
      text: linkDisabled()
        ? 'Mouza changes are available while your subscription is active. Renew first, then this menu item opens a window where you tick the mouzas to add and untick the ones to remove.'
        : 'Tick the mouzas you want to add and untick the ones you no longer need. Nothing is sent until you press the request button. In this tour we only look.',
      target: () => dialog() || link(),
      avoid: dialog,
      action: async () => {
        if (!linkDisabled()) {
          click(link());
          await waitFor(dialog, 3000);
        }
        return 500;
      },
    },
    {
      title: 'Send the Request 📨',
      text: 'After you send it, your provider receives the request on WhatsApp and in the dashboard. If a fee applies they tell you the amount. You get a notification when the change is approved.',
      target: () => dialog() || link(),
      avoid: dialog,
    },
    {
      title: 'Track or Cancel 🕑',
      text: 'While a request is pending, opening "Change Mouza" again shows its status, and you can cancel it there. That is the end of this tour.',
      target: () => link() || q('.navbar-brand-custom'),
      action: () => {
        if (dialog()) pressEscape();
        return 400;
      },
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={close} />;
}
