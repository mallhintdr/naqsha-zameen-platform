import { useEffect, useState } from 'react';
import { Alert, Spinner } from '@/shared/ui';
import { api, errText } from '@/features/subadmin/subAdminApi';

/** "Your Payment Details & Policy": admin's own payment numbers + Fair Charge Policy. */
export default function SettingsTab() {
  const [pd, setPd] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get('/api/admin/payment-details')
      .then((d) => setPd({ name: d.name, jcTitle: d.jazzcash?.title || '', jc: d.jazzcash?.number || '', epTitle: d.easypaisa?.title || '', ep: d.easypaisa?.number || '', phone: d.phone || '', whatsapp: d.whatsapp ? '0' + String(d.whatsapp).slice(2) : '' }))
      .catch((e) => setError(errText(e)));
    api.get('/api/admin/subadmin-policy').then((p) => setPolicy({ version: p.version, text: p.text.join('\n') })).catch((e) => setError(errText(e)));
  }, []);
  if (!pd || !policy) return error ? <Alert variant="danger">{error}</Alert> : <Spinner />;
  const set = (k: string) => (e: any) => setPd((p: any) => ({ ...p, [k]: e.target.value }));
  const run = async (fn: () => Promise<any>) => {
    setMsg(null);
    setError(null);
    try {
      setMsg((await fn()).message);
    } catch (e) {
      setError(errText(e));
    }
  };
  const inp = 'input input-sm';
  return (
    <div className="mt-2 max-w-[820px]">
      {msg && <Alert variant="success" className="mb-2">{msg}</Alert>}
      {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
      <h6 className="font-semibold">Your payment details</h6>
      <p className="mb-2 text-sm text-ink-2">Shown to your own customers (and on sub-admins' daily bills as where to pay you).</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input className={inp} placeholder="Name shown" value={pd.name || ''} onChange={set('name')} />
        <input className={inp} placeholder="JazzCash title" value={pd.jcTitle} onChange={set('jcTitle')} />
        <input className={inp} placeholder="JazzCash number" value={pd.jc} onChange={set('jc')} />
        <input className={inp} placeholder="EasyPaisa title" value={pd.epTitle} onChange={set('epTitle')} />
        <input className={inp} placeholder="EasyPaisa number" value={pd.ep} onChange={set('ep')} />
        <input className={inp} placeholder="Phone" value={pd.phone} onChange={set('phone')} />
        <input className={inp} placeholder="WhatsApp" value={pd.whatsapp} onChange={set('whatsapp')} />
      </div>
      <button
        className="btn btn-sm btn-primary mt-2"
        onClick={() => run(() => api.put('/api/admin/payment-details', { name: pd.name, jazzcash: { title: pd.jcTitle, number: pd.jc }, easypaisa: { title: pd.epTitle, number: pd.ep }, phone: pd.phone, whatsapp: pd.whatsapp || pd.phone }))}
      >
        Save payment details
      </button>

      <h6 className="mt-4 font-semibold">
        Fair Charge Policy <span className="text-sm font-normal text-ink-2">(current version {policy.version})</span>
      </h6>
      <p className="mb-2 text-sm text-ink-2">One point per line. Saving creates a new version; sub-admins accept it when activating.</p>
      <textarea className="textarea" rows={9} value={policy.text} onChange={(e) => setPolicy((p: any) => ({ ...p, text: e.target.value }))} />
      <button className="btn btn-sm btn-primary mt-2" onClick={() => run(() => api.put('/api/admin/subadmin-policy', { text: policy.text.split('\n') }))}>
        Save policy
      </button>
    </div>
  );
}
