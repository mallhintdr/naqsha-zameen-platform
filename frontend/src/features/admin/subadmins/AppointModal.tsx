import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from '@/shared/ui';
import { api, errText } from '@/features/subadmin/subAdminApi';
import { ExistingUserPicker, TerritoryPicker } from './shared';

const blank = { userId: '', userName: '', email: '', mobileNumber: '', territory: [] as string[], trialQuotaPerMonth: '30' as any };

export default function AppointModal({ show, onHide, onDone }: { show: boolean; onHide: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'new' | 'promote'>('new');
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  useEffect(() => {
    if (show) {
      setResult(null);
      setError(null);
    }
  }, [show]);
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'new'
          ? await api.post('/api/admin/subadmins', { ...f, trialQuotaPerMonth: Number(f.trialQuotaPerMonth) })
          : await api.post(`/api/admin/subadmins/promote/${encodeURIComponent(f.userId.trim())}`, { territory: f.territory, trialQuotaPerMonth: Number(f.trialQuotaPerMonth) });
      setResult(r);
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const lbl = 'block text-sm mb-0.5';
  const inp = 'input input-sm !border-[#64748b] focus:!border-[#1e293b]';
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="salg"
      title="Appoint a sub-admin"
      footer={
        <>
          {!result && mode === 'promote' && !f.userId.trim() && <span className="mr-auto text-sm text-[#dc3545]">Select a user from the list.</span>}
          <Button variant="secondary" onClick={onHide}>Close</Button>
          {!result && (
            <Button onClick={submit} loading={busy} disabled={busy || !f.territory.length || (mode === 'promote' && !f.userId.trim())}>
              {busy ? null : 'Appoint and send activation email'}
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <Alert variant="success">
          {result.message}
          {result.password && (
            <div>
              Password: <code>{result.password}</code>
            </div>
          )}
        </Alert>
      ) : (
        <>
          {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-1.5"><input type="radio" className="check" checked={mode === 'new'} onChange={() => setMode('new')} /> New account</label>
            <label className="inline-flex items-center gap-1.5"><input type="radio" className="check" checked={mode === 'promote'} onChange={() => setMode('promote')} /> Promote an existing user</label>
          </div>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mode === 'new' ? (
              <div><label className={lbl}>User ID</label><input className={inp} value={f.userId} onChange={set('userId')} /></div>
            ) : (
              <div className="sm:col-span-2">
                <label className={lbl}>Existing user</label>
                <ExistingUserPicker value={f.userId} onChange={(id) => setF((p) => ({ ...p, userId: id }))} />
              </div>
            )}
            {mode === 'new' && (
              <>
                <div><label className={lbl}>Name</label><input className={inp} value={f.userName} onChange={set('userName')} /></div>
                <div><label className={lbl}>Email (activation link goes here)</label><input type="email" className={inp} value={f.email} onChange={set('email')} /></div>
                <div><label className={lbl}>Mobile</label><input className={inp} value={f.mobileNumber} onChange={set('mobileNumber')} /></div>
              </>
            )}
            <div><label className={lbl}>Trials per month</label><input type="number" className={inp} value={f.trialQuotaPerMonth} onChange={set('trialQuotaPerMonth')} /></div>
          </div>
          <label className={`${lbl} mt-2`}>Territory (may overlap with other sub-admins)</label>
          <TerritoryPicker value={f.territory} onChange={(t) => setF((p) => ({ ...p, territory: t }))} />
        </>
      )}
    </Modal>
  );
}
