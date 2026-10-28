/**
 * Admin / sub-admin reply to the customer a notification is about (legacy src/App/ReplyModal.js, inv-01 §4.9).
 * Message templates are byte-exact with legacy (WhatsApp texts).
 */
import { useEffect, useState } from 'react';
import { Reply, Send } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Modal, Spinner } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ChromeButton, profileHeader } from './shared';

const BORDER = '1px solid #64748b';
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString('en-GB') : 'N/A');
const rs = (n: any) => Number(n || 0).toLocaleString('en-PK');
const waNumber = (m: any) => {
  const d = String(m || '').replace(/\D/g, '');
  return d.startsWith('92') ? d : d.startsWith('0') ? `92${d.slice(1)}` : d;
};

function paymentBlock(p: any, amount: string) {
  const lines: string[] = [];
  if (amount) lines.push(`Fee: *Rs ${rs(amount)}*`);
  if (p?.easypaisa?.number) lines.push(`*Easypaisa*\n${p.easypaisa.number}\n${p.easypaisa.title || ''}`.trim());
  if (p?.jazzcash?.number) lines.push(`*Jazz Cash*\n${p.jazzcash.number}\n${p.jazzcash.title || ''}`.trim());
  lines.push('Please send the payment screenshot after paying.');
  return lines.join('\n\n');
}

const wrap = (c: any, body: string, signOff: string) => `Dear *${c.userName}*,\nUser ID: *${c.userId}*\n\n${body}\n\nThanks,\n*${signOff}*`;

function templates(info: any, amount: string) {
  const c = info.customer;
  const p = info.provider;
  const d = info.details || {};
  const subDetails = `Subscription Details:\n- Type: *${c.plan}*\n- Total Mouzas: *${c.mouzaCount}*\n- End Date: *${fmtDate(c.endDate)}*\n- Days Remaining: *${c.daysLeft}* days`;
  const mouzaLines =
    d.kind === 'mouzaChange'
      ? `Requested mouza change:\n- Current Mouzas: *${d.currentMouzas}*\n- Removed Mouzas: *${(d.removed || []).join(', ') || 'None'}*\n- Added Mouzas: *${(d.added || []).join(', ') || 'None'}*`
      : '';
  return [
    { key: 'pay', label: 'Payment details', body: `To proceed with your request, please pay the fee.\n\n${paymentBlock(p, amount)}` },
    { key: 'trialMouza', label: 'Trial: subscribe first', body: `Mouza changes are not available during the free trial. Please subscribe (Monthly / Yearly) first; your mouzas can then be changed.\n\n${mouzaLines ? mouzaLines + '\n\n' : ''}${paymentBlock(p, amount)}` },
    { key: 'trialOn', label: 'Trial activated + pay', body: `Your free trial is activated.\n${subDetails}\n\nPlease pay the subscription fee within 1 day to keep using the services.\n\n${paymentBlock(p, amount)}` },
    { key: 'mouzaFee', label: 'Mouza change fee', body: `${mouzaLines || 'Your mouza change request is received.'}\n\nThe change will be made after the fee is paid.\n\n${paymentBlock(p, amount)}` },
    { key: 'received', label: 'Payment received', body: `Your payment is received. Your request is being processed.\n\n${subDetails}` },
    { key: 'done', label: 'Done', body: `Your request is complete.\n\n${subDetails}` },
  ].map((t) => ({ ...t, text: wrap(c, t.body, info.signOff) }));
}

/** Copies the WhatsApp text (stars kept so WhatsApp shows bold). Falls back to a hidden textarea
 *  when the Clipboard API is blocked (older phones, focus lost). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function ReplyModal({ notif, onHide }: { notif: any; onHide: () => void }) {
  const [info, setInfo] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { markNotificationReplied } = useAuth();

  useEffect(() => {
    if (!notif) return;
    setInfo(null);
    setAmount('');
    setText('');
    setPicked(null);
    setError(null);
    setDone(null);
    api
      .get(`/api/notifications/${notif.id || notif._id}/reply-info`)
      .then(({ data }) => setInfo(data))
      .catch((e) => setError(e?.response?.data?.message || e.message));
  }, [notif]);

  if (!notif) return null;
  const tpl = info ? templates(info, amount) : [];
  const phone = waNumber(info?.customer?.mobile);

  const changeAmount = (v: string) => {
    setAmount(v);
    // Re-fill the chosen template when the amount changes.
    if (info && picked) setText(templates(info, v).find((t) => t.key === picked)?.text || '');
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    // Copy first, while the click still counts as a user action.
    const copied = await copyText(text);
    try {
      const id = notif.id || notif._id;
      const { data } = await api.post(`/api/notifications/${id}/reply`, { message: text });
      markNotificationReplied(id);
      setDone(`${data.message} ${copied ? 'The message is copied: paste it in WhatsApp.' : 'Copying was blocked: select the message above and copy it for WhatsApp.'}`);
      if (copied) setTimeout(onHide, 1800);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      show
      onHide={onHide}
      size="sm"
      className="modern-modal-compact compact-fit-modal"
      headerVariant="custom"
      headerClassName="text-white"
      headerStyle={profileHeader()}
      title={<><Reply size={15} /> {`Reply to ${notif.replyTo}`}</>}
      bodyClassName="!px-3 !py-2.5 !text-[0.8rem]"
      footerClassName="!flex-nowrap"
      footer={
        <>
          <ChromeButton background="#6c757d" onClick={onHide}>Cancel</ChromeButton>
          <ChromeButton background="linear-gradient(135deg,#10b981,#059669)" disabled={busy || text.trim().length < 2 || !!done} onClick={send}>
            {busy ? <Spinner size="sm" className="text-white" /> : <><Send size={13} />Send &amp; Copy</>}
          </ChromeButton>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {error && <div className="alert alert-danger !px-2 !py-1 !text-[0.75rem]">{error}</div>}
        {done && <div className="alert alert-success !px-2 !py-1 !text-[0.75rem]">{done}</div>}
        {!info && !error && (
          <div className="py-2 text-center"><Spinner size="sm" /></div>
        )}
        {info && (
          <>
            <div className="text-[0.72rem] text-[#6c757d]">
              {info.customer.plan} · {info.customer.daysLeft}d left · {info.customer.mouzaCount} mouza · last fee Rs {rs(info.customer.lastFeePaid)}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-[#6c757d]">Fee (Rs)</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={amount}
                onChange={(e) => changeAmount(e.target.value)}
                placeholder="optional"
                className="input input-sm max-w-[110px] !text-[0.78rem]"
                style={{ border: BORDER }}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {tpl.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setPicked(t.key);
                    setText(t.text);
                  }}
                  className="min-h-[28px] rounded-xl px-2 py-px text-[0.72rem] text-[#1f2937]"
                  style={{ border: picked === t.key ? '2px solid #0d6efd' : BORDER, background: picked === t.key ? '#e7f1ff' : '#f8fafc' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Pick a message above or write your own"
              maxLength={1500}
              className="textarea !text-[0.75rem]"
              style={{ border: BORDER }}
            />
            <div className="text-[0.7rem] text-[#6c757d]">
              Sent to the customer's notification center; the same text is copied to your clipboard for WhatsApp{phone ? ` (${info.customer.mobile})` : ''}.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
