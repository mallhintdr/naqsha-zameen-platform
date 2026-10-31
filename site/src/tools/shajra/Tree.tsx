// Shajra nasab drawn the way a patwari draws it: thin ink lines on paper, a short stroke per
// person with the name written under it, sons and daughters hanging from their father's line,
// wives attached beside their husband. Male = vertical stroke; daughter = inverted V;
// wife / widow = heart turned 90° anticlockwise; a daughter who is also a wife = both.
// Tapping a person opens a small menu (Edit / Add relative / Delete), rendered by the parent.
import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toString, type Case, type ShareResult } from 'inheritance-engine';
import { layout, NODE_W, type Spacing } from './layout.ts';
import { fatherOf, motherOf } from './model.ts';
import { relLabel } from './labels.ts';

const INK = '#1f2937';
const SHARE_COLOR: Record<string, string> = { heir: '#15803d', excluded: '#9ca3af', reserved: '#b45309', 'substituted-s4': '#1d4ed8' };
const hasUrdu = (s: string) => /[؀-ۿ]/.test(s);
const URDU_FONT = "'Noto Nastaliq Urdu', serif";

type Kind = 'male' | 'daughter' | 'wife' | 'both';

/** Sideways heart (leaf) for a wife: rounded body, small notch, point facing away from the husband. */
const leaf = (w: number, h: number, dir: 1 | -1) => {
  const X = (v: number) => v * dir;
  return `M${X(-w + 6)},0 L${X(-w)},${-5} C${X(-w)},${-h * 1.25} ${X(w * 0.25)},${-h * 1.1} ${X(w)},0 C${X(w * 0.25)},${h * 1.1} ${X(-w)},${h * 1.25} ${X(-w)},${5} Z`;
};

/** Splits a name into at most two lines of about `max` characters (at a space when possible). */
function splitName(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const cut = s.lastIndexOf(' ', max + 2);
  const at = cut > 2 ? cut : max;
  const rest = s.slice(at).trim();
  return [s.slice(0, at).trim(), rest.length > max + 2 ? `${rest.slice(0, max + 1)}…` : rest];
}

const heart = (r: number) => `M0,${r} C${-r * 1.5},${-r * 0.1} ${-r * 0.9},${-r * 1.25} 0,${-r * 0.45} C${r * 0.9},${-r * 1.25} ${r * 1.5},${-r * 0.1} 0,${r} Z`;

export function Glyph({ x, y, size, kind }: { x: number; y: number; size: number; kind: Kind }) {
  const cy = y + size / 2;
  const v = (h: number, cx = x, midY = cy) => `M${cx - h * 0.55},${midY + h / 2} L${cx},${midY - h / 2} L${cx + h * 0.55},${midY + h / 2}`;
  if (kind === 'male') return <line x1={x} y1={y} x2={x} y2={y + size} strokeWidth="2.4" strokeLinecap="round" />;
  if (kind === 'daughter') return <path d={v(size * 0.85)} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />;
  if (kind === 'both') {
    return (
      <g>
        <path d={v(size * 0.345, x, y + size * 0.22)} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <path d={leaf(size * 0.36, size * 0.22, 1)} transform={`translate(${x},${y + size * 0.72})`} fill="#fffdf6" strokeWidth="1.3" />
      </g>
    );
  }
  return (
    <g>
      <path d={heart(size * 0.42)} transform={`translate(${x},${cy}) rotate(-90)`} fill="#fffdf6" strokeWidth="1.6" />
    </g>
  );
}

