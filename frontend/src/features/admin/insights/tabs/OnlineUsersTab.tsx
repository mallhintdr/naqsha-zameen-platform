// Port of StatsTabs/OnlineUsersTab.js
import { memo } from 'react';
import { Badge } from '@/shared/ui';
import { formatDateTime, DarkHeader, NumberPager } from '../statsUtils';

const PAGE = 20;
const DETAILS_BTN = { backgroundColor: '#0f2027', color: '#ffffff', borderColor: '#0f2027', fontWeight: 600, padding: '0.1rem 0.5rem', fontSize: '0.7rem', borderRadius: 4 };

function OnlineUsersTab({ onlineUsers, onlinePage, setOnlinePage, handleUserClick }: any) {
  const pages = Math.ceil(onlineUsers.length / PAGE);
  const rows = onlineUsers.slice((onlinePage - 1) * PAGE, onlinePage * PAGE);
  return (
    <div className="card-plain mt-4 overflow-hidden">
      <DarkHeader title="Currently Online Details" badge={`${onlineUsers.length} Users`} />
      <div className="table-wrap rounded-none border-0" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="table no-hover-table">
          <thead>
            <tr><th className="freeze">User</th><th>Tehsil</th><th>Location</th><th>IP Address</th><th>Subscription</th><th>Last Active</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((u: any, i: number) => (
                <tr key={u.userId || i}>
                  <td className="freeze cursor-pointer !px-2 !py-1" onClick={() => handleUserClick(u)}>
                    <strong>{u.userName || 'N/A'}</strong>
                    <br />
                    <span className="text-[0.8rem] underline">{u.userId}</span>
                  </td>
                  <td className="!px-2">{u.tehsil || 'N/A'}</td>
                  <td className="!px-2"><Badge bg="info" className="!font-normal text-[0.7rem]">{u.location?.city || 'Unknown'}</Badge></td>
                  <td className="whitespace-nowrap !px-2">
                    <code className="text-[0.7rem]">{u.ipAddress}</code>
                    {u.ipCount > 1 && <Badge bg="warning" className="ml-1 text-[0.6rem]">{u.ipCount}</Badge>}
                  </td>
                  <td className="!px-2 text-[0.8rem]">{u.subscriptionType}</td>
                  <td className="whitespace-nowrap !px-2 text-[0.75rem] text-ink-2">{formatDateTime(u.lastActive)}</td>
                  <td className="!px-2 text-center">
                    <button className="btn btn-sm" style={DETAILS_BTN} onClick={() => handleUserClick(u)}>Details</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} className="py-6 text-center">No users online</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {onlineUsers.length > PAGE && <NumberPager page={onlinePage} pages={pages} onChange={setOnlinePage} />}
    </div>
  );
}

export default memo(OnlineUsersTab);
