// /stats — port of components/Admin/EnhancedStatistics.js ("Analytics and Statistics").
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, Globe, Home, LogIn, MapPinned, Network, RefreshCw, TriangleAlert, User as UserIcon, UserPlus } from 'lucide-react';
import { api, errText, isCancel } from '@/shared/api/client';
import { useAuth } from '@/features/auth/AuthProvider';
import { GlobalHeatmapModal, UserLocationModal } from '@/features/users/LocationComponents';
import { Alert, Badge, Modal, Spinner, Tabs } from '@/shared/ui';
import { bucketRenewalsByGranularity, formatDateTime, getIPGeolocation, getRenewalViewConfig } from './statsUtils';

const OverviewTab = lazy(() => import('./tabs/OverviewTab'));
const OnlineUsersTab = lazy(() => import('./tabs/OnlineUsersTab'));
const LoginActivityTab = lazy(() => import('./tabs/LoginActivityTab'));
const UserRegistrationsTab = lazy(() => import('./tabs/UserRegistrationsTab'));
const RenewalsTab = lazy(() => import('./tabs/RenewalsTab'));
const MultiIpTab = lazy(() => import('./tabs/MultiIpTab'));
const VisitorsTab = lazy(() => import('./tabs/VisitorsTab'));

const DAY = 24 * 60 * 60 * 1000;
const IP_HEADER = {
  background: 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.35), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 0.9), rgba(18, 26, 54, 0.92))',
  color: 'white',
  border: 'none',
  padding: '8px 15px',
};

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="py-6 text-center"><Spinner size="sm" /></div>}>{children}</Suspense>
);
const TabTitle = ({ icon: Icon, color, children }: { icon: any; color: string; children: ReactNode }) => (
  <>
    <Icon size={17} style={{ color }} />
    {children}
  </>
);

