// Port of utils/statsUtils.js (+ small shared chart helpers used by the stats / sub-admin screens).
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/shared/api/client';
import { fmtDate, fmtDateTime, ymdToDmy } from '@/shared/lib/format';
import './stats.css';

export const formatNumber = (num: any) => {
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString();
};
/** D6: dd-mm-yyyy HH:MM */
export const formatDateTime = (value: any) => fmtDateTime(value, '--');
/** D6: dd-mm-yyyy */
export const formatDateOnly = (value: any) => fmtDate(value, '--');
export const formatDateToDMY = (dateStr: any) => {
  if (!dateStr) return '';
  return ymdToDmy(dateStr) || String(dateStr);
};

export const getIPGeolocation = async (ip: string) => {
  try {
    const { data } = await api.get('/api/geo/ip-lookup', { params: { ip } });
    return data;
  } catch {
    return { city: 'Unknown', region: 'Unknown', country: 'Pakistan', lat: 0, lon: 0 };
  }
};

export type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'halfyearly';
export interface RenewalViewOption { key: string; label: string; short: string; rangeDays: number; granularity: Granularity }
export const RENEWAL_VIEW_OPTIONS: RenewalViewOption[] = [
  { key: '7d', label: '7 Days', short: '7D', rangeDays: 7, granularity: 'daily' },
  { key: '30d', label: '30 Days', short: '30D', rangeDays: 30, granularity: 'daily' },
  { key: '90d', label: 'Quarterly (90D)', short: '90D', rangeDays: 90, granularity: 'weekly' },
  { key: '180d', label: 'Half-Yearly (180D)', short: '180D', rangeDays: 180, granularity: 'monthly' },
];
export const getRenewalViewConfig = (key: string) => RENEWAL_VIEW_OPTIONS.find((o) => o.key === key) || RENEWAL_VIEW_OPTIONS[1];

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((+d - +firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Groups {date, fee, subAdminPayment?} records into count/revenue buckets (legacy keys: daily = UTC ISO day). */
export const bucketRenewalsByGranularity = (renewals: any[], granularity: Granularity) => {
  const buckets = new Map<string, { date: string; label: string; count: number; revenue: number }>();
  const keyAndLabelFor = (rawDate: any) => {
    const d = new Date(rawDate);
    switch (granularity) {
      case 'weekly': {
        const { year, week } = getISOWeek(d);
        return { key: `${year}-W${String(week).padStart(2, '0')}`, label: `W${week} '${String(year).slice(2)}` };
      }
      case 'monthly':
        return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('default', { month: 'short', year: '2-digit' }) };
      case 'quarterly': {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return { key: `${d.getFullYear()}-Q${q}`, label: `Q${q} '${String(d.getFullYear()).slice(2)}` };
      }
      case 'halfyearly': {
        const h = d.getMonth() < 6 ? 1 : 2;
        return { key: `${d.getFullYear()}-H${h}`, label: `H${h} '${String(d.getFullYear()).slice(2)}` };
      }
      default: {
        const key = d.toISOString().split('T')[0];
        return { key, label: key };
      }
    }
  };
  (renewals || []).forEach((r) => {
    const { key, label } = keyAndLabelFor(r.date);
    if (!buckets.has(key)) buckets.set(key, { date: key, label, count: 0, revenue: 0 });
    const b = buckets.get(key)!;
    if (!r.subAdminPayment) b.count += 1; // a sub-admin lump-sum payment is revenue, not a renewal
    b.revenue += r.fee || 0;
  });
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
};

export const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export const legendFormatter = (value: ReactNode) => <span style={{ color: '#1a1a1a', fontWeight: 700 }}>{value}</span>;

/** < 768 px: smaller / slanted chart ticks. */
export const SMALL_SCREEN_PX = 768;
export function useIsSmallScreen() {
  const get = () => typeof window !== 'undefined' && window.innerWidth < SMALL_SCREEN_PX;
  const [small, setSmall] = useState(get);
  useEffect(() => {
    const onResize = () => setSmall(get());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return small;
}

/** Legacy custom checkbox legend (row of labelled checkboxes, accent = series colour). */
export function CheckLegend({
  items, visible, onToggle, className = 'flex justify-center flex-wrap gap-3 mt-2 mb-2', fontSize = '0.85rem', scale = 1.2, dimHidden,
}: {
  items: { key: string; label: ReactNode; color: string }[];
  visible: Record<string, boolean>;
  onToggle: (key: string) => void;
  className?: string;
  fontSize?: string;
  scale?: number;
  dimHidden?: boolean;
}) {
  return (
    <div className={className}>
      {items.map((it) => (
        <label
          key={it.key}
          className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
          style={{ color: '#1a1a1a', fontWeight: 700, fontSize, userSelect: 'none', opacity: dimHidden && !visible[it.key] ? 0.55 : 1 }}
        >
          <input type="checkbox" checked={!!visible[it.key]} onChange={() => onToggle(it.key)} style={{ accentColor: it.color, transform: `scale(${scale})` }} />
          {it.label}
        </label>
      ))}
    </div>
  );
}

/** Dark gradient header used on the Online / Today cards. */
export const DARK_HEADER_BG = 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)';
export function DarkHeader({ title, badge, className = '' }: { title: ReactNode; badge?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 py-3 ${className}`} style={{ background: DARK_HEADER_BG, borderBottom: '2px solid rgba(0,255,255,0.3)' }}>
      <h6 className="m-0 text-[0.85rem] font-bold uppercase text-white" style={{ letterSpacing: 1 }}>{title}</h6>
      {badge !== undefined && badge !== null && <span className="badge badge-info px-3 font-normal">{badge}</span>}
    </div>
  );
}

/** Legacy client-side page bar rendering every page number (no windowing). */
export function NumberPager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  const b = 'btn btn-sm btn-outline-primary min-w-[2rem]';
  return (
    <div className="flex flex-wrap justify-center gap-1 border-t border-[#dee2e6] bg-white py-2">
      <button className={b} disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <button key={p} className={p === page ? 'btn btn-sm btn-primary min-w-[2rem]' : b} onClick={() => onChange(p)}>{p}</button>
      ))}
      <button className={b} disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

/** Card panel with centred title (legacy `Panel` / Card + Card.Title). */
export function Panel({ title, children, className = '', bodyClassName = '' }: { title?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <div className={`card-plain h-full ${className}`}>
      <div className={`p-3 max-sm:p-2 ${bodyClassName}`}>
        {title && <div className="mb-3 text-center text-base font-semibold text-[#033748]">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Dark sticky-header tables in a scroll box (legacy .user-list-table-wrapper / .sticky-scroll). */
export const TABLE_WRAP = 'table-wrap';
