/**
 * Session state: profile hydration, login/logout/login-as/switch, CSRF reset,
 * 12 s notification poll + focus refetch, Socket.io `notification` events,
 * 60 s heartbeat with device fingerprint, web-push setup, full app-data wipe.
 * Port of legacy src/context/AuthContext.js — same storage keys and behaviour.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { io, type Socket } from 'socket.io-client';
import { api, resetCsrfToken } from '@/shared/api/client';
import { socketOrigin } from '@/shared/api/base';
import { getDevicePayload } from '@/shared/lib/device';
import { setupPush, disablePushForThisAccount } from '@/shared/lib/push';

export type UserType = 'admin' | 'subadmin' | 'user' | 'demo';
export interface User {
  userId: string;
  userName?: string;
  userType: UserType;
  status?: string;
  subscriptionType?: string;
  startDate?: string;
  endDate?: string;
  daysRemaining?: number;
  tehsilAccess: { tehsil: string; mouzas: string[]; tempGrants?: any[] }[];
  activeTehsil: string;
  mauzaList: string[];
  activeMauzas: string[];
  ipMisuse?: any;
  provider?: any;
  [k: string]: any;
}
export interface AppNotification {
  id: string;
  _id?: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: { label: string; url: string; kind?: string; ref?: string };
  actionDone?: boolean;
  /** What answered the request, e.g. { label: 'Renewed', at, plan }. */
  outcome?: { label: string; at: string; plan?: string };
  replyTo?: string;
  /** When the admin / sub-admin replied to the customer from this notification. */
  repliedAt?: string;
  details?: any;
}
export interface ModalError {
  show: boolean;
  title: string;
  message: string;
}

const EXPIRING_SOON_THRESHOLD_DAYS = 5;

export const buildSubscriptionWarning = (u: any) => {
  if (!u || u.userType === 'admin') return null;
  const startDate = u.startDate ? new Date(u.startDate).toLocaleDateString('en-GB') : '';
  if (u.status === 'Pending' || u.status === 'Expired') {
    return {
      type: 'payment' as const,
      title: u.status === 'Pending' ? 'Account Pending Activation' : 'Subscription Expired',
      message:
        u.status === 'Pending'
          ? 'Your account is pending activation. To activate your services, please complete the payment process below.'
          : 'Your subscription to Geo Map has ended. To continue accessing mouza data and map features, please renew your subscription.',
      userName: u.userName,
      startDate,
      status: u.status,
    };
  }
  const daysRemaining = Number(u.daysRemaining);
  if (u.subscriptionType !== 'Permanent' && Number.isFinite(daysRemaining) && daysRemaining > 0 && daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS) {
    const dayWord = daysRemaining === 1 ? 'day' : 'days';
    return {
      type: 'expiring-soon' as const,
      title: 'Subscription Expiring Soon',
      message: `Your subscription will expire in ${daysRemaining} ${dayWord}. Please renew now to keep uninterrupted access to mouza data and map features.`,
      userName: u.userName,
      startDate,
      endDate: u.endDate ? new Date(u.endDate).toLocaleDateString('en-GB') : '',
      daysRemaining,
      status: u.status,
    };
  }
  return null;
};
export type SubscriptionWarning = ReturnType<typeof buildSubscriptionWarning>;

export const normalizeUserData = (userData: any): User | null => {
  if (!userData) return null;
  const tehsilAccess = Array.isArray(userData.tehsilAccess)
    ? userData.tehsilAccess
        .map((e: any) => ({
          ...e,
          tehsil: typeof e?.tehsil === 'string' ? e.tehsil : '',
          mouzas: Array.isArray(e?.mouzas) ? e.mouzas : [],
        }))
        .filter((e: any) => e.tehsil)
    : [];
  const activeTehsil = (typeof userData.activeTehsil === 'string' && userData.activeTehsil) || tehsilAccess[0]?.tehsil || '';
  const activeEntry = tehsilAccess.find((e: any) => e.tehsil === activeTehsil) || { mouzas: [] };
  const mauzaList = Array.isArray(userData.mauzaList) ? userData.mauzaList : activeEntry.mouzas;
  return { ...userData, tehsilAccess, activeTehsil, mauzaList, activeMauzas: activeEntry.mouzas };
};

