// Port of StatsTabs/OverviewTab.js
import { memo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line, LabelList } from 'recharts';
import { Badge, StatTile } from '@/shared/ui';
import { formatNumber, formatDateToDMY, CheckLegend, useIsSmallScreen } from '../statsUtils';

const HOTSPOT_ACTIVE = '#22a35a';
const HOTSPOT_INACTIVE = '#e05252';
const HOTSPOT_ROW_PX = 36;

function OverviewTab({
  processedStats, multiIPAnalysis, overviewVisibility, setOverviewVisibility, hourlyActivity, onlineVisibility, setOnlineVisibility,
}: any) {
  const [hot, setHot] = useState({ active: true, inactive: true });
  const small = useIsSmallScreen();
  if (!processedStats) return null;
  const tick = small ? 10 : 12;

  const rows = processedStats.tehsilStats
    .map((s: any) => {
      const total = s.userCount || 0;
      const active = s.activeCount ?? 0;
      const inactive = s.inactiveCount ?? Math.max(0, total - active);
      return { ...s, _id: s._id || 'Unknown', userCount: total, activeCount: active, inactiveCount: inactive, shown: (hot.active ? active : 0) + (hot.inactive ? inactive : 0) };
    })
    .sort((a: any, b: any) => b.shown - a.shown || String(a._id).localeCompare(String(b._id)));
  const label = (
    <LabelList
      dataKey="shown"
      content={(p: any) => {
        const r = rows[p.index];
        if (!r) return null;
        return <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 4} textAnchor="middle" style={{ fill: '#374151', fontWeight: 700, fontSize: 10 }}>{r.shown}</text>;
      }}
    />
  );
  const chartWidth = Math.max(640, rows.length * HOTSPOT_ROW_PX + 60);
  const s = multiIPAnalysis.summary;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI tiles: 3 per row on phones */}
      <div className="fill-row">
        <StatTile tone="primary" value={formatNumber(processedStats.totalUsers)} label="Total Users" />
        <StatTile tone="success" value={formatNumber(processedStats.subscriptionHealth?.active || 0)} label="Active Users" />
        <StatTile tone="warning" value={formatNumber(processedStats.subscriptionHealth?.expiringSoon || 0)} label="Expiring Soon" />
        <StatTile tone="danger" value={formatNumber(processedStats.subscriptionHealth?.expired || 0)} label="Expired Users" />
      </div>
      <div className="fill-row">
        <StatTile tone="info" value={formatNumber(processedStats.totalOnline)} label="Online Now" />
        <div className="col-span-2">
          <StatTile tone="warning" title="Accounts used on more than one device" value={formatNumber(s.totalUsers)} label="Multi-Device users" />
        </div>
      </div>

      {/* Chart A */}
      <div className="card-plain p-4 max-md:p-2">
        <div className="mb-3 text-center text-[1.05rem] font-semibold text-[#033748]">Daily Active Users (Last 30 Days)</div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={processedStats.dailyActivity} margin={{ top: 15, right: 5, left: -25, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={(d: string) => String(d).slice(5)} tick={{ fontSize: tick }} />
            <YAxis tick={{ fontSize: tick }} />
            <Tooltip labelFormatter={(l: any) => formatDateToDMY(l)} />
            <Bar dataKey="activeUsers" name="Active Users" fill="#8884d8" barSize={20} hide={!overviewVisibility.activeUsers} />
            <Line type="monotone" dataKey="rollingAvg" name="7-Day Avg" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} hide={!overviewVisibility.rollingAvg} />
            <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#ff7300" hide={!overviewVisibility.sessions} />
          </ComposedChart>
        </ResponsiveContainer>
        <CheckLegend
          items={[
            { key: 'activeUsers', label: 'Active Users', color: '#8884d8' },
            { key: 'rollingAvg', label: '7-Day Avg', color: '#10b981' },
            { key: 'sessions', label: 'Sessions', color: '#ff7300' },
          ]}
          visible={overviewVisibility}
          onToggle={(k) => setOverviewVisibility((p: any) => ({ ...p, [k]: !p[k] }))}
        />
      </div>

      {/* Chart B */}
      {hourlyActivity && onlineVisibility && (
        <div className="card-plain p-4 max-md:p-2">
          <div className="mb-3 text-center text-base font-semibold text-[#033748]">User Activity (24h)</div>
          <div style={{ width: '100%', height: 220 }}>
            {hourlyActivity.every((x: any) => x.users === 0 && x.sessions === 0) ? (
              <div className="flex h-full items-center justify-center text-center text-[1.1rem] italic text-ink-2">No session activity recorded in the last 24 hours.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hourlyActivity} margin={{ top: 15, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#000000', fontWeight: 700 }} interval={3} height={30} />
                  <YAxis tick={{ fontSize: 10, fill: '#000000', fontWeight: 600 }} allowDecimals={false} width={50} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #064e3b', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 'bold', color: '#000' }}
                  />
                  <Bar dataKey="users" name="Unique Users" fill="#10b981" barSize={12} radius={[2, 2, 0, 0]} hide={!onlineVisibility.users} />
                  <Line type="monotone" dataKey="sessions" name="Concurrent Sessions" stroke="#f97316" strokeWidth={3} dot={{ r: 3, fill: '#f97316', strokeWidth: 0 }} hide={!onlineVisibility.sessions} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <CheckLegend
            className="mb-2 mt-2 flex w-full flex-nowrap justify-center gap-3"
            fontSize="0.8rem"
            scale={1.1}
            items={[
              { key: 'users', label: 'Unique Users', color: '#10b981' },
              { key: 'sessions', label: 'Concurrent Sessions', color: '#f97316' },
            ]}
            visible={onlineVisibility}
            onToggle={(k) => setOnlineVisibility((p: any) => ({ ...p, [k]: !p[k] }))}
          />
        </div>
      )}

      {/* Chart C — tehsil hotspots, horizontal scroll */}
      <div className="card-plain p-6 max-md:p-2">
        <div className="mb-2 text-center text-[1.1rem] font-semibold text-[#033748]">Tehsil Hotspots ({processedStats.tehsilStats.length} tehsils)</div>
        <CheckLegend
          className="mb-2 flex justify-center gap-3"
          dimHidden
          items={[
            { key: 'active', label: 'Active', color: HOTSPOT_ACTIVE },
            { key: 'inactive', label: 'Inactive', color: HOTSPOT_INACTIVE },
          ]}
          visible={hot}
          onToggle={(k) => setHot((h) => ({ ...h, [k]: !h[k as 'active' | 'inactive'] }))}
        />
        {!hot.active && !hot.inactive ? (
          <div className="py-6 text-center text-ink-2">Tick Active and/or Inactive to show the chart.</div>
        ) : (
          <div style={{ overflowX: 'auto', overflowY: 'hidden', border: '1px solid #eef2f7', borderRadius: 8 }}>
            <div style={{ width: chartWidth, height: 380 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 18, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="_id" type="category" interval={0} stroke="#888" tickLine={false} height={110} tick={{ fontSize: 10, fill: '#000', fontWeight: 600, angle: -45, textAnchor: 'end' }} />
                  <YAxis type="number" stroke="#888" tickLine={false} allowDecimals={false} width={40} tick={{ fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }}
                    formatter={(v: any, name: any, item: any) => {
                      const t = item?.payload?.userCount || 0;
                      return [`${v} (${t ? ((v / t) * 100).toFixed(1) : 0}%)`, name];
                    }}
                    labelFormatter={(l: any, p: any) => `${l} · ${p?.[0]?.payload?.userCount || 0} users`}
                  />
                  {hot.active && (
                    <Bar dataKey="activeCount" name="Active" stackId="u" fill={HOTSPOT_ACTIVE} barSize={18} radius={hot.inactive ? 0 : [4, 4, 0, 0]}>
                      {!hot.inactive && label}
                    </Bar>
                  )}
                  {hot.inactive && (
                    <Bar dataKey="inactiveCount" name="Inactive" stackId="u" fill={HOTSPOT_INACTIVE} barSize={18} radius={[4, 4, 0, 0]}>
                      {label}
                    </Bar>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Multi-device risk */}
      <div className="card-plain p-4">
        <div className="mb-3 text-center text-[1.05rem] font-semibold text-[#033748]">Multi-Device Risk Analysis</div>
        <div className="flex flex-col gap-2 text-teal-ink">
          <div className="flex justify-between"><span>High Risk (5+ devices):</span><Badge bg="danger">{s.highRisk}</Badge></div>
          <div className="flex justify-between"><span>Medium Risk (3-4 devices):</span><Badge bg="warning">{s.mediumRisk}</Badge></div>
          <div className="flex justify-between"><span>Low Risk (2 devices):</span><Badge bg="info">{s.lowRisk}</Badge></div>
          <hr className="border-[#dee2e6]" />
          <div className="flex justify-between font-bold"><span>Total Extra Devices:</span><span className="text-[#dc3545]">{s.totalExtraIPs}</span></div>
        </div>
      </div>
    </div>
  );
}

export default memo(OverviewTab);
