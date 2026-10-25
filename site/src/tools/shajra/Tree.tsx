// Shajra nasab drawn the way a patwari draws it: thin ink lines on paper, a short stroke per
// person with the name written under it, sons and daughters hanging from their father's line,
// wives attached beside their husband. Male = vertical stroke; daughter = inverted V;
// wife / widow = heart turned 90° anticlockwise; a daughter who is also a wife = both.
// Tapping a person opens a small menu (Edit / Add relative / Delete), rendered by the parent.
import { useMemo, type ReactNode } from 'react';
import { toString, type Case, type ShareResult } from 'inheritance-engine';
import { layout, NODE_W } from './layout.ts';
import { fatherOf, motherOf } from './model.ts';
import { relLabel } from './labels.ts';

const INK = '#1f2937';
const SHARE_COLOR: Record<string, string> = { heir: '#15803d', excluded: '#9ca3af', reserved: '#b45309', 'substituted-s4': '#1d4ed8' };
const hasUrdu = (s: string) => /[؀-ۿ]/.test(s);
const URDU_FONT = "'Noto Nastaliq Urdu', serif";

type Kind = 'male' | 'daughter' | 'wife' | 'both';

/** Heart (tip down) centred on 0,0, about 2*r wide. */
const heart = (r: number) => `M0,${r} C${-r * 1.5},${-r * 0.1} ${-r * 0.9},${-r * 1.25} 0,${-r * 0.45} C${r * 0.9},${-r * 1.25} ${r * 1.5},${-r * 0.1} 0,${r} Z`;

export function Glyph({ x, y, size, kind }: { x: number; y: number; size: number; kind: Kind }) {
  const cy = y + size / 2;
  const v = (h: number) => `M${x - h * 0.55},${cy + h / 2} L${x},${cy - h / 2} L${x + h * 0.55},${cy + h / 2}`;
  if (kind === 'male') return <line x1={x} y1={y} x2={x} y2={y + size} strokeWidth="2.4" strokeLinecap="round" />;
  if (kind === 'daughter') return <path d={v(size * 0.85)} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />;
  return (
    <g>
      <path d={heart(size * 0.42)} transform={`translate(${x},${cy}) rotate(-90)`} fill="#fffdf6" strokeWidth="1.6" />
      {kind === 'both' && <path d={v(size * 0.4)} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />}
    </g>
  );
}

