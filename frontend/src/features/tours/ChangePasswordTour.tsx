import { useAppStore } from '@/app/store';
import TourRunner, { modalEl, q, type TourStep } from './TourRunner';
import { setShowMenu } from './tourActions';

const brand = () => q('.navbar-brand-custom');
const modal = () => modalEl('.forgot-password-modal-dialog');
const submit = () => q('#reset-password-submit-btn');
const openReset = () => {
  useAppStore.getState().set({ showMenu: false, showForgotPasswordModal: true });
  return 1000;
};

export default function ChangePasswordTour({ onEnd }: { onEnd: () => void }) {
  const steps: TourStep[] = [
    {
      title: 'Open Navigation Menu ☰',
      text: 'You can change your password from the menu. Here is how.',
      target: brand,
      action: () => setShowMenu(true),
    },
    {
      title: 'Reset / Change Password Link 🔑',
      text: 'Tap "Change Password" in the menu. Press Next to open it.',
      target: () => q('#nav-link-change-password') || brand(),
      avoid: () => q('.modern-sidebar'),
      action: () => setShowMenu(true),
    },
    {
      title: 'Registered Email Requirement 📧',
      text: 'Important: the reset link is sent to the email address on your account. If you have no email address on your account, send it to your provider or the admin first so they can add it.',
      target: () => modal() || submit(),
      avoid: modal,
      action: openReset,
    },
    {
      title: 'Send Reset Link & Check Inbox ✉️',
      text: '"Send Reset Link" emails you a secure link. Check your inbox, and the spam or junk folder too.',
      target: () => submit() || modal(),
      avoid: modal,
      action: openReset,
    },
    {
      title: 'Update Password & Re-login 🔐',
      text: 'Open the link, choose a new password and save it. Then log in with the new password.',
      target: () => modal() || submit(),
      avoid: modal,
      action: openReset,
    },
  ];
  return (
    <TourRunner
      steps={steps}
      sideOnDesktop
      onEnd={onEnd}
      onStop={() => useAppStore.getState().set({ showForgotPasswordModal: false })}
    />
  );
}
