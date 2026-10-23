/** Profile, subscription status and how to renew. */
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import TourRunner, { q, type TourStep } from './TourRunner';
import { waitFor } from './tourHelpers';

const profile = () => q('#profile-modal');
const warningModal = () => q('#subscription-warning-modal');

export default function AccountTour({ onEnd }: { onEnd: () => void }) {
  const { user } = useAuth();
  const set = useAppStore.getState().set;
  const openProfile = async () => {
    set({ showWarningModal: false, showProfileModal: true });
    await waitFor(profile, 3000);
    return 300;
  };
  const closeAll = () => set({ showProfileModal: false, showWarningModal: false });

  const steps: TourStep[] = [
    {
      title: 'Your Profile 👤',
      text: 'Your profile shows your name, user ID, mobile number and the tehsils and mouzas you have access to.',
      target: () => profile() || q('#profile-notification-btn'),
      avoid: profile,
      action: openProfile,
    },
    {
      title: 'Subscription Status 📅',
      text: 'Here you see your plan, when it started, when it expires and how many days remain. You also get a reminder five days before it expires.',
      target: () => q('#profile-subscription') || profile(),
      avoid: profile,
      action: openProfile,
    },
    ...(user?.userType === 'user'
      ? [{
          title: 'Change Your Mouza 🔁',
          text: 'Need a different chak? Request it here. Your provider approves the change; a small fee may apply. There is a separate tutorial for this.',
          target: () => q('#profile-change-mouza-btn') || profile(),
          avoid: profile,
          action: openProfile,
        } as TourStep]
      : []),
    {
      title: 'How to Renew 💳',
      text: 'When your plan is about to expire, this window shows the payment accounts (EasyPaisa or JazzCash). Pay, then share the receipt on WhatsApp with the button at the bottom. You get a notification as soon as your account is renewed.',
      target: () => warningModal() || profile(),
      avoid: warningModal,
      action: async () => {
        set({ showProfileModal: false, showWarningModal: true });
        await waitFor(warningModal, 3000);
        return 400;
      },
    },
    {
      title: 'All Set ✅',
      text: 'Open your profile at any time from the notifications button, then "Profile". That is the end of this tour.',
      target: () => q('#profile-notification-btn'),
      circle: true,
      action: () => {
        closeAll();
        return 300;
      },
    },
  ];

  return <TourRunner steps={steps} actionMode="enter" onEnd={onEnd} onStop={closeAll} />;
}
