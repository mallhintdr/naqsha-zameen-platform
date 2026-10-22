/**
 * Yellow pill under the navbar for customers whose account is Pending / Expired
 * (legacy components/Common/SubscriptionWarningBanner.js, inv-01 §1.11 / §5).
 * The button opens the SubscriptionWarningModal (payment methods + WhatsApp renewal-token flow),
 * exactly as legacy `onShowPaymentMethods`.
 */
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import './chrome.css';

export default function SubscriptionWarningBanner() {
  const { user } = useAuth();
  if (!user || user.userType === 'admin' || user.userType === 'subadmin') return null;
  const status = (user as any).status;
  if (status !== 'Expired' && status !== 'Pending') return null;

  return (
    <div className="subscription-warning-banner" role="status">
      <div className="subscription-warning-banner-icon">
        <TriangleAlert size={12} />
      </div>
      <div className="subscription-warning-banner-container">
        <span className="subscription-warning-banner-text">{status === 'Pending' ? 'Pending activation' : 'Subscription expired'}</span>
        <button
          type="button"
          className="subscription-warning-banner-btn-whatsapp"
          onClick={() => useAppStore.getState().set({ showWarningModal: true })}
        >
          <RotateCw size={11} />
          {status === 'Pending' ? 'Activation Request' : 'Renewal Request'}
        </button>
      </div>
    </div>
  );
}
