/** Renewal / activation request via WhatsApp (legacy SubscriptionWarningModal.handleRenewNow). */
import { api } from '@/shared/api/client';
import { dialogs } from '@/shared/ui';

export const whatsappIntl = (user: any): string =>
  String(user?.provider?.whatsapp || import.meta.env.VITE_WHATSAPP_NUMBER || '923048840264');

/** POST /api/users/:id/renewal-token, then open wa.me with the byte-exact legacy message. */
export async function sendRenewalRequest(user: any): Promise<void> {
  if (!user?.userId) return;
  // Open the window inside the click so pop-up blockers allow it; fill the URL afterwards.
  const win = window.open('', '_blank');
  const status = user.status === 'Pending' ? 'Activation' : 'Renewal';
  const tehsil = user.activeTehsil || 'Not specified';
  const mouzaCount = Array.isArray(user.tehsilAccess)
    ? user.tehsilAccess.reduce((acc: number, t: any) => acc + (t.mouzas?.length || 0), 0)
    : 0;
  const subType = user.subscriptionType || 'Not specified';

  let deepLink = '';
  let payFirst = false;
  try {
    const { data } = await api.post(`/api/users/${user.userId}/renewal-token`, {});
    deepLink = data?.deepLink || '';
    payFirst = !!data?.payFirst;
    if (payFirst && data?.message) await dialogs.alert(data.message);
  } catch (e) {
    console.warn('Could not generate deep link:', e);
  }

  const trialNote = payFirst ? '\n\n*Free trial already used: paying the subscription fee to renew.*' : '';
  const adminSection = trialNote + (deepLink ? `\n\n${deepLink}` : '');
  const message =
    `*${status} Request*\n\n` +
    `*User Name:* ${user.userName || 'User'}\n` +
    `*User ID:* ${user.userId}\n` +
    `*Tehsil:* ${tehsil}\n` +
    `*No of Mouza:* ${mouzaCount}\n` +
    `*Subscription:* ${subType}\n\n` +
    `Please pay the subscription fee and share the payment receipt screenshot here to subscribe to the services.` +
    adminSection;

  const url = `https://wa.me/${whatsappIntl(user)}?text=${encodeURIComponent(message)}`;
  if (win && !win.closed) win.location.href = url;
  else window.open(url, '_blank');
}

/** WhatsApp glyph (lucide has no brand icons). */
export const WhatsAppIcon = ({ size = 16, color = 'currentColor' }: { size?: number | string; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.42 9.42 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.99 6.67 2.77a9.37 9.37 0 0 1 2.76 6.68c0 5.2-4.24 9.43-9.45 9.43zm8.04-17.47A11.3 11.3 0 0 0 12.03.7C5.77.7.67 5.8.67 12.06c0 2 .52 3.96 1.52 5.68L.57 23.7l6.1-1.6a11.33 11.33 0 0 0 5.36 1.37h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.03-1.18-5.89-3.32-8.03z" />
  </svg>
);
