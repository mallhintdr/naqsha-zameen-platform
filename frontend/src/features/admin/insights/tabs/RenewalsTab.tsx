// Port of StatsTabs/RenewalsTab.js — also reused by the sub-admin dashboards (SubAdminRenewalsPanel).
import { memo } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, Bar, Line } from 'recharts';
import { cn } from '@/shared/ui';
import {
  formatNumber, formatDateToDMY, formatDateOnly, RENEWAL_VIEW_OPTIONS, getRenewalViewConfig, useIsSmallScreen, CheckLegend,
} from '../statsUtils';

// Reference line = average revenue per bucket over the range (empty buckets count as zero).
const GRANULARITY_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };
const BUCKET_WORD: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const AVG_COLOR = '#ea580c';
const AVG_TEXT = '#9a3412';

function RenewalsTab({
  processedStats, renewalAnalysis, renewalsVisibility, setRenewalsVisibility, renewalView, setRenewalView,
}: {
  processedStats: any;
  renewalAnalysis: any;
  renewalsVisibility: Record<string, boolean>;
  setRenewalsVisibility: (fn: any) => void;
  renewalView: string;
  setRenewalView: (k: string) => void;
}) {
  const isSmall = useIsSmallScreen();
  if (!renewalAnalysis) return null;

  const opt = getRenewalViewConfig(renewalView);
  const isDaily = opt.granularity === 'daily';
  const dailyRangeDays = isDaily ? opt.rangeDays : null;
  const buckets = Math.max(1, opt.rangeDays / (GRANULARITY_DAYS[opt.granularity] || 1));
  const data = renewalAnalysis.dailyRenewals || [];
  const totalRevenue = data.reduce((s: number, b: any) => s + (b.revenue || 0), 0);
  const average = Math.round(totalRevenue / buckets);
  const points = data.length;
  const interval = isSmall ? (points > 8 ? Math.ceil(points / 8) - 1 : 0) : isDaily && dailyRangeDays > 30 ? Math.ceil(dailyRangeDays / 15) : 0;
  const health = processedStats?.subscriptionHealth || {};
  const active = health.active || 0;
  const expired = health.expired || 0;

  const periods = [
    { label: 'Last 7 Days', count: renewalAnalysis.last7Days.length, revenue: renewalAnalysis.revenue7d, growth: renewalAnalysis.growthPct7d },
    { label: 'Last 30 Days', count: renewalAnalysis.last30Days.length, revenue: renewalAnalysis.revenue30d, growth: renewalAnalysis.growthPct30d },
    { label: 'Last 90 Days', count: renewalAnalysis.last90Days.length, revenue: renewalAnalysis.revenue90d, growth: renewalAnalysis.growthPct90d },
    { label: 'Last 180 Days', count: renewalAnalysis.last180Days.length, revenue: renewalAnalysis.revenue180d, growth: renewalAnalysis.growthPct180d },
  ];

  return (
    <div className="card-plain p-4 max-md:p-2">
      <div className="mb-3 text-center text-[1.05rem] font-semibold text-[#033748]">Renewal Activity &amp; Revenue — {opt.label}</div>

      <div className="mb-3 flex flex-wrap justify-center gap-2">
        <div className="btn-group renewal-view-buttons">
          {RENEWAL_VIEW_OPTIONS.map((o) => (
            <button key={o.key} className={cn('btn btn-sm', renewalView === o.key ? 'btn-primary' : 'btn-outline-primary')} onClick={() => setRenewalView(o.key)}>
              <span className="max-sm:hidden">{o.label}</span>
              <span className="sm:hidden">{o.short || o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 28, right: 5, left: -25, bottom: isSmall ? 12 : 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={isDaily ? 'date' : 'label'}
            tickFormatter={isDaily ? (d: string) => String(d).split('-').slice(1).join('/') : undefined}
            tick={isSmall ? { fontSize: 10, angle: -45, textAnchor: 'end' } : { fontSize: 11 }}
            height={isSmall ? 48 : 30}
            interval={interval}
          />
          <YAxis yAxisId="left" orientation="left" stroke="#8884d8" name="Users" allowDecimals={false} tick={{ fontSize: isSmall ? 10 : 12 }} />
          <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" name="Revenue" tick={{ fontSize: isSmall ? 10 : 12 }} />
          <Tooltip
            labelFormatter={isDaily ? (l: any) => formatDateToDMY(l) : undefined}
            formatter={(value: any, name: any) => [String(name).includes('Revenue') ? `Rs. ${formatNumber(value)}` : value, name]}
          />
          <Bar yAxisId="left" dataKey="count" name="Users" fill="#8884d8" barSize={isDaily && dailyRangeDays > 30 ? 14 : 30} radius={[4, 4, 0, 0]} hide={!renewalsVisibility.count} />
          <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#82ca9d" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} hide={!renewalsVisibility.revenue} />
          {average > 0 && renewalsVisibility.revenue && (
            <ReferenceLine
              y={average}
              yAxisId="right"
              stroke={AVG_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
              label={(p: any) => {
                const viewBox = p?.viewBox;
                if (!viewBox) return null;
                const text = `${BUCKET_WORD[opt.granularity] || ''} Avg: Rs. ${formatNumber(average)}`;
                const w = text.length * 6 + 12;
                const x = viewBox.x + (viewBox.width - w) / 2;
                const y = 2; // centre top of the chart (above the plot area), not on the line
                return (
                  <g>
                    <rect x={x} y={y} width={w} height={17} rx={8} fill="#ffffff" fillOpacity={0.92} stroke={AVG_COLOR} strokeWidth={1} />
                    <text x={x + w / 2} y={y + 12} textAnchor="middle" fill={AVG_TEXT} fontSize={10.5} fontWeight={700}>{text}</text>
                  </g>
                );
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <CheckLegend
        items={[{ key: 'count', label: 'Users', color: '#8884d8' }, { key: 'revenue', label: 'Revenue', color: '#82ca9d' }]}
        visible={renewalsVisibility}
        onToggle={(k) => setRenewalsVisibility((prev: any) => ({ ...prev, [k]: !prev[k] }))}
      />

      <hr className="my-6 border-[#dee2e6]" />

      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h6 className="mb-3 text-center font-semibold text-teal-ink">Renewals &amp; Subscription Health</h6>
          <div className="table-wrap">
            <table className="table table-striped table-hover">
              <thead><tr><th>Period</th><th>Renewals</th><th>Revenue</th><th>Growth</th></tr></thead>
              <tbody>
                {periods.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="text-center">{r.count}</td>
                    <td>Rs. {formatNumber(r.revenue)}</td>
                    <td className={cn('font-bold', r.growth >= 0 ? 'text-[#198754]' : 'text-[#dc3545]')}>
                      {r.growth >= 0 ? '▲' : '▼'} {Math.abs(r.growth)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <hr className="my-2 border-[#dee2e6]" />
          <div className="flex flex-col gap-2 text-[0.88rem] text-teal-ink">
            <div className="flex justify-between"><span>Active Subscriptions:</span><span className="font-bold text-[#198754]">{active}</span></div>
            <div className="flex justify-between"><span>Expired / Churned:</span><span className="font-bold text-[#dc3545]">{expired}</span></div>
            <div className="flex justify-between">
              <span>Churn Rate:</span>
              <span className="font-bold text-[#212529]">{active + expired > 0 ? `${((expired / (active + expired)) * 100).toFixed(1)}%` : '0%'}</span>
            </div>
            <hr className="my-1 border-[#dee2e6]" />
            <div className="flex justify-between font-bold text-[#b45309]"><span>Expiring in 7 Days:</span><span>{health.expiringSoon || 0} users</span></div>
            {/* D7: business assumption preserved and flagged — Rs 1000 per expiring user */}
            <div className="flex justify-between font-bold text-[#dc3545]" title="Assumes Rs 1,000 per expiring user">
              <span>Revenue at Risk (7d):</span>
              <span>Rs. {formatNumber((health.expiringSoon || 0) * 1000)}</span>
            </div>
            <div className="text-right text-[0.7rem] text-ink-2">Estimate: Rs 1,000 per user; direct renewals without a recorded fee count as Rs 1,000.</div>
          </div>
        </div>

        <div className="min-w-0">
          <h6 className="mb-3 text-center font-semibold text-teal-ink">Recent Renewals (7 Days)</h6>
          <div className="table-wrap max-h-[340px]">
            <table className="table no-hover-table">
              <thead><tr><th className="freeze">Name</th><th>ID</th><th>Subscription</th><th>Date</th><th>Amount</th></tr></thead>
              <tbody className="text-[0.8rem]">
                {renewalAnalysis.last7Days.length > 0 ? (
                  renewalAnalysis.last7Days.map((r: any, i: number) => (
                    <tr key={`${r.userId}-${i}`}>
                      <td className="freeze !px-2 !py-[0.3rem]">
                        <strong>{r.userName || r.userId}</strong>
                        {r.bySubAdmin && <div className="text-[0.68rem] font-normal text-ink-2">via {r.bySubAdmin}</div>}
                      </td>
                      <td className="!px-2">{r.userId || '—'}</td>
                      <td className="!px-2">{r.subscriptionType}</td>
                      <td className="whitespace-nowrap !px-2">{formatDateOnly(r.date)}</td>
                      <td className="whitespace-nowrap !px-2 text-right font-bold text-[#198754]">Rs. {formatNumber(r.bySubAdmin ? r.amount || 0 : r.fee || 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="py-3 text-center text-ink-2">No renewals in the last 7 days</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(RenewalsTab);
