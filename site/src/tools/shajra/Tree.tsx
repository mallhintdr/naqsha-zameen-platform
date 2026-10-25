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
/** Sideways heart (leaf) for a wife: rounded body, small notch, point facing away from the husband. */
const leaf = (w: number, h: number, dir: 1 | -1) => {
  const X = (v: number) => v * dir;
  return `M${X(-w + 6)},0 L${X(-w)},${-5} C${X(-w)},${-h * 1.25} ${X(w * 0.25)},${-h * 1.1} ${X(w)},0 C${X(w * 0.25)},${h * 1.1} ${X(-w)},${h * 1.25} ${X(-w)},${5} Z`;
};

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

export default function Tree({ c, results, selected, onSelect, menu, printMode }: {
  c: Case; results: Map<string, ShareResult>; selected: string | null; onSelect: (id: string) => void; menu?: ReactNode; printMode?: boolean;
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

  // Children are grouped by their parents (as a patwari draws them: each wife's children hang
  // from her own bar, joined to the husband's line).
  const families = new Map<string, { father?: string; mother?: string; kids: string[] }>();
  for (const p of c.persons) {
    if (!nodes.get(p.id)) continue;
    const f = fatherOf(c, p.id), m = motherOf(c, p.id);
    const fa = f && nodes.get(f) ? f : undefined, mo = m && nodes.get(m) ? m : undefined;
    if (!fa && !mo) continue;
    const key = `${fa ?? ''}|${mo ?? ''}`;
    const fam = families.get(key) ?? { father: fa, mother: mo, kids: [] };
    fam.kids.push(p.id);
    families.set(key, fam);
  }
  /** +1: heart points right (wife on the husband's right), -1: points left. */
  const tipDir = (id: string): 1 | -1 => {
    const h = c.unions.filter((u) => u.partners.includes(id)).map((u) => u.partners.find((x) => x !== id)!).find((x) => nodes.get(x));
    return h && cx(h) > cx(id) ? -1 : 1;
  };
  const statusOf = (id: string) => {
    const p = c.persons.find((x) => x.id === id)!;
    if (id === c.deceasedId) return 'حال متوفی';
    if (p.alive) return '(ز)';
    return p.dateOfDeath && p.dateOfDeath > c.dateOfDeath ? 'بعد میں فوت شدہ' : 'پہلے فوت شدہ';
  };

  const sel = selected ? nodes.get(selected) : null;
  return (
    <div className="relative" style={printMode ? { width: '100%' } : { width: width + P * 2, minHeight: height + P * 2 }}>
      <svg width={printMode ? '100%' : width + P * 2} height={printMode ? undefined : height + P * 2} viewBox={`0 0 ${width + P * 2} ${height + P * 2}`} role="group" aria-label="Family tree (shajra nasab)" className={printMode ? 'shajra-tree-print block' : 'shajra-tree block'} style={{ background: '#fffdf6' }}>
        {/* Lines of descent: parent stroke -> bar over the children -> each child */}
        <g stroke={INK} strokeWidth="1.3" fill="none">
          {[...families.values()].map(({ father, mother, kids }, fi) => {
            const ky = Math.min(...kids.map((k) => top(k)));
            const bar = ky - 16 - (fi % 3) * 14; // each couple's bar on its own level
            const xs = kids.map(cx);
            // Draw the mother's branch only when the father has more than one wife in the tree
            // (children are then grouped by mother) or when the father is not in the tree.
            const wivesOfFather = father ? c.unions.filter((u) => u.partners.includes(father)).length : 0;
            const drops = (father ? (mother && wivesOfFather > 1 ? [father, mother] : [father]) : [mother]).filter(Boolean) as string[];
            const parentBottom = (id: string) => top(id) + sym + (kindOf(id) === 'wife' || kindOf(id) === 'both' ? 44 : 60); // below the name, status and share
            // A wife's line starts from the outer side of her heart, so it never runs into a child's line.
            const dropX = (id: string) => (kindOf(id) === 'wife' || kindOf(id) === 'both' ? cx(id) + tipDir(id) * 24 : cx(id));
            const all = [...xs, ...drops.map(dropX)];
            return (
              <g key={`f-${fi}`} strokeDasharray={!father ? '4 3' : undefined}>
                {drops.map((d) => <line key={d} x1={dropX(d)} y1={parentBottom(d) - (dropX(d) !== cx(d) ? 22 : 0)} x2={dropX(d)} y2={bar} />)}
                <line x1={Math.min(...all)} y1={bar} x2={Math.max(...all)} y2={bar} />
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
                <line x1={x1 + (cx(a) === x1 && kindOf(a).match(/wife|both/) || cx(b) === x1 && kindOf(b).match(/wife|both/) ? 52 : 6)} y1={y} x2={x2 - (cx(a) === x2 && kindOf(a).match(/wife|both/) || cx(b) === x2 && kindOf(b).match(/wife|both/) ? 52 : 6)} y2={y} />
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
            <g key={p.id} className={printMode ? undefined : 'cursor-pointer'} onClick={printMode ? undefined : () => onSelect(p.id)} tabIndex={printMode ? undefined : 0} role={printMode ? undefined : 'button'} aria-haspopup={printMode ? undefined : 'menu'}
              aria-label={`${nm}, ${en}${r && !isD ? `, share ${shareTxt}` : ''}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}>
              <title>{`${nm} · ${en}${ur ? ` · ${ur}` : ''}`}</title>
              {isD && <rect x={n.x + P + 4} y={n.y + P - 16} width={NODE_W - 8} height={sym + 62} rx="4" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="2 3" />}
              <rect x={n.x + P + 2} y={n.y + P - 20} width={NODE_W - 4} height={sym + 72} rx="8" fill={selected === p.id ? 'rgba(14,165,233,0.10)' : 'transparent'} stroke={selected === p.id ? '#0ea5e9' : 'none'} strokeDasharray="3 3" />
              {(() => {
                const k = kindOf(p.id);
                const inHeart = k === 'wife' || k === 'both';
                const nameY = inHeart ? y + sym / 2 + 5 : y + sym + (hasUrdu(nm) ? 22 : 16);
                const below = inHeart ? y + sym + 24 : y + sym + (hasUrdu(nm) ? 42 : 30);
                return (
                  <>
                    {inHeart ? (
                      <g stroke={INK}>
                        {/* Big sideways heart with the name written inside, like the patwari's sketch */}
                        <path d={leaf(52, 26, tipDir(p.id))} transform={`translate(${x},${y + sym / 2})`} fill="#fffdf6" strokeWidth="1.4" />
                        {k === 'both' && <path d={`M${x - 46},${y + sym / 2 + 8} L${x - 40},${y + sym / 2 - 6} L${x - 34},${y + sym / 2 + 8}`} fill="none" strokeWidth="1.6" />}
                      </g>
                    ) : k === 'daughter' ? (
                      <path d={`M${x - 26},${y + sym + 2} L${x},${y - 2} L${x + 26},${y + sym + 2}`} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
                    ) : (
                      <line x1={x} y1={y} x2={x} y2={y + sym} stroke={INK} strokeWidth="1.6" />
                    )}
                    {p.flags.pregnant && <path d={`M${x + 30},${y + sym} l6,-10 l6,10 z`} fill="none" stroke="#b45309" strokeDasharray="2 2" />}
                    <text x={x} y={nameY} textAnchor="middle" fontSize={hasUrdu(nm) ? 13 : 11.5} fontWeight={isD ? 800 : 600} fill={INK}
                      fontFamily={hasUrdu(nm) ? URDU_FONT : undefined}>{nm.slice(0, inHeart ? 16 : 22)}</text>
                    {/* Status in red, as the patwari writes it */}
                    <text x={isD ? x - 8 : x} y={isD ? y + 6 : below} textAnchor={isD ? 'end' : 'middle'} fontSize="10.5" fill="#dc2626" fontFamily={URDU_FONT} className="urdu">{statusOf(p.id)}</text>
                    {!isD && shareTxt && (
                      <text x={x} y={below + 15} textAnchor="middle" fontSize="11" fontWeight="700" fill={SHARE_COLOR[r?.status ?? 'excluded']}>({shareTxt})</text>
                    )}
                  </>
                );
              })()}
            </g>
          );
        })}
      </svg>
      {sel && menu && (
        <div className="absolute z-20" style={{ left: Math.max(4, Math.min(sel.x + P + NODE_W / 2 - 100, width + P * 2 - 210)), top: sel.y + P + sym + 58 }}>
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
