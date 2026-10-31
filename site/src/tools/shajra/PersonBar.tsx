// Quick bar shown right under a tapped person: everything about that person is typed here
// (name, gender, alive / died with date, CNIC; for the deceased also the father's name when the
// father is not on the tree), plus Move, Add relative and Delete. Rarely needed facts sit under
// "More". There is no separate form: one place per fact.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toString, type Case, type Person, type ShareResult } from 'inheritance-engine';
import { fatherOf, motherOf, type AddKind } from './model.ts';
import { relLabel, ruleText } from './labels.ts';
import { formatCnic } from './Attest.tsx';

const ADD: { kind: AddKind; label: string; ur: string }[] = [
  { kind: 'father', label: 'Father', ur: 'والد' }, { kind: 'mother', label: 'Mother', ur: 'والدہ' }, { kind: 'spouse', label: 'Spouse', ur: 'زوج' },
  { kind: 'son', label: 'Son', ur: 'بیٹا' }, { kind: 'daughter', label: 'Daughter', ur: 'بیٹی' }, { kind: 'brother', label: 'Brother', ur: 'بھائی' }, { kind: 'sister', label: 'Sister', ur: 'بہن' },
];

// 16px text on phones so the browser does not zoom in when a box is tapped.
const field = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:text-sm';
const act = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus:border-sky-500 focus:bg-sky-50 focus:outline-none';
const seg = (on: boolean) => `flex-1 px-2.5 py-2 text-sm font-semibold sm:flex-none sm:py-1.5 sm:text-xs ${on ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;

export default function PersonBar({ c, p, share, addOpen, setAddOpen, onPatch, onGender, onParent, onAdd, onDelete, onMove, onClose }: {
  c: Case; p: Person; share?: ShareResult; addOpen: boolean; setAddOpen: (v: boolean) => void;
  onPatch: (x: Partial<Person>) => void; onGender: (g: 'M' | 'F') => void;
  onParent: (role: 'fatherId' | 'motherId', id: string | undefined) => void;
  onAdd: (k: AddKind) => void; onDelete: () => void; onMove: (dir: -1 | 1) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const isD = p.id === c.deceasedId;
  // Opening on a person: the name is ready to type over (new relatives start with a placeholder name).
  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    setMore(false);
  }, [p.id]);
  useEffect(() => { if (addOpen) ref.current?.querySelector<HTMLButtonElement>('[data-rel] button')?.focus({ preventScroll: true }); }, [addOpen]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (addOpen) setAddOpen(false); else onClose(); return; }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); onClose(); return; }
    // Arrow keys move between buttons only; inside a text box they move the cursor.
    if ((e.target as HTMLElement).tagName !== 'BUTTON') return;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown', back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back) return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (fwd ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const [en, ur] = relLabel(share?.relationKey ?? (isD ? 'deceased' : ''));
  const treeFather = c.persons.find((x) => x.id === fatherOf(c, p.id));
  const isSpouseOfD = c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId));
  const others = c.persons.filter((x) => x.id !== p.id);
  const flags = p.flags;
  const flag = (k: keyof Person['flags'], v: unknown) => onPatch({ flags: { ...flags, [k]: v || undefined } });

  return (
    <div ref={ref} role="menu" aria-label={`Details of ${p.name || 'this person'}`} onKeyDown={onKey}
      className="person-bar fixed inset-x-0 bottom-0 z-[2500] max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-3 text-slate-900 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] sm:static sm:max-h-none sm:w-[min(540px,92vw)] sm:overflow-visible sm:rounded-xl sm:border sm:p-2 sm:shadow-xl">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
      {/* Who: relation and share */}
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-wide">{isD ? 'Deceased' : en || 'Relative'}</span>
        {ur && <span className="urdu" lang="ur">{ur}</span>}
        {share && !isD && <span className="font-mono font-semibold text-slate-700">{share.fraction.n > 0n ? toString(share.fraction) : share.status === 'excluded' ? 'no share' : ''}</span>}
        <button aria-label="Close" className="ml-auto rounded px-1.5 text-base leading-none text-slate-500 hover:bg-slate-100" onClick={onClose}>×</button>
      </div>

      {/* Name, gender */}
      <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
        <input ref={nameRef} className={`${field} w-full font-semibold sm:w-auto sm:min-w-0 sm:flex-1`} aria-label="Name" placeholder="Name" value={p.name}
          onFocus={(e) => e.target.select()} onChange={(e) => onPatch({ name: e.target.value })} />
        <div className="flex overflow-hidden rounded-lg border border-slate-300 sm:inline-flex" role="group" aria-label="Gender">
          <button className={seg(p.gender === 'M')} aria-pressed={p.gender === 'M'} onClick={() => onGender('M')}>M</button>
          <button className={seg(p.gender === 'F')} aria-pressed={p.gender === 'F'} onClick={() => onGender('F')}>F</button>
        </div>
      </div>

      {/* Father's name (deceased, when the father is not on the tree), alive / died, CNIC */}
      <div className="mt-1.5 flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
        {isD && !treeFather && (
          <input className={`${field} w-full sm:w-auto sm:min-w-[9rem] sm:flex-1`} aria-label="Father's name" placeholder={p.gender === 'F' ? "Father's name (d/o)" : "Father's name (s/o)"}
            value={p.fatherName ?? ''} onChange={(e) => onPatch({ fatherName: e.target.value })} />
        )}
        {!isD && (
          <div className="flex overflow-hidden rounded-lg border border-slate-300 sm:inline-flex" role="group" aria-label="Alive or died">
            <button className={seg(p.alive)} aria-pressed={p.alive} onClick={() => onPatch({ alive: true, dateOfDeath: undefined })}>Alive</button>
            <button className={seg(!p.alive)} aria-pressed={!p.alive} onClick={() => onPatch({ alive: false })}>Died</button>
          </div>
        )}
        {(isD || !p.alive) && (
          <label className="flex items-center gap-2 text-xs text-slate-500 sm:gap-1 sm:text-[11px]">{isD ? 'Date of death' : <><span className="sm:hidden">Date of death</span><span className="hidden sm:inline">on</span></>}
            <input type="date" className={`${field} flex-1 sm:flex-none`} value={(isD ? c.dateOfDeath : p.dateOfDeath) ?? ''} onChange={(e) => onPatch({ dateOfDeath: e.target.value })} />
          </label>
        )}
        {!isD && (
          <input className={`${field} w-full sm:w-[10.5rem]`} inputMode="numeric" aria-label="CNIC" placeholder="CNIC 12345-1234567-1" value={p.cnic ?? ''}
            onChange={(e) => onPatch({ cnic: formatCnic(e.target.value) })} />
        )}
      </div>
      {!isD && !p.alive && (
        <p className="mt-1 text-[11px] text-slate-500">{p.dateOfDeath && p.dateOfDeath > c.dateOfDeath ? 'Died after the deceased: inherits, then use “Distribute onward” in the share table.' : 'Died before the deceased (or no date): does not inherit; MFLO s.4 may pass a child’s share to their children.'}</p>
      )}

      {/* Actions */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
        <button role="menuitem" className={act} onClick={() => onMove(-1)} title="Move left" aria-label="Move left">◀</button>
        <button role="menuitem" className={act} onClick={() => onMove(1)} title="Move right" aria-label="Move right">▶</button>
        <button role="menuitem" className={`${act} ${addOpen ? '!border-sky-500 !bg-sky-50' : ''}`} aria-expanded={addOpen} onClick={() => { setAddOpen(!addOpen); setMore(false); }}>➕ Add relative</button>
        {!isD && <button role="menuitem" className={`${act} ${more ? '!border-sky-500 !bg-sky-50' : ''}`} aria-expanded={more} onClick={() => { setMore(!more); setAddOpen(false); }}>⋯ More</button>}
        {!isD && <button role="menuitem" className={`${act} ml-auto !text-red-700`} onClick={onDelete}>🗑️ Delete</button>}
      </div>

      {addOpen && (
        <div data-rel role="group" aria-label="Add relative" className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-100 pt-1.5">
          {ADD.map((a) => {
            // A man gets a wife, a woman a husband.
            const [label, u] = a.kind === 'spouse' ? (p.gender === 'M' ? ['Wife', 'بیوی'] : ['Husband', 'شوہر']) : [a.label, a.ur];
            return (
              <button key={a.kind} role="menuitem" className={`${act} !px-2 !py-1`} onClick={() => onAdd(a.kind)}>
                {label} <span className="urdu text-[11px] font-normal text-slate-500" lang="ur">{u}</span>
              </button>
            );
          })}
        </div>
      )}

      {more && !isD && (
        <div className="mt-1.5 grid gap-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-700 sm:grid-cols-2">
          <label className="flex items-center gap-1">Father
            <select className={`${field} min-w-0 flex-1 !py-1 !text-xs`} value={fatherOf(c, p.id) ?? ''} onChange={(e) => onParent('fatherId', e.target.value || undefined)}>
              <option value="">—</option>{others.filter((x) => x.gender === 'M').map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Mother
            <select className={`${field} min-w-0 flex-1 !py-1 !text-xs`} value={motherOf(c, p.id) ?? ''} onChange={(e) => onParent('motherId', e.target.value || undefined)}>
              <option value="">—</option>{others.filter((x) => x.gender === 'F').map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Religion
            <select className={`${field} min-w-0 flex-1 !py-1 !text-xs`} value={p.religion} onChange={(e) => onPatch({ religion: e.target.value })}>
              {['muslim', 'christian', 'hindu', 'sikh', 'parsi', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Caused the death
            <select className={`${field} min-w-0 flex-1 !py-1 !text-xs`} value={flags.killedDeceased ?? ''} onChange={(e) => flag('killedDeceased', e.target.value)}>
              <option value="">No</option><option value="intentional">Yes, intentionally</option><option value="negligent">Yes, by negligence</option>
            </select>
          </label>
          {isSpouseOfD && (
            <label className="flex items-center gap-1 sm:col-span-2">Divorce
              <select className={`${field} min-w-0 flex-1 !py-1 !text-xs`} value={flags.divorced ?? ''} onChange={(e) => flag('divorced', e.target.value)}>
                <option value="">Not divorced</option><option value="revocable-in-iddat">Revocable talaq, still in iddat</option><option value="irrevocable">Irrevocable talaq</option><option value="khula">Khula</option>
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 sm:col-span-2">
            {p.gender === 'F' && isSpouseOfD && <label className="flex items-center gap-1"><input type="checkbox" checked={!!flags.pregnant} onChange={(e) => flag('pregnant', e.target.checked)} /> Pregnant</label>}
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!flags.missing} onChange={(e) => flag('missing', e.target.checked)} /> Missing</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!flags.adopted} onChange={(e) => flag('adopted', e.target.checked)} /> Adopted</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!flags.illegitimate} onChange={(e) => flag('illegitimate', e.target.checked)} /> Born outside marriage</label>
          </div>
          {share && share.reasons.length > 0 && <p className="text-[11px] text-slate-500 sm:col-span-2">{share.reasons.map((r) => ruleText(r.ruleId)).join(' ')}</p>}
        </div>
      )}
    </div>
  );
}