const onResetPasswordPage = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/reset-password');
const readCachedUser = (): any => {
  try {
    if (onResetPasswordPage()) {
      sessionStorage.removeItem('user');
      return null;
    }
    return JSON.parse(sessionStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

interface AuthValue {
  user: User | null;
  userType?: UserType;
  loading: boolean;
  error: string | null;
  modalError: ModalError;
  setModalError: (m: ModalError) => void;
  warning: SubscriptionWarning;
  setWarning: (w: SubscriptionWarning) => void;
  needsEmail: boolean;
  setNeedsEmail: (b: boolean) => void;
  ipMisuse: any;
  setIpMisuse: (v: any) => void;
  notifications: AppNotification[];
  realtimeNotification: AppNotification | null;
  setRealtimeNotification: (n: AppNotification | null) => void;
  unreadNotificationsCount: number;
  login: (c: { userId: string; password: string; otp?: string }) => Promise<{ needsOTP?: boolean; message?: string; success?: boolean }>;
  logout: () => Promise<void>;
  switchAccount: () => Promise<void>;
  loginAs: (userId: string) => Promise<void>;
  clearAppData: () => Promise<void>;
  setActiveTehsil: (t: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  fetchUserProfile: () => Promise<User | null>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markNotificationReplied: (id: string) => void;
  markAllNotificationsAsRead: () => Promise<void>;
  clearNotifications: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<ModalError>({ show: false, title: '', message: '' });
  const [warning, setWarning] = useState<SubscriptionWarning>(() => buildSubscriptionWarning(readCachedUser()));
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [realtimeNotification, setRealtimeNotification] = useState<AppNotification | null>(null);
  const [ipMisuse, setIpMisuse] = useState<any>(() => readCachedUser()?.ipMisuse || null);
  const [needsEmail, setNeedsEmail] = useState(false); // email prompt disabled (legacy)
  const socketRef = useRef<Socket | null>(null);
  const fetchProfileRef = useRef<() => Promise<any>>(null as any);

  // Clear any client-set (non-httpOnly) duplicate authToken cookies on boot.
  useEffect(() => {
    const exp = 'expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = `authToken=; ${exp}`;
    document.cookie = `authToken=; ${exp} domain=${window.location.hostname};`;
    const parts = window.location.hostname.split('.');
    if (parts.length >= 2) document.cookie = `authToken=; ${exp} domain=.${parts.slice(-2).join('.')};`;
  }, []);

  useEffect(() => {
    if (user?.userId) setupPush().catch(() => {});
  }, [user?.userId]);

  const fetchUserProfile = useCallback(async () => {
    try {
      setLoading(true);
      const [profileRes, notifRes] = await Promise.all([
        api.get('/api/profile'),
        api.get('/api/notifications').catch(() => ({ data: { notifications: [] } })),
      ]);
      const userData = normalizeUserData(profileRes.data)!;
      setNotifications(notifRes.data?.notifications || []);
      setWarning(buildSubscriptionWarning(userData));
      sessionStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      setIpMisuse(userData.ipMisuse || null);
      setNeedsEmail(false);
      return userData;
    } catch (e) {
      setUser(null);
      sessionStorage.removeItem('user');
      setWarning(null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  fetchProfileRef.current = fetchUserProfile;

  useEffect(() => {
    if (onResetPasswordPage()) {
      setLoading(false);
      return;
    }
    fetchUserProfile().catch(() => {});
  }, [fetchUserProfile]);

  // Notifications: poll + focus refetch + socket
  const userId = user?.userId;
  useEffect(() => {
    if (!userId) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setNotifications([]);
      return;
    }
    // New notifications arrive instantly over the socket. Polling is only a safety net:
    //  - small poll (?since=newest): every 5 min while the socket is connected, every 60 s if not
    //  - full list (read marks / done actions from other devices): at start, when the app comes
    //    back to the foreground (at most once a minute), and every 15 min
    let newest = '';
    let lastFull = 0;
    const markNewest = (list: any[]) => {
      for (const n of list) if (n?.timestamp && String(n.timestamp) > newest) newest = String(n.timestamp);
    };
    const fetchNotifications = async () => {
      try {
        lastFull = Date.now();
        const { data } = await api.get('/api/notifications');
        if (!Array.isArray(data?.notifications)) return;
        markNewest(data.notifications);
        setNotifications((prev) => {
          const ids = new Set(prev.map((n) => n.id || n._id));
          const hasNew = data.notifications.some((n: any) => !ids.has(n.id || n._id));
          const stateKey = (l: any[]) => l.map((n) => `${n.id || n._id}:${n.actionDone ? 1 : 0}:${n.read ? 1 : 0}:${n.repliedAt || ''}`).join(',');
          if (!hasNew && prev.length === data.notifications.length && stateKey(prev) === stateKey(data.notifications)) return prev;
          return data.notifications;
        });
      } catch {}
    };
    const fetchNewer = async () => {
      if (!newest) return fetchNotifications();
      try {
        const { data } = await api.get('/api/notifications', { params: { since: newest } });
        const fresh = Array.isArray(data?.notifications) ? data.notifications : [];
        if (!fresh.length) return;
        markNewest(fresh);
        setNotifications((prev) => {
          const ids = new Set(prev.map((n) => n.id || n._id));
          const add = fresh.filter((n: any) => !ids.has(n.id || n._id));
          return add.length ? [...add, ...prev].slice(0, 60) : prev;
        });
      } catch {}
    };
    fetchNotifications();
    let ticks = 0;
    const poll = setInterval(() => {
      ticks += 1;
      if (Date.now() - lastFull > 15 * 60e3) { fetchNotifications(); return; }
      const connected = !!socketRef.current?.connected;
      if (!connected || ticks % 5 === 0) fetchNewer(); // 60 s offline, 5 min online
    }, 60000);
    const onForeground = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFull > 60e3) fetchNotifications();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);

    socketRef.current?.disconnect();
    const origin = socketOrigin();
    const opts = { withCredentials: true, transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 2000, timeout: 10000 };
    const socket = origin ? io(origin, opts) : io(opts);
    socketRef.current = socket;

    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});

    socket.on('notification', (n: AppNotification) => {
      markNewest([n]);
      setNotifications((prev) => {
        const id = n.id || n._id;
        if (id && prev.some((p) => (p.id || p._id) === id)) return prev;
        return [n, ...prev];
      });
      if ('Notification' in window && Notification.permission === 'granted' && !window.__pushEnabled) {
        try {
          const title = n.title || 'System Notification';
          const options: NotificationOptions = { body: n.message || '', icon: '/logo192.png', badge: '/badge-96.png', tag: n.id || 'geo-dashboard-notif' };
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(() => new Notification(title, options));
          } else new Notification(title, options);
        } catch {}
      }
      const refresh = ['subscription', 'activation', 'profile'].includes(n.type) || n.title?.toLowerCase().includes('subscription');
      if (refresh) {
        setRealtimeNotification(n);
        fetchProfileRef.current?.().catch(() => {});
      }
    });

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [userId]);

  // Heartbeat every 60 s
  useEffect(() => {
    if (!userId) return;
    const send = () => { if (document.visibilityState !== 'hidden') api.post('/api/heartbeat', getDevicePayload()).catch(() => {}); };
    send();
    const id = setInterval(send, 60000);
    return () => clearInterval(id);
  }, [userId]);

  const resetLocalSession = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    sessionStorage.removeItem('user');
    setUser(null);
    setWarning(null);
    setIpMisuse(null);
    setNotifications([]);
    setNeedsEmail(false);
    resetCsrfToken();
  }, []);

  const switchAccount = useCallback(async () => {
    try {
      await api.post('/api/logout', { clearAll: true });
    } catch {
    } finally {
      resetLocalSession();
    }
  }, [resetLocalSession]);

  const login = useCallback<AuthValue['login']>(
    async (credentials) => {
      try {
        setLoading(true);
        if (user && credentials?.userId && String(user.userId).toLowerCase() !== String(credentials.userId).toLowerCase()) {
          await switchAccount();
        }
        const res = await api.post('/api/login', { ...credentials, ...getDevicePayload() });
        if (res.data?.needsOTP) {
          setLoading(false);
          return { needsOTP: true, message: res.data.message };
        }
        resetCsrfToken();
        const profile = await fetchUserProfile();
        if (!profile) throw new Error('Could not retrieve user session after login.');
        setLoading(false);
        navigate('/');
        return { success: true };
      } catch (e: any) {
        setLoading(false);
        if (e.response?.status === 429) {
          setModalError({ show: true, title: 'Too Many Requests', message: e.response.data?.message || 'Please wait a while before trying again.' });
        } else if (e.response?.status === 401) {
          setError('User ID or Password is incorrect. Please try again.');
        } else {
          setError(e.response?.data?.message || e.message || 'Login failed. Please check your credentials.');
        }
        throw e;
      }
    },
    [user, switchAccount, fetchUserProfile, navigate],
  );

  const logout = useCallback(async () => {
    await disablePushForThisAccount();
    // Map tile pieces cached on this device belong to this account.
    import('@/features/map/core/tileCache').then((m) => m.clearTileCache()).catch(() => {});
    try {
      const res = await api.post('/api/logout', {});
      if (res.data?.adminRestored) {
        resetCsrfToken();
        await fetchUserProfile().catch(() => {});
        navigate('/');
        return;
      }
    } catch {}
    setUser(null);
    sessionStorage.removeItem('user');
    setWarning(null);
    setIpMisuse(null);
    setNeedsEmail(false);
    resetCsrfToken();
    navigate('/login');
  }, [fetchUserProfile, navigate]);

  const loginAs = useCallback(
    async (targetId: string) => {
      try {
        setLoading(true);
        await api.post(`/api/admin/login-as/${encodeURIComponent(targetId)}`, {});
        sessionStorage.removeItem('user');
        setUser(null);
        setWarning(null);
        setIpMisuse(null);
        setNotifications([]);
        resetCsrfToken();
        await fetchUserProfile();
        navigate('/');
      } catch (e: any) {
        setModalError({
          show: true,
          title: 'Login As Failed',
          message: e.response?.data?.message || e.response?.data?.error || 'Failed to switch to user. Please check if user is active.',
        });
        await fetchUserProfile().catch(() => {});
      } finally {
        setLoading(false);
      }
    },
    [fetchUserProfile, navigate],
  );

  const setActiveTehsil = useCallback(
    async (tehsil: string) => {
      if (!user?.userId || !tehsil) return;
      const { data } = await api.post(`/api/users/${encodeURIComponent(user.userId)}/active-tehsil`, { tehsil });
      if (data?.user) {
        const n = normalizeUserData(data.user)!;
        sessionStorage.setItem('user', JSON.stringify(n));
        setUser(n);
      } else await fetchUserProfile();
    },
    [user?.userId, fetchUserProfile],
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      try {
        await api.post('/api/change-password', { userId: user?.userId, oldPassword, newPassword });
        await logout();
        setError(null);
      } catch {
        setError('Failed to change password. Please try again.');
        throw new Error('Failed to change password.');
      }
    },
    [user?.userId, logout],
  );

  const clearAppData = useCallback(async () => {
    await api.post('/api/logout', { clearAll: true }).catch(() => {});
    try {
      const host = window.location.hostname;
      const hp = host.split('.');
      const domains = ['', host, '.' + host, hp.length >= 2 ? '.' + hp.slice(-2).join('.') : '', '.naqsha-zameen.com', '.naqsha-zameen.pk'].filter(Boolean);
      for (const c of document.cookie.split(';')) {
        const name = c.split('=')[0].trim();
        if (!name) continue;
        for (const d of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${d}`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    } catch {}
    try {
      sessionStorage.clear();
      const keep = localStorage.getItem('geo_device_id');
      localStorage.clear();
      if (keep) localStorage.setItem('geo_device_id', keep);
    } catch {}
    try {
      if (window.indexedDB) {
        if (typeof (indexedDB as any).databases === 'function') {
          const dbs = await (indexedDB as any).databases().catch(() => []);
          for (const db of dbs || []) if (db.name) indexedDB.deleteDatabase(db.name);
        } else indexedDB.deleteDatabase('tiles');
      }
    } catch {}
    try {
      if ('caches' in window) {
        const keys = await caches.keys().catch(() => []);
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    resetLocalSession();
    window.location.href = '/login';
  }, [resetLocalSession]);

  const markNotificationAsRead = useCallback(async (id: string) => {
    try {
      await api.post(`/api/notifications/${id}/read`, {});
      setNotifications((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {}
  }, []);
  const markNotificationReplied = useCallback((id: string) => {
    const at = new Date().toISOString();
    setNotifications((p) => p.map((n) => ((n.id || n._id) === id ? { ...n, read: true, repliedAt: at } : n)));
  }, []);
  const markAllNotificationsAsRead = useCallback(async () => {
    try {
      await api.post('/api/notifications/read-all', {});
      setNotifications((p) => p.map((n) => ({ ...n, read: true })));
    } catch {}
  }, []);
  const clearNotifications = useCallback(async () => {
    try {
      await api.delete('/api/notifications');
      setNotifications([]);
    } catch {}
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      userType: user?.userType,
      loading,
      error,
      modalError,
      setModalError,
      warning,
      setWarning,
      needsEmail,
      setNeedsEmail,
      ipMisuse,
      setIpMisuse,
      notifications,
      realtimeNotification,
      setRealtimeNotification,
      unreadNotificationsCount: notifications.filter((n) => !n.read).length,
      login,
      logout,
      switchAccount,
      loginAs,
      clearAppData,
      setActiveTehsil,
      changePassword,
      fetchUserProfile,
      markNotificationAsRead,
      markNotificationReplied,
      markAllNotificationsAsRead,
      clearNotifications,
    }),
    [user, loading, error, modalError, warning, needsEmail, ipMisuse, notifications, realtimeNotification, login, logout, switchAccount, loginAs, clearAppData, setActiveTehsil, changePassword, fetchUserProfile, markNotificationAsRead, markNotificationReplied, markAllNotificationsAsRead, clearNotifications],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
