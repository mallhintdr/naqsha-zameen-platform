// Compact share table shown beside the shajra: name, share and land in Kanal-Marla-Feet.
import { toString, type Case, type ComputeResult } from 'inheritance-engine';
import { relLabel } from './labels.ts';
import { heirLandText, kmfText, areaText, LandQuick } from './Estate.tsx';

export default function SideShares({ c, setC, result, name, onward, onOnward }: {
  c: Case; setC: (c: Case) => void; result: ComputeResult | null; name: (id: string) => string;
  /** An heir who died after the deceased: their share can be distributed onward (munasakha). */
  onward?: (id: string) => boolean; onOnward?: (id: string) => void;
}) {
  const props = c.estate.immovable;
  const rows = (result?.shares ?? []).filter((s) => s.fraction.n > 0n || s.status === 'reserved');
  const totalText = (k: number) => {
    const p = props[k];
    const t = p.area.value.n * 5440n;
    return p.area.unit === 'gkanal' && t % p.area.value.d === 0n ? kmfText(t / p.area.value.d) : areaText(p.area.value, p.area.unit);
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2" id="shajra-side-shares">
      <h3 className="text-sm font-bold">Shares <span className="urdu font-normal" lang="ur">حصص</span></h3>
      <div className="mt-1.5"><LandQuick c={c} setC={setC} /></div>
      {!result ? <p className="mt-2 text-xs text-slate-500">Add the family to see the shares.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[11px] leading-tight">
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                <th className="px-1 py-1">#</th><th className="px-1 py-1">Heir</th><th className="px-1 py-1 text-right">Share</th>
                {props.map((p, k) => <th key={k} className="px-1 py-1 text-right" title={p.title}>{props.length > 1 ? `${p.title} ` : ''}{p.area.unit === 'gkanal' ? 'K-M-F' : 'Land'}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.personId} className="border-b border-slate-100 align-top">
                  <td className="px-1 py-1 text-slate-500">{i + 1}</td>
                  <td className="px-1 py-1">
                    <span className="font-semibold">{name(s.personId)}</span>
                    <span className="block text-[10px] text-slate-500">{relLabel(s.relationKey)[0]}{s.status === 'substituted-s4' ? ' · s.4' : ''}{s.status === 'reserved' ? ' · reserved' : ''}</span>
                    {onward?.(s.personId) && s.fraction.n > 0n && onOnward && (
                      <button className="mt-0.5 rounded border border-sky-300 px-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-50" onClick={() => onOnward(s.personId)}
                        title="This heir died after the deceased: distribute their share to their own heirs">Distribute onward →</button>
                    )}
                  </td>
                  <td className="px-1 py-1 text-right font-mono" title={`${s.percent}% · ${String(s.sihaam)} of ${String(s.base)} sihaam`}>{toString(s.fraction)}<span className="block text-[10px] font-normal text-slate-500">{Number(s.percent).toFixed(2)}%</span></td>
                  {props.map((p, k) => <td key={k} className="whitespace-nowrap px-1 py-1 text-right font-mono">{heirLandText(s, p.area.unit, k)}</td>)}
                </tr>
              ))}
              {result.escheat.n > 0n && <tr className="border-b border-slate-100"><td /><td className="px-1 py-1">Government (no heir)</td><td className="px-1 py-1 text-right font-mono">{toString(result.escheat)}</td>{props.map((_, k) => <td key={k} />)}</tr>}
              <tr className="bg-slate-100 font-bold">
                <td /><td className="px-1 py-1">Total</td><td className="px-1 py-1 text-right font-mono">1</td>
                {props.map((_, k) => <td key={k} className="whitespace-nowrap px-1 py-1 text-right font-mono">{totalText(k)}</td>)}
              </tr>
            </tbody>
          </table>
          {props.some((p) => p.area.unit === 'gkanal') && <p className="mt-1 text-[10px] text-slate-500">K-M-F = Kanal-Marla-Feet (1 marla = 272 sq ft); feet are rounded so the heirs add up to the total.</p>}
        </div>
      )}
    </div>
  );
}
