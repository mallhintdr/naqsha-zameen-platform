// Port of StatsTabs/MultiIpTab.js
import { memo, useMemo } from 'react';
import { Eye } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar } from 'recharts';
import { Badge } from '@/shared/ui';
import { formatDateTime, useIsSmallScreen } from '../statsUtils';

const RISK_ROW: Record<string, string> = { high: 'row-risk-high', medium: 'row-risk-medium', low: 'row-risk-low' };
const RISK_SOLID: Record<string, string> = { high: '#f8d7da', medium: '#fff3cd', low: '#cff4fc' };
const RISK_BADGE: Record<string, 'danger' | 'warning' | 'info'> = { high: 'danger', medium: 'warning', low: 'info' };

function TopTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border bg-white p-3 text-[#212529] shadow" style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
      <div className="mb-1 border-b pb-1 font-bold">{d.name}</div>
      <div><strong>User ID:</strong> {d.userId}</div>
      <div><strong>Tehsil:</strong> {d.tehsil}</div>
      <div className="mt-1 text-[#0d6efd]"><strong>Sessions (24h):</strong> {d.sessions}</div>
      <div className="text-[#198754]"><strong>Devices (30d) (Total):</strong> {d.ips}</div>
    </div>
  );
}

function MultiIpTab({ processedStats, multiIPAnalysis, multiIpActiveLegend, setMultiIpActiveLegend, handleUserClick, openDevices }: any) {
  const small = useIsSmallScreen();
  const top10 = useMemo(() => {
    if (!processedStats?.sessions) return [];
    const cutoff24 = Date.now() - 24 * 60 * 60 * 1000;
    const byUser: Record<string, any> = {};
    processedStats.sessions.forEach((s: any) => {
      const label = s.userName || s.userId;
      if (!byUser[label]) byUser[label] = { name: label, userId: s.userId, tehsil: s.tehsil || 'N/A', sessions24h: 0, ipAddresses: new Set() };
      if (new Date(s.start).getTime() >= cutoff24) byUser[label].sessions24h += 1;
      if (s.ipAddress) byUser[label].ipAddresses.add(s.ipAddress);
    });
    return Object.values(byUser)
      .map((u: any) => ({ ...u, sessions: u.sessions24h, ips: u.ipAddresses.size }))
      .sort((a: any, b: any) => b.sessions - a.sessions)
      .slice(0, 10);
  }, [processedStats]);

  return (
    <div className="mt-4">
      {processedStats?.sessions && (
        <div className="card-plain mb-6 mt-4 p-4 max-md:p-2">
          <div className="mb-3 text-center">
            <h5 className="m-0 text-lg font-bold text-teal-ink">Top 10 Users by Session</h5>
            <div className="text-sm text-ink-2">Past 24 hours</div>
          </div>
          <div className="mb-3 flex justify-center gap-6 text-[0.85rem] font-semibold text-teal-ink">
            {[['sessions', 'Sessions'], ['ips', 'Devices (30d)']].map(([k, l]) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="multiIpActiveLegend" checked={multiIpActiveLegend === k} onChange={() => setMultiIpActiveLegend(k)} />
                {l}
              </label>
            ))}
          </div>
          <div style={{ width: '100%', height: 260 }}>
            {top10.length === 0 || top10.every((u: any) => u.sessions === 0) ? (
              <div className="flex h-full items-center justify-center italic text-ink-2">No session activity in the last 24 hours.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={top10} margin={{ top: 15, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: small ? 9 : 11, fontWeight: 600 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: small ? 10 : 12 }} />
                  <Tooltip content={<TopTooltip />} />
                  {multiIpActiveLegend === 'sessions' ? (
                    <Bar dataKey="sessions" name="Sessions" fill="#0284c7" barSize={35} radius={[4, 4, 0, 0]} />
                  ) : (
                    <Bar dataKey="ips" name="Devices (30d)" fill="#16a34a" barSize={35} radius={[4, 4, 0, 0]} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      <div className="card-plain p-4 max-md:p-2">
        <div className="mb-3 text-center text-[1.05rem] font-semibold text-[#033748]">Users with Multiple Devices</div>
        <div className="table-wrap">
          <table className="table table-hover">
            <thead>
              <tr><th className="freeze">User</th><th>Risk Level</th><th>Devices (30d)</th><th>Subscription</th><th>Last Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {multiIPAnalysis.users.map((u: any, i: number) => (
                <tr key={u.userId || i} className={RISK_ROW[u.riskLevel]}>
                  <td className="freeze cursor-pointer whitespace-nowrap" style={{ background: RISK_SOLID[u.riskLevel] }} title="Show devices (resolution, device ID, times)" onClick={() => openDevices(u)}>
                    <strong>{u.userName}</strong>
                    <br />
                    <small className="text-ink-2 underline">{u.userId}</small>
                  </td>
                  <td><Badge bg={RISK_BADGE[u.riskLevel]}>{String(u.riskLevel).toUpperCase()}</Badge></td>
                  <td className="text-center"><Badge bg="dark" pill>{u.ipCount}</Badge></td>
                  <td className="whitespace-nowrap">{u.subscriptionType}</td>
                  <td className="whitespace-nowrap">{formatDateTime(u.lastActive)}</td>
                  <td className="text-center">
                    <button className="btn btn-sm btn-outline-primary !rounded px-2 py-1" title="View Details" onClick={() => handleUserClick(u)}>
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {multiIPAnalysis.users.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-ink-2">No multi-device users detected</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default memo(MultiIpTab);
