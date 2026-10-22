// Port of StatsTabs/LoginActivityTab.js
import { memo } from 'react';
import { useNavigate } from 'react-router';
import { Badge, cn } from '@/shared/ui';
import { formatNumber, formatDateTime } from '../statsUtils';

const PERIODS = [
  { key: 'last24h', label: 'Unique Users (24h)', title: '24 Hours' },
  { key: 'last7d', label: 'Unique Users (7d)', title: '7 Days' },
  { key: 'last30d', label: 'Unique Users (30d)', title: '30 Days' },
];

function LoginActivityTab({ processedStats, selectedPeriod, setSelectedPeriod, periodUsers }: any) {
  const navigate = useNavigate();
  if (!processedStats) return null;
  const cur = PERIODS.find((p) => p.key === selectedPeriod) || PERIODS[0];
  return (
    <div className="mt-4">
      <div className="mb-6 grid grid-cols-3 gap-2 md:gap-6">
        {PERIODS.map((p) => {
          const sel = selectedPeriod === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setSelectedPeriod(p.key)}
              className="card-plain h-full px-1 py-4 text-center transition-all duration-200 max-md:py-1.5"
              style={{ background: sel ? '#e0f2fe' : '#ffffff' }}
            >
              <h4 className={cn('m-0 text-2xl font-medium max-md:text-base', sel ? 'text-[#0d6efd]' : 'text-teal-ink')}>
                {formatNumber(processedStats.loginStats[p.key]?.uniqueUsers || 0)}
              </h4>
              <p className="m-0 text-ink-2 max-md:text-[0.62rem] max-md:leading-[1.1]">{p.label}</p>
            </button>
          );
        })}
      </div>

      <div className="card-plain overflow-hidden">
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-[#dee2e6] bg-white py-3">
          <h6 className="m-0 text-center font-bold uppercase text-[#212529]" style={{ letterSpacing: 1 }}>{cur.title} Activity List</h6>
          <Badge bg="info">{periodUsers.length} Users</Badge>
        </div>
        <div className="table-wrap max-h-[400px] rounded-none border-0">
          <table className="table table-hover">
            <thead><tr><th className="freeze">User</th><th>Active Tehsil</th><th>Subscription</th><th>Last Activity</th><th>Sessions</th></tr></thead>
            <tbody>
              {periodUsers.length > 0 ? (
                periodUsers.map((u: any) => (
                  <tr key={u.userId} className="cursor-pointer" onClick={() => navigate(`/users/${u.userId}`)}>
                    <td className="freeze">
                      <strong>{u.userName}</strong>
                      <br />
                      <span className="text-[0.8rem]">{u.userId}</span>
                    </td>
                    <td>{u.tehsil || 'N/A'}</td>
                    <td><Badge bg={String(u.subscriptionType || '').toLowerCase() === 'permanent' ? 'warning' : 'info'} className="text-[0.7rem]">{u.subscriptionType}</Badge></td>
                    <td className="whitespace-nowrap"><small className="text-ink-2">{formatDateTime(u.lastLogin)}</small></td>
                    {/* D7 fix: legacy bg-secondary pill was nearly invisible on white */}
                    <td className="text-center"><Badge bg="secondary" pill>{u.sessionCount}</Badge></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="py-6 text-center text-ink-2">No activity recorded for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default memo(LoginActivityTab);
