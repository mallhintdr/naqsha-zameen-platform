/** legacy src/App/Modals/SubscriptionWarningModal.js (inv-01 §4.1) */
import { useState } from 'react';
import { Check, Clock, Copy, CreditCard, Hourglass, Info, TriangleAlert, Wallet } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal, Spinner } from '@/shared/ui';
import EasypaisaLogo from '@/assets/Easypaisa-logo.png';
import JazzCashLogo from '@/assets/JazzCash_logo.png';
import { sendRenewalRequest, whatsappIntl, WhatsAppIcon } from '../renewal';
import { Row } from './shared';

const DEFAULT_ACCOUNT = { number: '03146796144', title: 'Muhammad Masoom' };

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function PayCard({
  logo, alt, acc, field, copied, onCopy, border, accent,
}: { logo: string; alt: string; acc: { number: string; title?: string }; field: string; copied: boolean; onCopy: (n: string, f: string) => void; border: string; accent: string }) {
  return (
    <div className="rounded-lg bg-white px-2 py-[7px]" style={{ border: `1px solid ${border}`, borderLeft: `4px solid ${accent}` }}>
      <div className="flex items-center gap-2">
        <img src={logo} alt={alt} className="h-[30px] w-[50px] shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-base font-extrabold leading-[1.15] tracking-[0.3px] text-[#2d3748]">{acc.number}</div>
            <button
              type="button"
              onClick={() => onCopy(acc.number, field)}
              title={`Copy ${alt} number`}
              className="flex shrink-0 items-center gap-[3px] rounded-[5px] border-none px-[7px] py-[3px] text-[0.66rem] font-bold leading-none"
              style={{ background: copied ? accent : '#edf2f7', color: copied ? '#fff' : '#4a5568' }}
            >
              {copied ? <Check size={9} /> : <Copy size={9} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-[0.68rem] font-semibold text-[#718096]">
            Title: <span style={{ color: accent }}>{acc.title}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionWarningModal({ show, onHide, warningContent }: { show: boolean; onHide: () => void; warningContent: any }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const u: any = user || {};
  const provider = u.provider || {};
  const needsRenewal = u.status === 'Pending' || u.status === 'Expired' || Boolean(u.endDate && new Date(u.endDate) <= new Date());
  const ep = provider.easypaisa || (provider.jazzcash ? null : DEFAULT_ACCOUNT);
  const jc = provider.jazzcash || (provider.easypaisa ? null : DEFAULT_ACCOUNT);
  const waIntl = whatsappIntl(u);
  const waLocal = waIntl.startsWith('92') ? '0' + waIntl.slice(2) : waIntl;
  const type = warningContent?.type;
  const isPayment = type === 'payment';

  const handleCopy = async (number: string, field: string) => {
    try {
      await copyText(number.replace(/\s+/g, ''));
      setCopiedField(field);
      setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 2000);
    } catch (e) {
      console.warn('Copy to clipboard failed:', e);
    }
  };

  const handleRenewNow = async () => {
    setLoading(true);
    try {
      await sendRenewalRequest(u);
    } finally {
      setLoading(false);
    }
  };

  const TitleIcon = isPayment ? CreditCard : type === 'expiring-soon' ? Hourglass : TriangleAlert;
  const AlertIcon = isPayment ? Wallet : type === 'expiring-soon' ? Clock : Info;
  const days = warningContent?.daysRemaining;

  return (
    <Modal
      id="subscription-warning-modal"
      show={show}
      onHide={onHide}
      size="warning"
      className="modern-modal-compact subscription-warning-dialog"
      headerVariant="custom"
      headerClassName="!px-2.5 !py-[5px] text-white"
      headerStyle={{
        background: `radial-gradient(circle at 20% 20%, ${isPayment ? 'rgba(220, 53, 69, 0.35)' : 'rgba(255, 193, 7, 0.35)'}, transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 0.9), rgba(18, 26, 54, 0.92))`,
      }}
      title={
        <span className="flex items-center gap-2 text-[0.82rem]">
          <TitleIcon size={14} className={isPayment ? 'text-white' : 'text-[#ffc107]'} />
          {warningContent?.title || 'Subscription Warning'}
        </span>
      }
      bodyClassName="!px-2.5 !py-2"
      footerClassName="!px-2.5 !py-1.5 !flex-nowrap"
      footer={
        <div className={`flex w-full gap-1.5 ${needsRenewal ? 'justify-between' : 'justify-center'}`}>
          <button
            type="button"
            onClick={onHide}
            className="btn btn-secondary min-h-[36px] !px-2.5 !py-1.5 !text-[0.82rem]"
            style={{ flex: needsRenewal ? '1' : '0 0 50%' }}
          >
            Close
          </button>
          {needsRenewal && (
            <button
              type="button"
              onClick={handleRenewNow}
              disabled={loading}
              className="flex min-h-[36px] flex-[2] items-center justify-center gap-[5px] rounded-md border-none px-2.5 py-1.5 text-[0.82rem] font-bold text-white shadow-[0_2px_6px_rgba(37,211,102,0.35)] disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)' }}
            >
              {loading ? <Spinner size="sm" className="text-white" /> : <><WhatsAppIcon size="1.15rem" />{u.status === 'Pending' ? 'Activate Now' : 'Renew Now'}</>}
            </button>
          )}
        </div>
      }
    >
      {warningContent ? (
        <div className="flex flex-col gap-[5px] text-[0.8rem]">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-[0.82rem] leading-[1.3]"
            style={
              isPayment
                ? { background: '#b91c1c', color: '#fff', borderColor: '#991b1b', fontWeight: 600 }
                : { background: '#fff3cd', color: '#664d03', borderColor: '#ffecb5' }
            }
          >
            <AlertIcon size={14} className="mt-px shrink-0" />
            <span>{warningContent.message}</span>
          </div>

          {(u.ipMisuse?.count30 || 0) >= 4 && (
            <div role="alert" className="rounded-md border border-[#f5c2c7] bg-[#f8d7da] px-2 py-1.5 text-[0.78rem] leading-[1.35] text-[#842029]">
              <b>Used on {u.ipMisuse.count30} devices in 30 days.</b> Using one account on multiple devices is against the Terms of Service and the account can be blocked.
              Additional devices are available for an additional payment per device.
            </div>
          )}

          {type === 'expiring-soon' && Number.isFinite(days) && (
            <div className="flex justify-center">
              <span
                className="rounded-xl px-[9px] py-[3px] text-[0.72rem] font-semibold"
                style={{ background: days <= 2 ? '#dc3545' : '#ffc107', color: days <= 2 ? 'white' : '#000' }}
              >
                {days} day{days === 1 ? '' : 's'} remaining
                {warningContent.endDate ? ` · expires ${warningContent.endDate}` : ''}
              </span>
            </div>
          )}

          {isPayment || type === 'expiring-soon' ? (
            <div className="payment-details-container flex flex-col gap-[5px]">
              <div className="rounded-lg border border-[#dee2e6] bg-[#f8f9fa] p-2">
                <h6 className="mb-[5px] border-b border-[#dee2e6] pb-[3px] text-[0.78rem] font-bold text-[#2c3e50]">Renewal Payment Methods:</h6>
                <div className="flex flex-col gap-[5px]">
                  {ep && <PayCard logo={EasypaisaLogo} alt="Easypaisa" acc={ep} field="easypaisa" copied={copiedField === 'easypaisa'} onCopy={handleCopy} border="#c6f6d5" accent="#38a169" />}
                  {ep && jc && <div className="-my-0.5 text-center text-[0.62rem] font-extrabold uppercase text-[#a0aec0]">OR</div>}
                  {jc && <PayCard logo={JazzCashLogo} alt="JazzCash" acc={jc} field="jazzcash" copied={copiedField === 'jazzcash'} onCopy={handleCopy} border="#fed7d7" accent="#e53e3e" />}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1 rounded-md border border-[#ffeeba] bg-[#fff3cd] px-1.5 py-[5px] text-center text-[0.72rem] font-bold leading-[1.2] text-[#212529]">
                  Share Payment Receipt to <WhatsAppIcon size="1.1rem" color="#25D366" /> {waLocal}
                </div>
              </div>
              {provider.isAdmin === false && (
                <div className="px-1 text-[0.68rem] text-[#495057]">
                  Your account is managed by <b>{provider.name}</b>.
                </div>
              )}
              <div className="px-1 text-[0.66rem] italic leading-[1.25] text-[#6c757d]">
                * You will receive a notification here the moment your subscription is renewed.
              </div>
            </div>
          ) : (
            <>
              <Row label="User"><span className="font-semibold">{warningContent.userName}</span></Row>
              <Row label="Start Date"><span className="text-[#2c3e50]">{warningContent.startDate}</span></Row>
              <Row label="Expires"><span className="text-[#2c3e50]">{warningContent.endDate}</span></Row>
              <Row label="Remaining" last>
                <span
                  className="rounded-[15px] px-2 py-1 text-[0.7rem] font-semibold"
                  style={{ background: days <= 3 ? '#dc3545' : '#ffc107', color: days <= 3 ? 'white' : '#000' }}
                >
                  {days} days
                </span>
              </Row>
            </>
          )}
        </div>
      ) : (
        <div className="alert alert-warning !px-2 !py-1.5 !text-[0.78rem]">Subscription details are unavailable.</div>
      )}
    </Modal>
  );
}
