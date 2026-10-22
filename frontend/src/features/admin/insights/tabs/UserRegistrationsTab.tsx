// Port of StatsTabs/UserRegistrationsTab.js
import { memo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line } from 'recharts';
import { cn } from '@/shared/ui';
import { formatNumber, CheckLegend, useIsSmallScreen } from '../statsUtils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDateLabel = (label: any) => {
  const s = String(label ?? '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${Number(m[3])}/${Number(m[2])}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}$/);
  if (m) return `${Number(m[1])}/${Number(m[2])}`;
  m = s.match(/^\d{4}-W(\d{1,2})$/);
  if (m) return `W${Number(m[1])}`;
  m = s.match(/^(\d{2})(\d{2})-(\d{1,2})$/);
  if (m) return `${MONTHS[Number(m[3]) - 1] || m[3]} ${m[2]}`;
  return s;
};

const PERIODS = [
  { key: 'daily', label: 'Daily (30 Days)' },
  { key: 'weekly', label: 'Weekly (12 Weeks)' },
  { key: 'monthly', label: 'Monthly (12 Months)' },
];

function UserRegistrationsTab({ processedStats, regPeriod, setRegPeriod }: any) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>({ count: true, publicCount: true, trend: true });
  const small = useIsSmallScreen();
  if (!processedStats) return null;
  const chartData = regPeriod === 'daily' ? processedStats.registrationsDaily : regPeriod === 'weekly' ? processedStats.registrationsWeekly : processedStats.registrationsMonthly;
  const barSize = regPeriod === 'daily' ? 12 : regPeriod === 'weekly' ? 25 : 45;

  return (
    <div className="card-plain mt-4 p-4 max-md:p-2">
      <div className="mb-3 text-center text-[1.05rem] font-semibold text-[#033748]">User Growth Insights</div>
      <div className="mb-6 flex flex-wrap justify-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.key} className={cn('btn btn-sm', regPeriod === p.key ? 'btn-primary' : 'btn-outline-primary')} onClick={() => setRegPeriod(p.key)}>{p.label}</button>
        ))}
      </div>
      <div style={{ width: '100%', height: 350 }}>
        {!chartData || chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center italic text-ink-2">No registration data available for this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 15, right: small ? 5 : 15, left: small ? -10 : 15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
              <XAxis
                dataKey="label"
                tickFormatter={shortDateLabel}
                tick={{ fontSize: small ? 9 : 10, fill: '#000000', fontWeight: 700, angle: -45, textAnchor: 'end' }}
                height={45}
                interval={chartData.length > 12 ? Math.ceil(chartData.length / 12) - 1 : 0}
              />
              <YAxis tick={{ fontSize: small ? 9 : 10, fill: '#000000', fontWeight: 700 }} width={45} />
              <Tooltip formatter={(value: any, name: any) => [formatNumber(value), name]} />
              {visibility.count && <Bar name="Total Registrations" dataKey="count" fill="#8884d8" barSize={barSize} radius={[4, 4, 0, 0]} />}
              {visibility.publicCount && <Bar name="Public Registrations" dataKey="publicCount" fill="#ffc658" barSize={barSize} radius={[4, 4, 0, 0]} />}
              {visibility.trend && <Line name="Trend" type="monotone" dataKey="count" stroke="#00C49F" strokeWidth={2} dot={{ r: 3 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {chartData && chartData.length > 0 && (
        <CheckLegend
          items={[
            { key: 'count', label: 'Total Registrations', color: '#8884d8' },
            { key: 'publicCount', label: 'Public Registrations', color: '#ffc658' },
            { key: 'trend', label: 'Trend', color: '#00C49F' },
          ]}
          visible={visibility}
          onToggle={(k) => setVisibility((p) => ({ ...p, [k]: !p[k] }))}
        />
      )}
    </div>
  );
}

export default memo(UserRegistrationsTab);
