import { useAppStore } from '@/app/store';
import TourRunner, { modalEl, q, type TourStep } from './TourRunner';

const open = () => {
  useAppStore.getState().set({ showIPWarningModal: true });
};
const modal = () => modalEl();

export default function MultiDeviceTour({ onEnd }: { onEnd: () => void }) {
  const s = (title: string, text: string, sel: string | null, lock = 800): TourStep => ({
    title,
    text,
    target: sel ? () => q(sel) : modal,
    avoid: modal,
    action: () => {
      open();
      return lock;
    },
  });
  const steps: TourStep[] = [
    s('Multi-Device Security Monitoring 🛡️', 'Welcome to the Multi-Device Security Tour! We open the Multi-Device & IP monitoring security modal.', null, 1000),
    s('IPs Used (Last 7 Days) 🌐', 'This parameter tracks the total number of distinct IP addresses used to access your account in the last 7 days.', '#multi-device-ip7-row'),
    s('Device & 30-Day Activity 📱', 'This parameter displays overall device usage and location activity sessions across the past 30 days.', '#multi-device-ip30-row'),
    s('Account Misuse Warning ⚠️', 'Sharing account credentials or simultaneous multi-device usage violates security terms and risks account locking.', '#multi-device-warning-banner'),
    s('Acknowledge & Comply ✅', 'Click "I Understand & Comply" to confirm compliance with security policy and close the warning modal.', '#multi-device-comply-btn'),
  ];
  return (
    <TourRunner
      steps={steps}
      onEnd={onEnd}
      onStop={() => useAppStore.getState().set({ showIPWarningModal: false, ipWarningDismissed: true })}
    />
  );
}
