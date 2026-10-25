// Pedigree chart (shajra nasab) as SVG: square = male, circle = female, slash = deceased,
// double line = marriage, slashed double line = divorce. Colour = inheritance result.
import { useMemo } from 'react';
import { toString, type Case, type ShareResult } from 'inheritance-engine';
import { layout, NODE_H, NODE_W } from './layout.ts';
import { fatherOf, motherOf } from './model.ts';
import { relLabel } from './labels.ts';

const STATUS: Record<string, { fill: string; stroke: string; dash?: string; label: string }> = {
  heir: { fill: '#dcfce7', stroke: '#16a34a', label: 'Heir' },
  excluded: { fill: '#f1f5f9', stroke: '#94a3b8', label: 'Excluded' },
  reserved: { fill: '#fef3c7', stroke: '#d97706', label: 'Reserved' },
  'substituted-s4': { fill: '#dbeafe', stroke: '#2563eb', dash: '5 3', label: 'MFLO s.4' },
};

export default function Tree({ c, results, selected, onSelect }: { c: Case; results: Map<string, ShareResult>; selected: string | null; onSelect: (id: string) => void }) {
  const { nodes, width, height } = useMemo(() => layout(c), [c]);
  const P = 24;
  const sym = 30;
  const cx = (id: string) => nodes.get(id)!.x + NODE_W / 2 + P;
  const top = (id: string) => nodes.get(id)!.y + P;

  // Marriage lines between partners on the same row.
  const unions = c.unions.filter((u) => nodes.get(u.partners[0])?.gen === nodes.get(u.partners[1])?.gen);
  return (
    <svg width={width + P * 2} height={height + P * 2} viewBox={`0 0 ${width + P * 2} ${height + P * 2}`} role="group" aria-label="Family tree (shajra nasab)" className="shajra-tree block">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="2" />
        </pattern>
      </defs>
      {unions.map((u) => {
        const [a, b] = u.partners;
        const [x1, x2] = [cx(a), cx(b)].sort((m, n) => m - n);
        const y = top(a) + sym / 2 + 6;
        const div = u.type !== 'marriage' || c.persons.some((p) => u.partners.includes(p.id) && p.flags.divorced && p.flags.divorced !== 'revocable-in-iddat');
        const mx = (x1 + x2) / 2;
        return (
          <g key={u.id} stroke="#334155" strokeWidth="1.5">
            <line x1={x1 + sym / 2} y1={y - 2} x2={x2 - sym / 2} y2={y - 2} />
            <line x1={x1 + sym / 2} y1={y + 2} x2={x2 - sym / 2} y2={y + 2} />
            {div && <><line x1={mx - 6} y1={y + 7} x2={mx - 1} y2={y - 7} /><line x1={mx + 1} y1={y + 7} x2={mx + 6} y2={y - 7} /></>}
          </g>
        );
      })}
      {c.persons.map((p) => {
        const f = fatherOf(c, p.id), m = motherOf(c, p.id);
        const ps = [f, m].filter((x) => x && nodes.get(x)) as string[];
        if (!ps.length || !nodes.get(p.id)) return null;
        const px = ps.reduce((a, id) => a + cx(id), 0) / ps.length;
        const py = top(ps[0]) + sym / 2 + 6;
        const ky = top(p.id);
        const midY = ky - 22;
        // Agnatic link (through the father) solid, through the mother only dashed.
        const dashed = !f;
        return <path key={`e-${p.id}`} d={`M${px},${py} V${midY} H${cx(p.id)} V${ky}`} fill="none" stroke="#475569" strokeWidth="1.3" strokeDasharray={dashed ? '5 4' : undefined} />;
      })}
      {c.persons.map((p) => {
        const n = nodes.get(p.id);
        if (!n) return null;
        const r = results.get(p.id);
        const st = p.id === c.deceasedId ? null : STATUS[r?.status ?? 'excluded'];
        const x = cx(p.id), y = top(p.id);
        const dead = !p.alive;
        const isD = p.id === c.deceasedId;
        // Revenue-record symbols: male = short vertical branch; daughter = inverted V;
        // wife / widow of a relation = heart turned 90° anticlockwise; a woman who is both a
        // daughter of the family and a wife is drawn with both (the V inside the heart).
        const isWife = p.gender === 'F' && c.unions.some((u) => u.partners.includes(p.id));
        const isDaughter = p.gender === 'F' && !!(fatherOf(c, p.id) || motherOf(c, p.id));
        const shape = <Glyph x={x} y={y} size={sym} kind={p.gender === 'M' ? 'male' : isWife && isDaughter ? 'both' : isWife ? 'wife' : 'daughter'} />;
        const [en, ur] = relLabel(r?.relationKey ?? (isD ? 'deceased' : ''));
        return (
          <g key={p.id} className="cursor-pointer" onClick={() => onSelect(p.id)} tabIndex={0} role="button"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}>
            <rect x={n.x + P + 2} y={n.y + P - 6} width={NODE_W - 4} height={NODE_H + 8} rx="10"
              fill={selected === p.id ? '#e0f2fe' : 'transparent'} stroke={selected === p.id ? '#0284c7' : 'transparent'} />
            <g fill={isD ? '#fff' : r?.status === 'excluded' ? 'url(#hatch)' : st?.fill ?? '#fff'}
              stroke={isD ? '#0f172a' : st?.stroke ?? '#64748b'} strokeWidth={isD ? 3 : 2} strokeDasharray={st?.dash}>
              {shape}
              {isD && <rect x={x - sym / 2 - 5} y={y - 5} width={sym + 10} height={sym + 10} rx="6" fill="none" strokeWidth="1.5" strokeDasharray="4 2" />}
            </g>
            {p.flags.pregnant && <path d={`M${x + sym / 2 + 4},${y + sym} l7,-12 l7,12 z`} fill="none" stroke="#d97706" strokeDasharray="2 2" />}
            {dead && <line x1={x - sym / 2 - 2} y1={y + sym + 2} x2={x + sym / 2 + 2} y2={y - 2} stroke="#0f172a" strokeWidth="2" />}
            <text x={x} y={y + sym + 15} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#0f172a">{(p.name || 'Unnamed').slice(0, 20)}</text>
            <text x={x} y={y + sym + 28} textAnchor="middle" fontSize="10" fill="#334155">{en}{ur ? ` · ${ur}` : ''}</text>
            {r && r.fraction.n > 0n && (
              <g>
                <rect x={x - 30} y={y + sym + 34} width="60" height="17" rx="8.5" fill={st?.stroke ?? '#16a34a'} />
                <text x={x} y={y + sym + 46} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">{toString(r.fraction)}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

type Kind = 'male' | 'daughter' | 'wife' | 'both';

/** Heart (tip down) centred on 0,0, about 2*r wide. */
const heart = (r: number) => `M0,${r} C${-r * 1.5},${-r * 0.1} ${-r * 0.9},${-r * 1.25} 0,${-r * 0.45} C${r * 0.9},${-r * 1.25} ${r * 1.5},${-r * 0.1} 0,${r} Z`;

export function Glyph({ x, y, size, kind }: { x: number; y: number; size: number; kind: Kind }) {
  const cy = y + size / 2;
  const v = (h: number) => `M${x - h * 0.55},${cy + h / 2} L${x},${cy - h / 2} L${x + h * 0.55},${cy + h / 2}`;
  if (kind === 'male') {
    return (
      <g>
        <rect x={x - size / 2} y={y} width={size} height={size} fill="transparent" stroke="none" />
        <line x1={x} y1={y} x2={x} y2={y + size} strokeWidth="3.5" strokeLinecap="round" />
        <line x1={x - 5} y1={y + size} x2={x + 5} y2={y + size} strokeWidth="2" strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'daughter') return <path d={v(size * 0.9)} fill="none" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />;
  return (
    <g>
      {/* Heart turned 90° anticlockwise */}
      <path d={heart(size * 0.5)} transform={`translate(${x},${cy}) rotate(-90)`} strokeWidth="2" />
      {kind === 'both' && <path d={v(size * 0.45)} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
    </g>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
      {([['male', 'Male (son / brother…)'], ['daughter', 'Daughter / sister (inverted V)'], ['wife', 'Wife / widow (heart)'], ['both', 'Daughter and wife']] as [Kind, string][]).map(([k, label]) => (
        <span key={k} className="flex items-center gap-1"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="#fff" stroke="#334155"><Glyph x={9} y={2} size={14} kind={k} /></g></svg> {label}</span>
      ))}
      <span className="flex items-center gap-1"><svg width="14" height="14" aria-hidden="true"><line x1="0" y1="14" x2="14" y2="0" stroke="#000" strokeWidth="1.5" /></svg> Died</span>
      {Object.entries(STATUS).map(([k, s]) => (
        <span key={k} className="flex items-center gap-1"><svg width="12" height="12"><rect x="1" y="1" width="10" height="10" fill={s.fill} stroke={s.stroke} strokeDasharray={s.dash ? '2 1' : undefined} /></svg> {s.label}</span>
      ))}
      <span>═ marriage · ═╱╱ divorce · ─ father line · ┄ mother line</span>
    </div>
  );
}
