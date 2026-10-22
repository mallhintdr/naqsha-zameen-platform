/**
 * Port of legacy components/Admin/ActivationPages.js (inv-03 §8).
 * Public pages opened from emailed links. Opening a link only shows the page; the account is
 * activated by pressing the button (a POST), so email scanners that open links can't activate anything.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Home } from 'lucide-react';
import { api, errText } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';
import { rs } from '@/shared/lib/format';
import { getDeviceId } from '@/shared/lib/device';

const PLAN_LABEL: Record<string, string> = { Trial24: '24-hour trial', Monthly: 'Monthly', Yearly: 'Yearly' };

const Shell = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mx-auto w-full max-w-[560px] px-3 py-12 max-sm:py-6">
    <div className="rounded-lg border border-[#dee2e6] bg-white shadow-[0_0.125rem_0.25rem_rgba(0,0,0,0.075)]">
      <div className="p-6 max-sm:p-4">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h4 className="m-0 text-[1.5rem] font-medium max-sm:text-[1.25rem]">{title}</h4>
          <Link to="/" className="btn btn-outline-primary btn-sm min-h-8 shrink-0">
            <Home size={13} /> Home
          </Link>
        </div>
        {children}
      </div>
    </div>
  </div>
);
const LoginLink = () => <Link to="/login" className="font-semibold underline">Log in</Link>;

export function CustomerActivatePage() {
  const { token } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/activation-info', { params: { token } })
      .then((r) => setInfo(r.data))
      .catch((e) => setError(errText(e, 'This activation link is not valid.')));
  }, [token]);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone((await api.post('/api/activate', { token, deviceId: getDeviceId() })).data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!info && !error) return <Shell title="Activate your account"><Spinner /></Shell>;
  return (
    <Shell title="Activate your account">
      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
      {done && <Alert variant="success" className="mb-3"><span>{done.message} <LoginLink /></span></Alert>}
      {info?.alreadyActive && <Alert variant="info" className="mb-3"><span>This account is already active. <LoginLink /></span></Alert>}
      {info && !info.alreadyActive && !done && (
        <>
          <p className="mb-3">Hello <strong>{info.userName}</strong>. Your User ID is <strong>{info.userId}</strong>.</p>
          <ul className="mb-3 list-disc pl-8">
            <li>Plan: <strong>{PLAN_LABEL[info.plan] || info.plan}</strong></li>
            <li>Mouzas: {(info.mouzas || []).join(', ')}</li>
            {info.customerFee != null && <li>Fee recorded by your provider: <strong>{rs(info.customerFee)}</strong></li>}
            <li>Provider: {info.providerName}</li>
          </ul>
          <p className="mb-3 text-sm text-[#6c757d]">Your plan starts the moment you activate.</p>
          {info.expired ? (
            <Alert variant="warning">This link has expired. Ask your provider to resend it.</Alert>
          ) : (
            <button type="button" onClick={activate} disabled={busy} className="btn btn-primary min-h-10 w-full">
              {busy ? <Spinner size="sm" className="text-current" /> : 'Activate account'}
            </button>
          )}
        </>
      )}
    </Shell>
  );
}

export function SubAdminActivatePage() {
  const { token } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [accept, setAccept] = useState(false);
  const [pd, setPd] = useState({ jcTitle: '', jc: '', epTitle: '', ep: '', phone: '', whatsapp: '' });

  useEffect(() => {
    api.get('/api/subadmin/activation-info', { params: { token } })
      .then((r) => setInfo(r.data))
      .catch((e) => setError(errText(e, 'This activation link is not valid.')));
  }, [token]);

  const set = (k: keyof typeof pd) => (e: ChangeEvent<HTMLInputElement>) => setPd((p) => ({ ...p, [k]: e.target.value }));
  const activate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/api/subadmin/activate', {
        token,
        acceptPolicyVersion: accept ? info.policy.version : null,
        paymentDetails: {
          jazzcash: { title: pd.jcTitle, number: pd.jc },
          easypaisa: { title: pd.epTitle, number: pd.ep },
          phone: pd.phone,
          whatsapp: pd.whatsapp || pd.phone,
        },
      });
      setDone(data);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!info && !error) return <Shell title="Activate your sub-admin account"><Spinner /></Shell>;
  return (
    <Shell title="Activate your sub-admin account">
      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
      {done && <Alert variant="success" className="mb-3"><span>{done.message} <LoginLink /></span></Alert>}
      {info?.alreadyActive && <Alert variant="info" className="mb-3"><span>Your sub-admin account is already active. <LoginLink /></span></Alert>}
      {info && !info.alreadyActive && !done && (
        info.expired ? (
          <Alert variant="warning">This link has expired. Ask the admin to resend it.</Alert>
        ) : (
          <form onSubmit={activate}>
            <p className="mb-3">Hello <strong>{info.userName}</strong> ({info.userId}). Territory: {(info.territory || []).join(', ')}.</p>
            <h6 className="mt-4 mb-2 font-medium">Where your customers pay you</h6>
            <p className="mb-3 text-sm text-[#6c757d]">Shown to your customers for renewals. Use your own accounts, not the admin&apos;s.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder="JazzCash account title" value={pd.jcTitle} onChange={set('jcTitle')} />
              <input className="input" inputMode="tel" placeholder="JazzCash number 03xxxxxxxxx" value={pd.jc} onChange={set('jc')} required />
              <input className="input" placeholder="EasyPaisa account title" value={pd.epTitle} onChange={set('epTitle')} />
              <input className="input" inputMode="tel" placeholder="EasyPaisa number 03xxxxxxxxx" value={pd.ep} onChange={set('ep')} required />
              <input className="input" inputMode="tel" placeholder="Contact phone 03xxxxxxxxx" value={pd.phone} onChange={set('phone')} required />
              <input className="input" inputMode="tel" placeholder="WhatsApp (if different)" value={pd.whatsapp} onChange={set('whatsapp')} />
            </div>
            <h6 className="mt-6 mb-2 font-medium">
              Fair Charge Policy <span className="text-sm text-[#6c757d]">(version {info.policy?.version})</span>
            </h6>
            <ul className="mb-3 list-disc pl-8 text-sm">
              {(info.policy?.text || []).map((t: string, i: number) => <li key={i}>{t}</li>)}
            </ul>
            <label htmlFor="accept-policy" className="flex min-h-9 cursor-pointer items-center gap-2">
              <input id="accept-policy" type="checkbox" className="check" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              I have read and accept the Fair Charge Policy
            </label>
            <button type="submit" className="btn btn-primary mt-4 min-h-10 w-full" disabled={busy || !accept}>
              {busy ? <Spinner size="sm" className="text-current" /> : 'Activate'}
            </button>
          </form>
        )
      )}
    </Shell>
  );
}

export function ConfirmEmailPage() {
  const { token } = useParams();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      setMsg((await api.post('/api/confirm-email-change', { token })).data?.message);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Confirm your new email">
      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
      {msg ? (
        <Alert variant="success">{msg}</Alert>
      ) : (
        <button type="button" onClick={confirm} disabled={busy} className="btn btn-primary min-h-10 w-full">
          {busy ? <Spinner size="sm" className="text-current" /> : 'Confirm email address'}
        </button>
      )}
    </Shell>
  );
}
