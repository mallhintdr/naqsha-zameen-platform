/** Notifications panel: messages, actions, profile shortcut. */
import TourRunner, { q, type TourStep } from './TourRunner';
import { click, waitFor } from './tourHelpers';

const bell = () => q('#profile-notification-btn', '.profile-container');
const panel = () => q('#notification-panel');
const ensureOpen = async () => {
  if (!panel()) click(bell());
  await waitFor(panel, 2000);
  return 300;
};
const ensureClosed = () => {
  if (panel()) click(bell());
};

export default function NotificationsTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Notifications 🔔',
      text: 'The red number on this button counts unread messages: renewal confirmations, replies from the admin, mouza change updates and important notices.',
      target: bell,
      circle: true,
    },
    {
      title: 'Your Messages 💬',
      text: 'Tapping the button opens your messages, newest first. Tap a message to mark it as read. Messages with more information have a "Details" link.',
      target: () => panel() || bell(),
      avoid: panel,
      action: ensureOpen,
    },
    {
      title: 'Filters and Actions 🗂️',
      text: 'Use the filters at the top to see only one kind of message. Some messages have a button, for example to open a request. The bin icon clears all messages.',
      target: () => panel() || bell(),
      avoid: panel,
      action: ensureOpen,
    },
    {
      title: 'Your Profile 👤',
      text: 'The "Profile" button at the bottom of this panel opens your account: plan, expiry date, days remaining, and mouza change requests.',
      target: () => panel() || bell(),
      avoid: panel,
      action: ensureOpen,
    },
    {
      title: 'Phone Notifications 📲',
      text: 'If you allowed notifications in your browser, new messages also appear on your phone or computer even when the dashboard is closed. That is the end of this tour.',
      target: bell,
      circle: true,
      action: () => {
        ensureClosed();
        return 300;
      },
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={ensureClosed} />;
}
