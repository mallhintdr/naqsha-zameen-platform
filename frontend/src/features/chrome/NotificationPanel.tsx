/** WhatsApp-palette notification panel (legacy Header.js custom panel, inv-01 §2.5). */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Bell, Check, CheckCheck, ChevronDown, ChevronUp, ExternalLink, Filter, RefreshCw, Reply, Trash2, User, UserCheck, UserPlus, X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { fmtDate, rs } from '@/shared/lib/format';
import { useChromeStore } from './chromeStore';

const NOTIF_FILTERS: [string, string][] = [
  ['all', 'All notifications'],
  ['requests', 'Requests (renewal / mouza change)'],
  ['subscription', 'Subscriptions & renewals'],
  ['activation', 'Activations & sign-ups'],
  ['alert', 'Alerts'],
  ['profile', 'Profile & access'],
  ['messages', 'Messages'],
  ['unread', 'Unread only'],
];
const matchNotif = (n: any, f: string) => {
  if (f === 'all') return true;
  if (f === 'requests') return !!(n.action && n.action.url);
  if (f === 'unread') return !n.read;
  if (f === 'messages') return /^Message from /.test(n.title || '') || (n.type === 'info' && !!n.replyTo);
  if (f === 'activation') return n.type === 'activation' || /registration|activated|activation/i.test(n.title || '');
  return n.type === f;
};
const countNotif = (list: any[], f: string) => (list || []).filter((n) => matchNotif(n, f)).length;

