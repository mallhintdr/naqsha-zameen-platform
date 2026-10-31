/**
 * Small notice hanging just under the navbar for customers whose account is Pending / Expired:
 * a warning and a "Renew now" / "Request activation" link. The link opens the
 * SubscriptionWarningModal (payment methods + WhatsApp renewal-token flow).
 */
import { TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import './chrome.css';

export default function SubscriptionWarningBanner() {
  const { user } = useAuth();
  if (!user || user.userType === 'admin' || user.userType === 'subadmin') return null;
  const status = (user as any).status;
  if (status !== 'Expired' && status !== 'Pending') return null;
  const pending = status === 'Pending';

  return (
    <div className="subscription-strip" role="status">
      <TriangleAlert size={13} aria-hidden="true" className="subscription-strip-icon" />
      <span className="subscription-strip-text">
        {pending ? 'Account pending activation' : 'Subscription expired'}
        <span className="subscription-strip-more">{pending ? ': some features are locked until it is activated.' : ': satellite view and some tools are locked.'}</span>
      </span>
      <button type="button" className="subscription-strip-link" onClick={() => useAppStore.getState().set({ showWarningModal: true })}>
        {pending ? 'Request activation' : 'Renew now'} &rarr;
      </button>
    </div>
  );
}
