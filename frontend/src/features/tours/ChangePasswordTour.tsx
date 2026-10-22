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
      text: 'Welcome to the Reset & Change Password Tour! We open the navigation sidebar menu.',
      target: brand,
      action: () => setShowMenu(true),
    },
    {
      title: 'Reset / Change Password Link 🔑',
      text: 'Here is the Reset Password link in the menu. Click Next to open the password reset dialog.',
      target: () => q('#nav-link-change-password') || brand(),
      avoid: () => q('.modern-sidebar'),
      action: () => setShowMenu(true),
    },
    {
      title: 'Registered Email Requirement 📧',
      text: 'IMPORTANT: You must have a registered email address linked to your User ID in the database. If you do not have an email address registered, please send your email address to the Administrator so they can enter it in the database.',
      target: () => modal() || submit(),
      avoid: modal,
      action: openReset,
    },
    {
      title: 'Send Reset Link & Check Inbox ✉️',
      text: 'Clicking "Send Reset Link" dispatches a secure password reset link to your registered email address. Be sure to check your email inbox and spam/junk folder!',
      target: () => submit() || modal(),
      avoid: modal,
      action: openReset,
    },
    {
      title: 'Update Password & Re-login 🔐',
      text: 'Open the link from your email, set your new password, save changes, and log back into the system using your newly updated password.',
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