export default function Tree({ c, results, selected, onSelect, menu, printMode, printSize, spacing }: {
  c: Case; results: Map<string, ShareResult>; selected: string | null; onSelect: (id: string) => void; menu?: ReactNode; printMode?: boolean;
  /** Print: drawn size in mm (the sheet works it out so the tree fits the page). */
  printSize?: { w: number; h: number };
  /** Print: people drawn closer together for a large shajra (see sheetPlan). */
  spacing?: Spacing;
}) {
  const { nodes, width, height } = useMemo(() => layout(c, spacing), [c, spacing?.h, spacing?.v]);
  const P = 28;
  /** Extra room at the top for the long stem where a family line starts (a root with no parents drawn). */
  const STEM = 28;
  const sym = 26;
  const cx = (id: string) => nodes.get(id)!.x + NODE_W / 2 + P;
  const top = (id: string) => nodes.get(id)!.y + P + STEM;
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
  /** A man who married into the family (no parents in the tree): drawn as his name only. */
  const isInLaw = (id: string) => {
    const p = c.persons.find((x) => x.id === id)!;
    return p.gender === 'M' && id !== c.deceasedId && !fatherOf(c, id) && !motherOf(c, id) && c.unions.some((u) => u.partners.includes(id))
      && !c.parents.some((l) => l.fatherId === id); // a man with children in the tree keeps his stroke
  };
  /** +1: heart points right (wife on the husband's right), -1: points left. */
  const tipDir = (id: string): 1 | -1 => {
    const h = c.unions.filter((u) => u.partners.includes(id)).map((u) => u.partners.find((x) => x !== id)!).find((x) => nodes.get(x));
    return h && cx(h) > cx(id) ? -1 : 1;
  };
  /** X where the line from the parents meets a child: always the child's centre, so stems are straight. */
  const childAnchorX = (id: string) => cx(id);
  /** Y where the parent descent line meets the child's glyph top. */
  const childAnchorY = (id: string) => (kindOf(id) === 'both' ? top(id) - 11 : top(id));

  // Every family's bar (the line the sons and daughters hang from) sits at the same height in a row;
  // a second level is used only where two families' bars would run into each other.
  const famList = [...families.values()];
  /** Whose line the children hang from: the father's; but when he has more than one wife, each
   *  wife's children hang from her own line (a separate family per wife), and from the mother's
   *  when the father is not in the tree. */
  const dropsOf = ({ father, mother }: { father?: string; mother?: string }) => {
    const wivesOfFather = father ? c.unions.filter((u) => u.partners.includes(father)).length : 0;
    return (father ? (mother && wivesOfFather > 1 ? [mother] : [father]) : [mother]).filter(Boolean) as string[];
  };
  const barLevel = new Map<number, number>();
  {
    const span = (f: (typeof famList)[number]) => {
      const xs = [...f.kids.map((k) => cx(k)), ...dropsOf(f).map((p) => cx(p))];
      return [Math.min(...xs) - 20, Math.max(...xs) + 20];
    };
    const byRow = new Map<number, number[]>();
    famList.forEach((f, i) => { const ky = Math.min(...f.kids.map((k) => top(k))); byRow.set(ky, [...(byRow.get(ky) ?? []), i]); });
    for (const ids of byRow.values()) {
      const ends: number[] = []; // right end of the last bar on each level
      ids.sort((a, b) => span(famList[a])[0] - span(famList[b])[0]);
      for (const i of ids) {
        const [l, r] = span(famList[i]);
        let lv = ends.findIndex((e) => e < l);
        if (lv < 0) { lv = ends.length; ends.push(r); } else ends[lv] = r;
        barLevel.set(i, lv);
      }
    }
  }

  /** Divorced (irrevocable talaq, khula, or a union recorded as ended): the spouse of the deceased,
   *  or else the wife of the couple. A revocable talaq still in iddat is not counted: she still inherits. */
  const isDivorced = (id: string) => {
    const p = c.persons.find((x) => x.id === id)!;
    if (id === c.deceasedId) return false;
    if (p.flags.divorced && p.flags.divorced !== 'revocable-in-iddat') return true;
    return c.unions.some((u) => u.type !== 'marriage' && u.partners.includes(id)
      && (u.partners.includes(c.deceasedId) || (p.gender === 'F' && !u.partners.includes(c.deceasedId))));
  };

  const statusOf = (id: string) => {
    const p = c.persons.find((x) => x.id === id)!;
    if (id === c.deceasedId) return 'حال متوفی';
    if (p.alive) return '(ز)';
    return p.dateOfDeath && p.dateOfDeath > c.dateOfDeath ? 'بعد میں فوت شدہ' : 'پہلے فوت شدہ';
  };

  /** What is written under a person: share text, (محروم), divorced, and where that text ends. */
  const labelInfo = (id: string) => {
    const p = c.persons.find((x) => x.id === id)!;
    const r = results.get(id);
    const isD = id === c.deceasedId;
    const predeceased = !isD && !p.alive && !!p.dateOfDeath && p.dateOfDeath <= c.dateOfDeath;
    const zero = !isD && !!r && r.fraction.n === 0n && r.status === 'excluded';
    const mahroom = zero && !predeceased;
    const divorced = isDivorced(id);
    const shareTxt = isD || (zero && predeceased) ? '' : r ? (r.fraction.n > 0n ? toString(r.fraction) : mahroom ? 'محروم' : '—') : '';
    // Status line (ز / پہلے فوت شدہ / حال متوفی) and the lines under it.
    const k = kindOf(id), y = top(id);
    const nm = p.name || 'Tap to add name';
    const inLaw = isInLaw(id);
    const spouseOfBoth = inLaw && c.unions.some((u) => u.partners.includes(id) && u.partners.some((o) => o !== id && kindOf(o) === 'both'));
    const inLawY = spouseOfBoth ? y + 29 : y + sym / 2 + 4;
    const below = k === 'wife' ? y + sym + 34 : k === 'both' ? y + 25 + 40 : inLaw ? inLawY + 18 : y + sym + (hasUrdu(nm) ? 40 : 29);
    // Date of death right under پہلے فوت شدہ / بعد میں فوت شدہ / حال متوفی (can be switched off).
    const showDates = (c as Case & { print?: { showDates?: boolean } }).print?.showDates !== false;
    const dod = !p.alive ? p.dateOfDeath : undefined; // the deceased's too: only when entered
    const dateTxt = showDates && dod && /^\d{4}-\d{2}-\d{2}$/.test(dod) ? dod.split('-').reverse().join('-') : '';
    const extra = (dateTxt ? 1 : 0) + (mahroom || divorced ? 1 : 0) + (!isD && !mahroom && shareTxt ? 1 : 0);
    // Just under the last line of text: the line down to the children starts here.
    const textBottom = below + extra * 15 + 12;
    return { predeceased, zero, mahroom, divorced, shareTxt, below, textBottom, dateTxt };
  };

  const sel = selected ? nodes.get(selected) : null;
  // On a computer the quick bar (540px) opens under the person: a small tree's area widens while it
  // is open so the bar is never cut off (phones show it as a panel at the bottom instead).
  const svgW = width + P * 2;
  const wideScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
  const outerW = Math.max(svgW, sel && menu && wideScreen ? 560 : 0);
  const offX = (outerW - svgW) / 2;
  // Phones: the quick bar is a panel over the bottom of the screen; keep the tapped person in view above it.
  const showMenu = !!(sel && menu);
  useEffect(() => {
    if (!showMenu || printMode || typeof window === 'undefined' || window.innerWidth >= 768) return;
    const el = document.querySelector(`svg.shajra-tree [data-pid="${CSS.escape(selected!)}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [selected, showMenu, printMode]);
  return (
    <div className={printMode ? 'relative' : 'relative mx-auto'} style={printMode ? { width: printSize ? `${printSize.w}mm` : '100%', margin: '0 auto' } : { width: outerW, minHeight: height + P * 2 + STEM + (sel && menu ? 440 : 90) /* room for the quick bar (with More / Add relative) under the lowest row */ }}>
      <svg width={printMode ? (printSize ? `${printSize.w}mm` : '100%') : svgW} height={printMode ? (printSize ? `${printSize.h}mm` : undefined) : height + P * 2 + STEM + 70} viewBox={`0 0 ${width + P * 2} ${height + STEM + (printMode ? P + 6 : P * 2 + 70)}`} role="group" aria-label="Family tree (shajra nasab)" className={printMode ? 'shajra-tree-print block' : 'shajra-tree mx-auto block'} style={{ background: '#fffdf6' }}>
        {/* Lines of descent: parent stroke -> bar over the children -> each child */}
        <g stroke={INK} strokeWidth="1.3" fill="none">
          {famList.map(({ father, mother, kids }, fi) => {
            const ky = Math.min(...kids.map((k) => top(k)));
            // Bar clear of the row below (names and marriage lines).
            const bar = ky - 26 - (barLevel.get(fi) ?? 0) * 14;
            const xs = kids.map(childAnchorX);
            const drops = dropsOf({ father, mother });
            // The line starts just below the parent's last line of text (the same gap for everyone,
            // so a late son / daughter with no share line has no extra gap).
            const parentBottom = (id: string) => labelInfo(id).textBottom;
            // A wife's line: straight down from under her name when her children are right below her;
            // otherwise from the outer side of her heart, so it never runs into a child's line.
            const midKids = (Math.min(...xs) + Math.max(...xs)) / 2;
            const straight = (id: string) => Math.abs(midKids - cx(id)) < 30;
            const dropX = (id: string) => (kindOf(id) === 'wife' && !straight(id) ? cx(id) + tipDir(id) * 18 : cx(id));
            const dropY = (id: string) => (kindOf(id) === 'wife' && !straight(id) ? top(id) + sym + 22 : parentBottom(id));
            const all = [...xs, ...drops.map(dropX)];
            return (
              <g key={`f-${fi}`}>{/* one solid line of descent for every family, father's or mother's */}
                {drops.map((d) => <line key={d} x1={dropX(d)} y1={dropY(d)} x2={dropX(d)} y2={bar} />)}
                <line x1={Math.min(...all)} y1={bar} x2={Math.max(...all)} y2={bar} />
                {kids.map((k) => <line key={k} x1={childAnchorX(k)} y1={bar} x2={childAnchorX(k)} y2={childAnchorY(k)} />)}
              </g>
            );
          })}
          {/* Marriage: wife attached beside the husband (a divorced spouse is marked (مطلقہ) under the name) */}
          {c.unions.map((u) => {
            const [a, b] = u.partners;
            const na = nodes.get(a), nb = nodes.get(b);
            if (!na || !nb || na.gen !== nb.gen) return null;
            const leftId = cx(a) <= cx(b) ? a : b;
            const rightId = leftId === a ? b : a;
            const x1 = cx(leftId), x2 = cx(rightId);
            // Leave room for the symbol: heart edge, Λ edge, deceased box or stroke.
            const off = (id: string) =>
              kindOf(id) === 'wife' ? 38 : kindOf(id) === 'both' ? 36 : isInLaw(id) ? 44 : 6;
            const hasBoth = kindOf(a) === 'both' || kindOf(b) === 'both';
            const y = top(a) + (hasBoth ? 25 : sym / 2);
            return (
              <g key={u.id}>
                <line x1={x1 + off(leftId)} y1={y} x2={x2 - off(rightId)} y2={y} />
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
          const k = kindOf(p.id);
          const [en, ur] = relLabel(r?.relationKey ?? (isD ? 'deceased' : ''));
          const nm = (p.name || (printMode ? '__________' : 'Tap to add name')).slice(0, 22);
          // Not inheriting: written (محروم) in red, like (ز). Someone who died before the deceased
          // already reads پہلے فوت شدہ, so nothing more is written under them.
          const { mahroom, divorced, shareTxt, dateTxt } = labelInfo(p.id);
          const dl = dateTxt ? 15 : 0; // the lines under the date move down when it is shown
          return (
            <g key={p.id} data-pid={p.id} className={printMode ? undefined : 'cursor-pointer'} onClick={printMode ? undefined : () => onSelect(p.id)} tabIndex={printMode ? undefined : 0} role={printMode ? undefined : 'button'} aria-haspopup={printMode ? undefined : 'menu'}
              aria-label={`${nm}, ${en}${r && !isD && shareTxt ? `, share ${shareTxt}` : ''}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}>
              <title>{`${nm} · ${en}${ur ? ` · ${ur}` : ''}`}</title>
              <rect x={n.x + P + 2} y={n.y + P + STEM - 20} width={NODE_W - 4} height={sym + (k === 'both' ? 96 : 72)} rx="8" fill={selected === p.id ? 'rgba(14,165,233,0.10)' : 'transparent'} stroke={selected === p.id ? '#7dd3fc' : 'none'} />
              {(() => {
                const inLaw = isInLaw(p.id);
                const dir = tipDir(p.id);
                const spouseOfBoth = inLaw && c.unions.some((u) => u.partners.includes(p.id) && u.partners.some((o) => o !== p.id && kindOf(o) === 'both'));
                // Wife: name inside the heart. Daughter who is also a wife ('both'): smaller Λ slightly above, heart tucked beneath it.
                const heartCy = k === 'wife' ? y + sym / 2 : y + 25;
                const inHeart = k === 'wife' || k === 'both';
                const nameX = inHeart ? x - dir * 6 : x; // centre of the heart's round body
                const inLawY = spouseOfBoth ? y + 29 : y + sym / 2 + 4;
                const nameY = inHeart ? heartCy + 5 : inLaw ? inLawY : y + sym + (hasUrdu(nm) ? 20 : 15);
                const below = k === 'wife' ? y + sym + 34 : k === 'both' ? heartCy + 40 : inLaw ? inLawY + 18 : y + sym + (hasUrdu(nm) ? 40 : 29);
                // Narrower heart: a long name goes on two lines inside it.
                const heartLines = inHeart ? splitName(nm, 11) : [nm];
                const vx = childAnchorX(p.id);
                return (
                  <>
                    {k === 'wife' && (
                      <path d={leaf(38, 34, dir)} transform={`translate(${x},${heartCy})`} fill="#fffdf6" stroke={INK} strokeWidth="1.4" />
                    )}
                    {k === 'both' && (
                      <>
                        {/* Inverted V (a quarter smaller than a daughter's) above the heart */}
                        <path d={`M${vx - 10.5},${y - 1} L${vx},${y - 10.75} L${vx + 10.5},${y - 1}`} fill="none" stroke={INK} strokeWidth="1.55" strokeLinejoin="round" strokeLinecap="round" />
                        {/* Wife heart accommodated neatly below the smaller inverted V */}
                        <path d={leaf(36, 28, dir)} transform={`translate(${x},${heartCy})`} fill="#fffdf6" stroke={INK} strokeWidth="1.4" />
                      </>
                    )}
                    {k === 'daughter' && (
                      <path d={`M${x - 22},${y + sym} L${x},${y - 2} L${x + 22},${y + sym}`} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                    )}
                    {/* A son of the family is a short stroke; a husband who married into the family is just his name. */}
                    {k === 'male' && !inLaw && <line x1={x} y1={y} x2={x} y2={y + sym} stroke={INK} strokeWidth="1.6" />}
                    {/* Where a family line starts (no parents drawn above): a longer stem, like the trunk of the tree. */}
                    {!inLaw && (k === 'male' || k === 'daughter') && !(fatherOf(c, p.id) && nodes.get(fatherOf(c, p.id)!)) && !(motherOf(c, p.id) && nodes.get(motherOf(c, p.id)!)) && (
                      <line x1={x} y1={y - STEM + 2} x2={x} y2={k === 'male' ? y : y - 2} stroke={INK} strokeWidth="1.6" />
                    )}
                    {p.flags.pregnant && <path d={`M${x + 30},${y + sym} l6,-10 l6,10 z`} fill="none" stroke="#b45309" strokeDasharray="2 2" />}
                    <text x={nameX} y={nameY - (heartLines.length - 1) * 6} textAnchor="middle" fontSize={hasUrdu(nm) ? (inHeart ? 12 : 13) : inHeart ? 10.5 : 11.5} fontWeight={isD ? 800 : 600} fill={INK}
                      fontFamily={hasUrdu(nm) ? URDU_FONT : undefined}>
                      {heartLines.map((t, li) => <tspan key={li} x={nameX} dy={li ? 12 : 0}>{t}</tspan>)}
                    </text>
                    {/* Status in red, as the patwari writes it */}
                    {/* Status in red under the name (for the deceased: حال متوفی, centred under the name) */}
                    <text x={x} y={below} textAnchor="middle" fontSize="10" fill="#dc2626" fontFamily={URDU_FONT} className="urdu">{statusOf(p.id)}</text>
                    {dateTxt && <text x={x} y={below + 14} textAnchor="middle" fontSize="9" fill="#b91c1c" fontFamily="Arial, sans-serif">{dateTxt}</text>}
                    {/* Divorced: (مطلقہ / محروم) in red instead of slashes on the marriage line */}
                    {(mahroom || divorced) && <text x={x} y={below + 15 + dl} textAnchor="middle" fontSize="10" fill="#dc2626" fontFamily={URDU_FONT} className="urdu">({divorced ? (mahroom || !shareTxt ? 'مطلقہ / محروم' : 'مطلقہ') : 'محروم'})</text>}
                    {!isD && !mahroom && shareTxt && (
                      <text x={x} y={below + (divorced ? 30 : 15) + dl} textAnchor="middle" fontSize="11" fontWeight="700" fill={SHARE_COLOR[r?.status ?? 'excluded']}>({shareTxt})</text>
                    )}
                  </>
                );
              })()}
            </g>
          );
        })}
      </svg>
      {sel && menu && (wideScreen ? (
        <div className="absolute z-20" style={{ left: Math.min(Math.max(4, offX + sel.x + P + NODE_W / 2 - 150), Math.max(4, outerW - 548)), top: sel.y + P + STEM + sym + (kindOf(sel.id) === 'both' ? 90 : 62) }}>
          {menu}
        </div>
      ) : createPortal(menu, document.body) /* phones: a panel fixed to the bottom of the screen, outside the drawing */)}
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
      <span><b className="text-green-700">(1/4)</b> heir · <b className="urdu font-normal text-red-600" lang="ur">(محروم)</b> not inheriting · <b className="text-amber-700">amber</b> reserved · <b className="text-blue-700">blue</b> MFLO s.4</span>
      <span>── line of descent · ─ marriage · <span className="urdu text-red-600" lang="ur">(مطلقہ)</span> divorced</span>
    </div>
  );
}
