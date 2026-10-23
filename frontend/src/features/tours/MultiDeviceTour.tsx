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
    s('Multi-Device Security Monitoring 🛡️', 'Each account is for one person. This window explains how account sharing is detected. We open it for you.', null, 1000),
    s('IPs Used (Last 7 Days) 🌐', 'How many different devices or networks used your account in the last 7 days.', '#multi-device-ip7-row'),
    s('Device & 30-Day Activity 📱', 'The same for the last 30 days, with the devices listed.', '#multi-device-ip30-row'),
    s('Account Misuse Warning ⚠️', 'Sharing your password, or using the account on many devices at once, breaks the terms of use and can lead to the account being blocked. Using your own phone and computer is fine.', '#multi-device-warning-banner'),
    s('Acknowledge & Comply ✅', 'Press "I Understand & Comply" to close the window. If a device you no longer use is listed, ask your provider to remove it.', '#multi-device-comply-btn'),
  ];
  return (
    <TourRunner
      steps={steps}
      onEnd={onEnd}
      onStop={() => useAppStore.getState().set({ showIPWarningModal: false, ipWarningDismissed: true })}
    />
  );
}