function NotifDetails({ d }: { d: any }) {
  const rows = [
    d.removed?.length ? ['Removed', d.removed.join(', '), '#b91c1c'] : null,
    d.added?.length ? ['Added', d.added.join(', '), '#166534'] : null,
    d.plan ? ['Plan', d.plan] : null,
    d.tehsil ? ['Tehsil', d.tehsil] : null,
    d.currentMouzas !== undefined ? ['Current mouzas', d.currentMouzas] : null,
    d.totalAfter !== undefined ? ['After approval', d.totalAfter, '#0b5ed7'] : null,
    d.lastFeePaid !== undefined ? ['Fee paid', rs(d.lastFeePaid)] : null,
    d.daysLeft !== undefined ? ['Days left', d.daysLeft] : null,
    d.endDate ? ['Ends', fmtDate(d.endDate)] : null,
    d.mobile ? ['Mobile', d.mobile] : null,
    d.note ? ['Note', d.note] : null,
  ].filter(Boolean) as [string, any, string?][];
  if (!rows.length) return null;
  const cell = 'border-b border-[#e2e8f0] px-1 py-px text-[0.68rem] leading-[1.25] align-top';
  return (
    <table onClick={(e) => e.stopPropagation()} className="mt-[3px] w-full border-collapse rounded border border-[#cbd5e1] bg-[#f8fafc]">
      <tbody>
        {rows.map(([k, v, color]) => (
          <tr key={k}>
            <td className={`${cell} w-px whitespace-nowrap font-semibold`} style={{ color: color || '#64748b' }}>{k}</td>
            <td className={`${cell} break-words font-bold`} style={{ color: color || '#212529' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const fmtStamp = (ts: any) => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${time}`;
};

export default function NotificationPanel({ onClose, onProfile }: { onClose: () => void; onProfile: () => void }) {
  const { user, notifications, unreadNotificationsCount, markNotificationAsRead, markAllNotificationsAsRead, clearNotifications } = useAuth();
  const navigate = useNavigate();
  const setReplyFor = useChromeStore((s) => s.setReplyFor);
  const [notifFilter, setNotifFilter] = useState('all');
  const [openNotif, setOpenNotif] = useState<Record<string, boolean>>({});
  const list = (notifications || []).filter((n) => matchNotif(n, notifFilter));

  const footerBtns = [
    { Icon: User, label: 'Profile', action: onProfile, tone: 'cyan' },
    { Icon: CheckCheck, label: 'Read All', action: () => markAllNotificationsAsRead(), tone: 'cyan' },
    { Icon: X, label: 'Close', action: onClose, tone: 'red' },
  ];

  return (
    <div
      className="absolute right-0 top-[calc(100%+10px)] z-[9999] flex max-h-[calc(100dvh-80px)] w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.45)] max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:top-[48px] max-sm:w-auto max-sm:max-w-none"
      id="notification-panel"
      role="dialog"
      aria-label="Notifications"
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-[rgba(0,255,255,0.15)] px-3 py-1.5"
        style={{ background: 'radial-gradient(circle at 20% 20%, rgba(45,152,255,0.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,0.97), rgba(18,26,54,1))' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[0.82rem] font-semibold tracking-[0.5px] text-[#00ffff]">Notifications</span>
          <span className="text-[0.65rem] text-[#a0b4cc] opacity-80">· {unreadNotificationsCount} unread</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="Clear all" aria-label="Clear all" className="grid h-8 w-8 place-items-center text-[#ff4d4d]" onClick={(e) => { e.stopPropagation(); clearNotifications(); }}>
            <Trash2 size={13} />
          </button>
          <button type="button" title="Close" aria-label="Close" className="grid h-8 w-8 place-items-center text-[#a0b4cc]" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[#cbd5e1] bg-[#f1f5f9] px-2 py-1">
        <Filter size={11} color="#64748b" />
        <select
          value={notifFilter}
          onChange={(e) => setNotifFilter(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-[#64748b] bg-white px-1 py-0.5 text-[0.75rem] text-[#1f2937]"
        >
          {NOTIF_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l} ({countNotif(notifications, v)})</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="notification-list min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#ECE5DD]">
        {list.length > 0 ? (
          list.map((notif: any) => {
            const nid = notif.id || notif._id;
            const titleLower = (notif.title || '').toLowerCase();
            const typeLower = (notif.type || '').toLowerCase();
            const msgLower = (notif.message || '').toLowerCase();
            const isRegistration = titleLower.includes('registration') || typeLower === 'registration' || msgLower.includes('created their account');
            const isActivation = titleLower.includes('activated') || titleLower.includes('activation') || typeLower === 'activation' || msgLower.includes('activated their account');
            let headerColor = '#2c3e50';
            let Icon = notif.type === 'subscription' ? RefreshCw : Bell;
            let iconColor = '#00ffff';
            if (isRegistration) {
              headerColor = '#b8860b';
              Icon = UserPlus;
              iconColor = '#ffd700';
            } else if (isActivation) {
              headerColor = '#28a745';
              Icon = UserCheck;
              iconColor = '#2ecc71';
            }
            const open = !!openNotif[nid];
            const long = (notif.message || '').length > 90 || /\n/.test(notif.message || '');
            const hasMore = long || !!notif.details;
            return (
              <div
                key={nid}
                onClick={() => markNotificationAsRead(nid)}
                className="flex cursor-pointer items-start gap-2 border-b border-[#E1D9D1] px-2 py-1.5 transition-colors"
                style={{ backgroundColor: notif.read ? '#FFFFFF' : '#DCF8C6' }}
              >
                <div
                  className="mt-px flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'linear-gradient(135deg, rgba(11,14,40,0.95), rgba(18,26,54,0.95))', border: `1px solid ${iconColor}40`, color: iconColor }}
                >
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="min-w-0 break-words text-[0.82rem] font-bold" style={{ color: headerColor }}>{notif.title}</span>
                    <small className="shrink-0 text-[0.68rem] text-[#667781]">{fmtStamp(notif.timestamp)}</small>
                  </div>
                  <div className="mt-px flex gap-1.5" style={{ alignItems: open ? 'flex-start' : 'center' }}>
                    <p
                      className="m-0 min-w-0 flex-1 break-words text-[0.78rem] leading-[1.3] text-[#4a4a4a]"
                      style={open ? { whiteSpace: 'pre-wrap' } : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {notif.message}
                    </p>
                    {hasMore && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenNotif((o) => ({ ...o, [nid]: !o[nid] })); }}
                        className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[0.7rem] font-semibold text-[#0b5ed7]"
                      >
                        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {open ? 'Less' : 'Details'}
                      </button>
                    )}
                  </div>
                  {open && notif.details && <NotifDetails d={notif.details} />}
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {notif.action?.url &&
                      (notif.actionDone ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#16a34a]"><Check size={11} />Done</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); markNotificationAsRead(nid); onClose(); navigate(notif.action.url); }}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md border-none px-3 py-1 text-[0.75rem] font-semibold text-white bg-chrome-solid"
                        >
                          <ExternalLink size={11} />{notif.action.label || 'Open'}
                        </button>
                      ))}
                    {notif.replyTo && ['admin', 'subadmin'].includes(user?.userType || '') && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); markNotificationAsRead(nid); onClose(); setReplyFor(notif); }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[#0b5ed7] bg-white px-3 py-[3px] text-[0.75rem] font-semibold text-[#0b5ed7]"
                      >
                        <Reply size={11} />Reply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white py-6 text-center text-[#6c757d]">
            <Bell size={29} color="#ccc" className="mx-auto mb-2" />
            <p className="m-0 text-[0.85rem]">{notifFilter === 'all' ? 'No notifications yet' : 'No notifications of this type'}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 gap-2 border-t border-[rgba(0,255,255,0.12)] px-2.5 py-[7px]" style={{ background: 'linear-gradient(135deg, rgba(11,14,40,0.98), rgba(18,26,54,1))' }}>
        {footerBtns.map(({ Icon, label, action, tone }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className={
              'inline-flex min-h-[30px] flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-[5px] text-[0.75rem] font-semibold tracking-[0.3px] transition-all ' +
              (tone === 'red'
                ? 'border border-[rgba(255,77,77,0.45)] text-[#ff8a8a] bg-[linear-gradient(135deg,rgba(255,77,77,0.14),rgba(138,43,226,0.10))] hover:bg-[linear-gradient(135deg,rgba(255,77,77,0.26),rgba(138,43,226,0.18))]'
                : 'border border-[rgba(0,255,255,0.3)] text-[#00ffff] bg-[linear-gradient(135deg,rgba(0,255,255,0.12),rgba(138,43,226,0.12))] hover:bg-[linear-gradient(135deg,rgba(0,255,255,0.22),rgba(138,43,226,0.22))]')
            }
          >
            <Icon size={12} />{label}
          </button>
        ))}
      </div>
    </div>
  );
}