export default function InsightsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rawStats, setRawStats] = useState<any>(null);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [subscriptionData, setSubscriptionData] = useState<any>(null);
  const [multiDeviceUsers, setMultiDeviceUsers] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [overviewVisibility, setOverviewVisibility] = useState({ activeUsers: true, rollingAvg: true, sessions: false });
  const [renewalsVisibility, setRenewalsVisibility] = useState({ count: true, revenue: true });
  const [onlineVisibility, setOnlineVisibility] = useState({ users: true, sessions: false });
  const [multiIpActiveLegend, setMultiIpActiveLegend] = useState('ips');

  const [activeTab, setActiveTab] = useState('overview');
  const [regPeriod, setRegPeriod] = useState('daily');
  const [renewalView, setRenewalView] = useState('30d');
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [selectedUserIPs, setSelectedUserIPs] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('last24h');
  const [onlinePage, setOnlinePage] = useState(1);

  useEffect(() => {
    if (authLoading) return;
    if (!user) navigate('/login', { replace: true });
    else if (user.userType !== 'admin') navigate('/', { replace: true });
  }, [authLoading, user, navigate]);

  const isAdmin = user?.userType === 'admin';
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, onlineRes, subRes, multiRes] = await Promise.all([
          api.get('/stats', { signal }),
          api.get('/online-users', { signal }),
          api.get('/subscription-stats', { signal }).catch(() => ({ data: null })),
          api.get('/multi-device-users', { signal }).catch(() => ({ data: null })),
        ]);
        setMultiDeviceUsers(Array.isArray(multiRes.data) ? multiRes.data : null);
        setRawStats(statsRes.data);
        // Legacy behaviour: one geo lookup per online user, awaited before render.
        const enhanced = await Promise.all((onlineRes.data || []).map(async (u: any) => ({ ...u, location: await getIPGeolocation(u.ipAddress) })));
        if (signal.aborted) return;
        setOnlineUsers(enhanced);
        setSubscriptionData(subRes.data);
        setLastUpdated(new Date());
      } catch (err: any) {
        if (!isCancel(err)) setError(err?.response?.data?.error || errText(err, 'Failed to load statistics'));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [authLoading, isAdmin, refreshKey]);

  const loadUserDetails = useCallback(async (userId: string) => {
    try {
      const { data } = await api.get(`/user-ip-history/${userId}`);
      const ipHistory = data?.ipHistory || [];
      setSelectedUserIPs(await Promise.all(ipHistory.map(async (e: any) => ({ ...e, location: await getIPGeolocation(e.ipAddress) }))));
    } catch {
      setSelectedUserIPs([]);
    }
  }, []);

  const processedStats = useMemo(() => {
    if (!rawStats) return null;
    const dailyActivity = (rawStats.dailyActivity || []).map((d: any, idx: number, arr: any[]) => {
      const win = arr.slice(Math.max(0, idx - 6), idx + 1);
      const sum = win.reduce((a, c) => a + (c.activeUsers || 0), 0);
      return { ...d, rollingAvg: parseFloat((sum / win.length).toFixed(1)) };
    });
    return {
      totalUsers: rawStats.totalUsers || 0,
      totalOnline: rawStats.totalOnline || 0,
      loginStats: rawStats.loginStats || {},
      sessions: Array.isArray(rawStats.sessions) ? rawStats.sessions : [],
      tehsilStats: (rawStats.tehsilStats || []).map((t: any) => ({ ...t, _id: typeof t._id === 'string' && t._id.trim() ? t._id.trim() : 'Unknown' })),
      dailyActivity,
      subscriptionHealth: rawStats.subscriptionHealth || { active: 0, expired: 0, pending: 0, expiringSoon: 0 },
      registrationsDaily: rawStats.registrationsDaily || [],
      registrationsWeekly: rawStats.registrationsWeekly || [],
      registrationsMonthly: rawStats.registrationsMonthly || [],
    };
  }, [rawStats]);

  // Falls back to online users when /multi-device-users fails (legacy gotcha 7).
  const multiIPAnalysis = useMemo(() => {
    const source = Array.isArray(multiDeviceUsers) ? multiDeviceUsers : onlineUsers;
    const users = source
      .filter((u: any) => (u.ipCount || 0) > 1)
      .map((u: any) => ({ ...u, riskLevel: u.ipCount > 5 ? 'high' : u.ipCount > 3 ? 'medium' : 'low', ipAddresses: u.ipAddresses || [] }))
      .sort((a: any, b: any) => b.ipCount - a.ipCount);
    return {
      users,
      summary: {
        totalUsers: users.length,
        highRisk: users.filter((u) => u.riskLevel === 'high').length,
        mediumRisk: users.filter((u) => u.riskLevel === 'medium').length,
        lowRisk: users.filter((u) => u.riskLevel === 'low').length,
        totalExtraIPs: users.reduce((s, u) => s + Math.max(0, u.ipCount - 1), 0),
      },
    };
  }, [onlineUsers, multiDeviceUsers]);

  const periodUsers = useMemo(() => {
    if (!processedStats) return [];
    const ms = { last24h: DAY, last7d: 7 * DAY, last30d: 30 * DAY }[selectedPeriod] || DAY;
    const cutoff = Date.now() - ms;
    const map = new Map<string, any>();
    processedStats.sessions.forEach((s: any) => {
      const start = new Date(s.start);
      if (start.getTime() < cutoff) return;
      const u = map.get(s.userId);
      if (!u) map.set(s.userId, { userId: s.userId, userName: s.userName, tehsil: s.tehsil, subscriptionType: s.subscriptionType, lastLogin: start, sessionCount: 1 });
      else {
        u.sessionCount += 1;
        if (start > u.lastLogin) u.lastLogin = start;
      }
    });
    return Array.from(map.values()).sort((a, b) => b.lastLogin - a.lastLogin);
  }, [processedStats, selectedPeriod]);

  const renewalAnalysis = useMemo(() => {
    if (!subscriptionData) return null;
    const now = Date.now();
    const isPaid = (r: any) => r.subscriptionType && !['trial', 'free'].includes(String(r.subscriptionType).toLowerCase());
    const all = subscriptionData.recentRenewals || [];
    const paid = all.filter((r: any) => !r.subAdminPayment && isPaid(r));
    const subPays = all.filter((r: any) => r.subAdminPayment);
    const t = (r: any) => new Date(r.date).getTime();
    const within = (list: any[], d: number) => list.filter((r) => t(r) >= now - d * DAY);
    const prior = (list: any[], d: number) => list.filter((r) => t(r) >= now - 2 * d * DAY && t(r) < now - d * DAY);
    const sumPaid = (list: any[]) => list.reduce((s, r) => s + (r.fee || 0), 0);
    // D7: old direct renewals with no recorded fee assume Rs 1000 (business assumption preserved).
    const sumFee = (list: any[]) => list.reduce((s, r) => s + (r.bySubAdmin ? r.fee || 0 : r.fee || 1000), 0);
    const pct = (cur: number, prev: number) => (!prev ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));
    const revenue = (d: number) => sumFee(within(paid, d)) + sumPaid(within(subPays, d));
    const priorRevenue = (d: number) => sumFee(prior(paid, d)) + sumPaid(prior(subPays, d));
    const { rangeDays, granularity } = getRenewalViewConfig(renewalView);
    return {
      last7Days: within(paid, 7),
      last30Days: within(paid, 30),
      last90Days: within(paid, 90),
      last180Days: within(paid, 180),
      revenue7d: revenue(7),
      revenue30d: revenue(30),
      revenue90d: revenue(90),
      revenue180d: revenue(180),
      growthPct7d: pct(revenue(7), priorRevenue(7)),
      growthPct30d: pct(revenue(30), priorRevenue(30)),
      growthPct90d: pct(revenue(90), priorRevenue(90)),
      growthPct180d: pct(revenue(180), priorRevenue(180)),
      dailyRenewals: bucketRenewalsByGranularity([...within(paid, rangeDays), ...within(subPays, rangeDays)], granularity),
    };
  }, [subscriptionData, renewalView]);

  const hourlyActivity = useMemo(() => {
    const now = Date.now();
    const slots: { time: string; timestamp: number; users: Set<string>; sessions: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 60 * 60 * 1000);
      d.setMinutes(0, 0, 0);
      const h = d.getHours();
      slots.push({ time: `${h < 10 ? '0' + h : h}:00`, timestamp: d.getTime(), users: new Set(), sessions: 0 });
    }
    (processedStats?.sessions || []).forEach((s: any) => {
      const start = new Date(s.start).getTime();
      const end = s.end ? new Date(s.end).getTime() : now;
      slots.forEach((slot) => {
        if (start < slot.timestamp + 3600000 && end > slot.timestamp) {
          slot.users.add(s.userId);
          slot.sessions += 1;
        }
      });
    });
    return slots.map((s) => ({ time: s.time, users: s.users.size, sessions: s.sessions }));
  }, [processedStats]);

  const handleUserClick = (u: any) => {
    setSelectedUser(u);
    setSelectedUserIPs([]);
    setShowUserModal(true);
    loadUserDetails(u.userId);
  };

  if (authLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!user || !isAdmin) return null;

  const tabs = [
    {
      key: 'overview',
      title: <TabTitle icon={BarChart3} color="#0d6efd">Overview</TabTitle>,
      content: (
        <Lazy>
          <OverviewTab
            processedStats={processedStats}
            multiIPAnalysis={multiIPAnalysis}
            overviewVisibility={overviewVisibility}
            setOverviewVisibility={setOverviewVisibility}
            hourlyActivity={hourlyActivity}
            onlineVisibility={onlineVisibility}
            setOnlineVisibility={setOnlineVisibility}
          />
        </Lazy>
      ),
    },
    {
      key: 'online-users',
      title: <TabTitle icon={Globe} color="#198754">Online ({onlineUsers.length})</TabTitle>,
      content: <Lazy><OnlineUsersTab onlineUsers={onlineUsers} onlinePage={onlinePage} setOnlinePage={setOnlinePage} handleUserClick={handleUserClick} /></Lazy>,
    },
    {
      key: 'activity',
      title: <TabTitle icon={LogIn} color="#0dcaf0">Activity</TabTitle>,
      content: <Lazy><LoginActivityTab processedStats={processedStats} selectedPeriod={selectedPeriod} setSelectedPeriod={setSelectedPeriod} periodUsers={periodUsers} /></Lazy>,
    },
    {
      key: 'user-registrations',
      title: <TabTitle icon={UserPlus} color="#6c757d">Registrations</TabTitle>,
      content: <Lazy><UserRegistrationsTab processedStats={processedStats} regPeriod={regPeriod} setRegPeriod={setRegPeriod} /></Lazy>,
    },
    {
      key: 'renewals',
      title: <TabTitle icon={RefreshCw} color="#ffc107">Renewals</TabTitle>,
      content: (
        <Lazy>
          <RenewalsTab
            processedStats={processedStats}
            renewalAnalysis={renewalAnalysis}
            renewalsVisibility={renewalsVisibility}
            setRenewalsVisibility={setRenewalsVisibility}
            renewalView={renewalView}
            setRenewalView={setRenewalView}
          />
        </Lazy>
      ),
    },
    {
      key: 'multi-ip',
      title: <TabTitle icon={Network} color="#dc3545">Multi-IP ({multiIPAnalysis.summary.totalUsers})</TabTitle>,
      content: (
        <Lazy>
          <MultiIpTab
            processedStats={processedStats}
            multiIPAnalysis={multiIPAnalysis}
            multiIpActiveLegend={multiIpActiveLegend}
            setMultiIpActiveLegend={setMultiIpActiveLegend}
            handleUserClick={handleUserClick}
          />
        </Lazy>
      ),
    },
    { key: 'visitors', title: <TabTitle icon={Globe} color="#0d6efd">Visitors</TabTitle>, content: <Lazy><VisitorsTab /></Lazy> },
  ];

  const risk = selectedUser?.riskLevel;
  const riskBg = risk === 'high' ? 'danger' : risk === 'medium' ? 'warning' : 'info';

  return (
    <div className="page stats-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title m-0">Analytics and Statistics</h2>
        <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
          {lastUpdated && <small className="text-ink-2">Updated {lastUpdated.toLocaleTimeString()}</small>}
          <div className="fill-row w-full sm:w-auto sm:flex-nowrap [&>*]:whitespace-normal [&>*]:sm:flex-none">
            <button className="btn btn-sm btn-outline-primary" onClick={() => navigate('/')}><Home size={14} /> Home</button>
            <button className="btn btn-sm btn-outline-success" onClick={() => setShowHeatmapModal(true)}>View Location Heatmap</button>
            <button className="btn btn-sm btn-outline-primary" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
      </div>

      {error && <Alert variant="danger" className="mb-6">{error}</Alert>}

      {loading && !processedStats ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} className="mb-6" />
      )}

      {/* User IP Analysis modal */}
      <Modal
        show={showUserModal}
        onHide={() => setShowUserModal(false)}
        size="lg"
        headerVariant="custom"
        headerStyle={IP_HEADER}
        className="sm:!max-w-[min(760px,calc(100vw-16px))]"
        bodyClassName="!p-2 bg-[#f8f9fa]"
        footerClassName="!p-2 !border-t-0 bg-[#f8f9fa] !justify-between"
        title={
          <span className="flex flex-wrap items-center gap-1 text-[0.95rem] font-semibold text-white">
            <UserIcon size={13} className="mr-1" />
            User IP Analysis: <span className="text-[#ffc107]">{selectedUser?.userName}</span>
            <Badge bg="light" className="ml-2 text-[0.65rem]">{selectedUser?.ipCount} IPs Detected</Badge>
          </span>
        }
        footer={
          <>
            <button
              className="btn btn-sm btn-outline-primary font-bold text-[0.75rem]"
              onClick={() => {
                setShowUserModal(false);
                setShowLocationModal(true);
              }}
            >
              <MapPinned size={13} /> VIEW MAP
            </button>
            <div className="flex gap-1">
              {/* Legacy FLAG button had no handler (D7): kept visible but disabled */}
              <button className="btn btn-sm btn-danger px-2 font-bold text-[0.75rem]" disabled title="Not available">FLAG</button>
              <button className="btn btn-sm btn-secondary px-2 text-[0.75rem]" onClick={() => setShowUserModal(false)}>CLOSE</button>
            </div>
          </>
        }
      >
        {selectedUser && (
          <div className="rounded border bg-white p-2 shadow-sm">
            <div className="mb-2 grid grid-cols-4 gap-1 border-b pb-2 text-center text-[0.75rem]">
              {[
                ['USER ID', <div key="v" className="truncate font-bold text-[#212529]">{selectedUser.userId}</div>],
                ['PLAN', <div key="v" className="font-bold text-[#212529]">{selectedUser.subscriptionType}</div>],
                ['TEHSIL', <div key="v" className="font-bold text-[#212529]">{selectedUser.tehsil || 'N/A'}</div>],
                ['STATUS', <Badge key="v" bg={riskBg} className="text-[0.6rem]">{String(risk || '').toUpperCase()}</Badge>],
              ].map(([l, v], i) => (
                <div key={i} className={i < 3 ? 'min-w-0 border-r' : 'min-w-0'}>
                  <div className="text-[0.65rem] text-ink-2">{l}</div>
                  {v}
                </div>
              ))}
            </div>
            <div className="px-1">
              <div className="mb-1 text-[0.65rem] font-bold uppercase text-ink-2" style={{ letterSpacing: '0.5px' }}>IP Address History &amp; Location</div>
              <div className="overflow-auto rounded border" style={{ maxHeight: 'min(250px, 45vh)' }}>
                <table className="w-full text-[0.72rem] max-[576px]:text-[0.65rem]">
                  <thead className="sticky top-0 bg-[#212529] text-white">
                    <tr>
                      {['IP ADDRESS', 'LOCATION', 'FIRST SEEN', 'LAST SEEN', 'SESS'].map((h) => (
                        <th key={h} className={`whitespace-nowrap px-1.5 py-1 text-left ${h === 'SESS' ? 'text-center' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUserIPs.length > 0 ? (
                      selectedUserIPs.map((ip, i) => (
                        <tr key={i} className="border-t odd:bg-black/[0.03] hover:bg-black/[0.06]">
                          <td className="whitespace-nowrap px-1.5 py-1"><code>{ip.ipAddress}</code></td>
                          <td className="px-1.5 py-1">
                            <div className="max-w-[140px] truncate font-bold">{ip.location?.city}, {ip.location?.region}</div>
                            <div className="text-[0.65rem] text-ink-2">{ip.location?.country}</div>
                          </td>
                          <td className="whitespace-nowrap px-1.5 py-1 text-ink-2">{formatDateTime(ip.firstSeen)}</td>
                          <td className="whitespace-nowrap px-1.5 py-1 font-semibold">{formatDateTime(ip.lastSeen)}</td>
                          <td className="px-1.5 py-1 text-center"><Badge bg="secondary" pill className="text-[0.65rem]">{ip.sessionCount || 0}</Badge></td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center">
                          <Spinner size="sm" className="mr-2 align-middle" />
                          <span className="text-ink-2">Loading IP analytics...</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <Alert variant="warning" className="mb-0 mt-2 !border-l-4 !px-2 !py-1 text-[0.7rem]">
              <span className="flex items-center gap-2">
                <TriangleAlert size={14} className="shrink-0 text-[#d97706]" />
                <span>
                  <strong>Security Insight:</strong> User has accessed from {selectedUser?.ipCount} different networks. This pattern often indicates{' '}
                  <span className="font-bold text-[#dc3545]">Account Sharing</span> or VPN usage.
                </span>
              </span>
            </Alert>
          </div>
        )}
      </Modal>

      <UserLocationModal show={showLocationModal} onHide={() => setShowLocationModal(false)} user={selectedUser} />
      <GlobalHeatmapModal show={showHeatmapModal} onHide={() => setShowHeatmapModal(false)} />
    </div>
  );
}
