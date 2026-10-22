// "Copy Mouza List" (legacy CopyMouzaListButton.js). Text is byte-identical to legacy (incl. "availble").
import { useEffect, useState, type CSSProperties } from 'react';
import { Copy } from 'lucide-react';
import { Alert, Modal, Spinner } from '@/shared/ui';
import { fetchConsolidatedTehsils, fetchMauzas } from '@/shared/lib/mouzaApi';

export function mouzaListText(tehsil: string, mouzas: string[]) {
  const sorted = [...mouzas].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const header = `Tehsil Name:${tehsil}\nMouza availble as of now:${sorted.length}\n${'S.No'.padEnd(7)}Mouza Name\n`;
  return header + sorted.map((name, i) => `${String(i + 1).padEnd(7)}${name}`).join('\n');
}

const COMPACT_BTN: CSSProperties = { flex: 1, border: 'none', padding: '8px 4px', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', color: '#fff' };
const PRIMARY_BG = 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.45), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 1), rgba(18, 26, 54, 1))';

export default function CopyMouzaListButton({ size = 'sm', variant = 'outline-secondary' }: { size?: 'sm' | 'md' | 'lg'; variant?: string }) {
  const [show, setShow] = useState(false);
  const [tehsils, setTehsils] = useState<string[]>([]);
  const [tehsil, setTehsil] = useState('');
  const [mouzas, setMouzas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ t: 'success' | 'danger'; m: string } | null>(null);

  useEffect(() => {
    if (!show || tehsils.length) return;
    fetchConsolidatedTehsils().then((l: any[]) => setTehsils(l.map((x) => x.name))).catch(() => {});
  }, [show, tehsils.length]);

  useEffect(() => {
    if (!tehsil) { setMouzas([]); return; }
    let alive = true;
    setLoading(true); setMsg(null);
    fetchMauzas(tehsil).then((l: any) => { if (alive) setMouzas(Array.isArray(l) ? l : []); }).catch(() => alive && setMouzas([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [tehsil]);

  const copy = async () => {
    const text = mouzaListText(tehsil, mouzas);
    try { await navigator.clipboard.writeText(text); setMsg({ t: 'success', m: `Copied ${mouzas.length} mouzas of ${tehsil}.` }); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setMsg({ t: 'success', m: `Copied ${mouzas.length} mouzas of ${tehsil}.` }); } catch { setMsg({ t: 'danger', m: 'Could not copy.' }); }
      document.body.removeChild(ta);
    }
  };

  return (
    <>
      <button type="button" className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''}`} onClick={() => setShow(true)} title="Copy the list of all mouzas of a tehsil">
        <Copy size={13} /> Copy Mouza List
      </button>
      <Modal show={show} onHide={() => setShow(false)} size="sm" title={<><Copy size={14} /> Copy Mouza List</>} bodyClassName="!px-3 !py-2.5 !text-[0.8rem]"
        footerClassName="!flex-nowrap"
        footer={<>
          <button className="btn" style={{ ...COMPACT_BTN, background: '#6c757d' }} onClick={() => setShow(false)}>Close</button>
          <button className="btn" style={{ ...COMPACT_BTN, background: PRIMARY_BG }} disabled={!tehsil || loading || !mouzas.length} onClick={copy}><Copy size={13} />Copy List</button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 500, color: '#6c757d' }}>Tehsil</span>
          <select className="select select-sm" value={tehsil} onChange={(e) => setTehsil(e.target.value)} style={{ border: '1px solid #64748b', fontSize: '0.8rem' }}>
            <option value="">-- Select Tehsil --</option>
            {tehsils.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {tehsil && (loading
            ? <div className="py-2 text-center"><Spinner size="sm" /></div>
            : <div className="text-ink-2" style={{ fontSize: '0.78rem' }}><strong style={{ color: '#212529' }}>{mouzas.length}</strong> mouzas available in {tehsil}.</div>)}
          {msg && <Alert variant={msg.t} className="!px-2 !py-1 !text-[0.75rem]">{msg.m}</Alert>}
        </div>
      </Modal>
    </>
  );
}