export default function Tree({ c, results, selected, onSelect, menu }: {
  c: Case; results: Map<string, ShareResult>; selected: string | null; onSelect: (id: string) => void; menu?: ReactNode;
}) {
  const { nodes, width, height } = useMemo(() => layout(c), [c]);
  const P = 28;
  const sym = 26;
  const cx = (id: string) => nodes.get(id)!.x + NODE_W / 2 + P;
  const top = (id: string) => nodes.get(id)!.y + P;
  const kindOf = (id: string): Kind => {
    const p = c.persons.find((x) => x.id === id)!;
    if (p.gender === 'M') return 'male';
    const wife = c.unions.some((u) => u.partners.includes(id));
    const daughter = !!(fatherOf(c, id) || motherOf(c, id));
    return wife && daughter ? 'both' : wife ? 'wife' : 'daughter';
  };

  // Children hang from their father's line (or the mother's when no father is in the tree).
  const families = new Map<string, string[]>();
  for (const p of c.persons) {
    const f = fatherOf(c, p.id), m = motherOf(c, p.id);
    const parent = f && nodes.get(f) ? f : m && nodes.get(m) ? m : null;
    if (parent && nodes.get(p.id)) families.set(parent, [...(families.get(parent) ?? []), p.id]);
  }

  const sel = selected ? nodes.get(selected) : null;
  return (
    <div className="relative" style={{ width: width + P * 2, minHeight: height + P * 2 }}>
      <svg width={width + P * 2} height={height + P * 2} viewBox={`0 0 ${width + P * 2} ${height + P * 2}`} role="group" aria-label="Family tree (shajra nasab)" className="shajra-tree block" style={{ background: '#fffdf6' }}>
        {/* Lines of descent: parent stroke -> bar over the children -> each child */}
        <g stroke={INK} strokeWidth="1.3" fill="none">
          {[...families].map(([parent, kids]) => {
            const px = cx(parent);
            const py = top(parent) + sym + 44; // below the parent's name and share
            const ky = Math.min(...kids.map((k) => top(k)));
            const bar = ky - 14;
            const xs = kids.map(cx);
            const viaMother = c.persons.find((x) => x.id === parent)?.gender === 'F';
            return (
              <g key={`f-${parent}`} strokeDasharray={viaMother ? '4 3' : undefined}>
                <line x1={px} y1={py} x2={px} y2={bar} />
                <line x1={Math.min(px, ...xs)} y1={bar} x2={Math.max(px, ...xs)} y2={bar} />
                {kids.map((k) => <line key={k} x1={cx(k)} y1={bar} x2={cx(k)} y2={top(k)} />)}
              </g>
            );
          })}
          {/* Marriage: wife attached beside the husband; divorce shown with two slashes */}
          {c.unions.map((u) => {
            const [a, b] = u.partners;
            const na = nodes.get(a), nb = nodes.get(b);
            if (!na || !nb || na.gen !== nb.gen) return null;
            const [x1, x2] = [cx(a), cx(b)].sort((m, n) => m - n);
            const y = top(a) + sym / 2;
            const div = u.type !== 'marriage' || c.persons.some((p) => u.partners.includes(p.id) && p.flags.divorced && p.flags.divorced !== 'revocable-in-iddat');
            const mx = (x1 + x2) / 2;
            return (
              <g key={u.id}>
                <line x1={x1 + 8} y1={y} x2={x2 - 14} y2={y} />
                {div && <><line x1={mx - 5} y1={y + 6} x2={mx - 1} y2={y - 6} /><line x1={mx + 1} y1={y + 6} x2={mx + 5} y2={y - 6} /></>}
              </g>
            );
          })}
        </g>

        {c.persons.map((p) => {
          const n = nodes.get(p.id);
          if (!n) return null;
          const r = results.get(p.id);
          const x = cx(p.id), y = top(p.id);
          const isD = p.id === c.deceasedId;
          const [en, ur] = relLabel(r?.relationKey ?? (isD ? 'deceased' : ''));
          const nm = (p.name || 'Unnamed').slice(0, 22);
          const shareTxt = isD ? 'متوفی' : r ? (r.fraction.n > 0n ? toString(r.fraction) : '—') : '';
          return (
            <g key={p.id} className="cursor-pointer" onClick={() => onSelect(p.id)} tabIndex={0} role="button" aria-haspopup="menu"
              aria-label={`${nm}, ${en}${r && !isD ? `, share ${shareTxt}` : ''}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}>
              <title>{`${nm} · ${en}${ur ? ` · ${ur}` : ''}`}</title>
              <rect x={n.x + P + 6} y={n.y + P - 6} width={NODE_W - 12} height={sym + 54} rx="8" fill={selected === p.id ? 'rgba(14,165,233,0.10)' : 'transparent'} stroke={selected === p.id ? '#0ea5e9' : 'none'} strokeDasharray="3 3" />
              <g stroke={INK} fill="none"><Glyph x={x} y={y} size={sym} kind={kindOf(p.id)} /></g>
              {!p.alive && <line x1={x - 9} y1={y + sym - 2} x2={x + 9} y2={y + 2} stroke={INK} strokeWidth="1.4" />}
              {p.flags.pregnant && <path d={`M${x + 12},${y + sym} l6,-10 l6,10 z`} fill="none" stroke="#b45309" strokeDasharray="2 2" />}
              <text x={x} y={y + sym + 16} textAnchor="middle" fontSize={hasUrdu(nm) ? 13 : 12} fontWeight={isD ? 800 : 600} fill={INK}
                fontFamily={hasUrdu(nm) ? URDU_FONT : undefined} textDecoration={isD ? 'underline' : undefined}>{nm}</text>
              <text x={x} y={y + sym + (hasUrdu(nm) ? 40 : 32)} textAnchor="middle" fontSize="11.5" fontWeight="700"
                fill={isD ? '#475569' : SHARE_COLOR[r?.status ?? 'excluded']} fontFamily={isD ? URDU_FONT : undefined} className={isD ? 'urdu' : undefined}>
                {isD ? shareTxt : shareTxt ? `(${shareTxt})` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {sel && menu && (
        <div className="absolute z-20" style={{ left: Math.max(4, Math.min(sel.x + P + NODE_W / 2 - 100, width + P * 2 - 210)), top: sel.y + P + sym + 52 }}>
          {menu}
        </div>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
      {([['male', 'Male (son / brother…)'], ['daughter', 'Daughter / sister (Λ)'], ['wife', 'Wife / widow (heart)'], ['both', 'Daughter and wife']] as [Kind, string][]).map(([k, label]) => (
        <span key={k} className="flex items-center gap-1"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="none" stroke={INK}><Glyph x={9} y={2} size={14} kind={k} /></g></svg> {label}</span>
      ))}
      <span className="flex items-center gap-1"><svg width="14" height="14" aria-hidden="true"><line x1="2" y1="12" x2="12" y2="2" stroke={INK} strokeWidth="1.5" /></svg> Died</span>
      <span><b className="text-green-700">(1/4)</b> heir · <b className="text-slate-500">(—)</b> excluded · <b className="text-amber-700">amber</b> reserved · <b className="text-blue-700">blue</b> MFLO s.4</span>
      <span>── father line · ┄┄ mother line · ─ marriage · ─╱╱ divorce</span>
    </div>
  );
}
