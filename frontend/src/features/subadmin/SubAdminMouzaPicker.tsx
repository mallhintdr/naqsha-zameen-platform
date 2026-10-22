// Tehsil + mouza picker limited to a list of tehsils (legacy SubAdminMouzaPicker.js).
// Value shape: [{ tehsil, mouzas: [] }].
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge, Spinner } from '@/shared/ui';
import { api } from './subAdminApi';

export const countMouzas = (value: any[]) => (value || []).reduce((n, a) => n + (a.mouzas || []).length, 0);

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function SubAdminMouzaPicker({
  tehsils = [], value = [], onChange, maxMouzas, disabled,
}: { tehsils?: string[]; value?: { tehsil: string; mouzas: string[] }[]; onChange: (v: any[]) => void; maxMouzas?: number; disabled?: boolean }) {
  const [tehsil, setTehsil] = useState(tehsils[0] || '');
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [tehsilFilter, setTehsilFilter] = useState('');
  const [mouzaFilter, setMouzaFilter] = useState('');

  useEffect(() => { if (!tehsil && tehsils[0]) setTehsil(tehsils[0]); }, [tehsils, tehsil]);

  useEffect(() => {
    if (!tehsil) return;
    let alive = true;
    setLoading(true);
    setMouzaFilter('');
    api.get(`/api/mauza-list/${encodeURIComponent(tehsil)}`)
      .then((d) => { if (alive) setOptions(Array.isArray(d) ? d : d?.mouzas || []); })
      .catch(() => { if (alive) setOptions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tehsil]);

  const total = countMouzas(value);
  const atLimit = Boolean(maxMouzas) && total >= maxMouzas;
  const selectedHere = useMemo(() => value.find((a) => a.tehsil === tehsil)?.mouzas || [], [value, tehsil]);

  const setHere = (mouzas: string[]) => {
    const rest = value.filter((a) => a.tehsil !== tehsil);
    onChange(mouzas.length ? [...rest, { tehsil, mouzas }] : rest);
  };
  const toggle = (m: string) => {
    if (disabled) return;
    if (selectedHere.includes(m)) return setHere(selectedHere.filter((x) => x !== m));
    if (atLimit) return;
    setHere([...selectedHere, m]);
  };
  const filtered = options.filter((m) => m.toLowerCase().includes(mouzaFilter.toLowerCase()));
  const selectAll = () => {
    const room = maxMouzas ? maxMouzas - (total - selectedHere.length) : Infinity;
    const extra = filtered.filter((m) => !selectedHere.includes(m));
    setHere([...selectedHere, ...extra].slice(0, Math.max(room, selectedHere.length)));
  };
  const sorted = [...filtered.filter((m) => selectedHere.includes(m)).sort(byName), ...filtered.filter((m) => !selectedHere.includes(m)).sort(byName)];

  return (
    <div className="dark-gray-borders" style={{ padding: 8 }}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        <div className="md:col-span-5">
          <label className="mb-0 block text-sm font-bold">Tehsil</label>
          <input className="input input-sm mb-1" placeholder="Filter..." value={tehsilFilter} onChange={(e) => setTehsilFilter(e.target.value)} disabled={disabled} />
          <div className="rounded border border-[#dee2e6] p-1" style={{ height: 120, overflowY: 'auto', background: '#fff', fontSize: '0.8rem' }}>
            {tehsils.filter((t) => t.toLowerCase().includes(tehsilFilter.toLowerCase())).map((t) => (
              <label key={t} className="flex min-h-[28px] cursor-pointer items-center gap-1.5 text-sm">
                <input type="radio" name="saTehsilSelection" checked={tehsil === t} onChange={() => setTehsil(t)} disabled={disabled} />
                {t}
              </label>
            ))}
          </div>
          <div className="mt-2">
            <span className="text-sm font-bold text-ink-2">Assigned ({value.length})</span>
            <div className="mt-1 rounded border border-[#dee2e6]" style={{ maxHeight: 100, overflowY: 'auto', background: '#fff' }}>
              {[...value].sort((a, b) => a.tehsil.localeCompare(b.tehsil)).map((a) => (
                <div key={a.tehsil} className="flex items-center justify-between border-b border-black/10 p-1 px-2 last:border-b-0" style={{ fontSize: '0.8rem' }}>
                  <span className="truncate">{a.tehsil} <Badge bg="secondary" className="text-[0.6rem]">{a.mouzas.length}</Badge></span>
                  {!disabled && (
                    <div className="tehsil-action-buttons flex shrink-0 gap-1">
                      <button type="button" className="btn btn-sm btn-outline-primary" style={{ padding: '0 4px' }} onClick={() => setTehsil(a.tehsil)}><Pencil size={11} /></button>
                      <button type="button" className="btn btn-sm btn-outline-danger" style={{ padding: '0 4px' }} onClick={() => onChange(value.filter((x) => x.tehsil !== a.tehsil))}><Trash2 size={11} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="md:col-span-7">
          <div className="flex items-center justify-between">
            <label className="mb-0 text-sm font-bold">
              Mouzas <span className={atLimit ? 'text-[#dc3545]' : 'text-ink-2'}>({total}{maxMouzas ? ` of ${maxMouzas}` : ''})</span>
            </label>
            <div className="mouza-action-buttons flex gap-1">
              <button type="button" className="btn btn-sm btn-outline-success" style={{ padding: '2px 8px', fontSize: '0.85rem', fontWeight: 'bold', minWidth: 55 }} onClick={selectAll} disabled={disabled || !tehsil || atLimit}>All</button>
              <button type="button" className="btn btn-sm btn-outline-secondary" style={{ padding: '2px 8px', fontSize: '0.85rem', fontWeight: 'bold', minWidth: 65 }} onClick={() => setHere([])} disabled={disabled || !tehsil}>None</button>
            </div>
          </div>
          <input className="input input-sm mb-1" placeholder="Filter..." value={mouzaFilter} onChange={(e) => setMouzaFilter(e.target.value)} disabled={disabled || !tehsil} />
          <div className="rounded border border-[#dee2e6] p-1" style={{ height: 260, overflowY: 'auto', background: '#fff' }}>
            {!tehsil ? <div className="mt-4 text-center text-sm text-ink-2">Select tehsil</div>
              : loading ? <div className="mt-4 text-center"><Spinner size="sm" /></div>
              : sorted.length === 0 ? <div className="mt-4 text-center text-sm text-ink-2">No mouzas found.</div>
              : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                  {sorted.map((m) => {
                    const checked = selectedHere.includes(m);
                    const blocked = !checked && atLimit;
                    return (
                      <div key={m} onClick={() => toggle(m)}
                        style={{ padding: '4px 8px', background: checked ? '#e7f3ff' : 'transparent', borderRadius: 3, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6, cursor: disabled || blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}>
                        <input type="checkbox" checked={checked} readOnly style={{ pointerEvents: 'none' }} />
                        <span>{m}</span>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
          {atLimit && <div className="mt-1 text-sm text-[#dc3545]">Limit of {maxMouzas} mouzas reached. For more, send a request to the admin.</div>}
        </div>
      </div>
    </div>
  );
}
