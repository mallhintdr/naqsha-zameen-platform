// /users/:userId — user detail page (legacy components/User/UserDetail.js). Admin or the user themself.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { UserDetailTabs, ProfileTab, SubscriptionTab, AccessControlTab, ActivityTab, HistoryTab, type TabDef } from './UserDetailTabs';
import { LoginHistoryTab, LocationMapTab, HeatmapTab } from './UserDetailMapTabs';
import './users.css';

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { userType } = useAuth() as any;
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.get(`/api/users/${userId}`)
      .then((r) => alive && setUser(r.data))
      .catch(() => alive && setError('Failed to load user details.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [userId]);

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Spinner /></div>;
  if (error || !user) return <div className="mt-3 px-3"><Alert variant="danger">{error || 'Failed to load user details.'}</Alert></div>;

  const tabs: TabDef[] = [
    { id: 'profile', label: 'Profile', icon: '👤', content: <ProfileTab user={user} /> },
    { id: 'subscription', label: 'Subscription', icon: '💳', content: <SubscriptionTab user={user} /> },
    { id: 'access', label: 'Access Control', icon: '🔐', content: <AccessControlTab user={user} isAdmin={userType === 'admin'} /> },
    { id: 'activity', label: 'Activity', icon: '📊', content: <ActivityTab user={user} /> },
    ...(userType === 'admin' ? [{ id: 'history', label: 'History', icon: '🕘', content: <HistoryTab user={user} /> }] : []),
    { id: 'login-history', label: 'Login History', icon: '🔐', content: <LoginHistoryTab user={user} /> },
    { id: 'location-map', label: 'Location Map', icon: '🗺️', content: <LocationMapTab user={user} /> },
    { id: 'heatmap', label: 'Heatmap', icon: '🔥', content: <HeatmapTab user={user} /> },
  ];

  return (
    <UserDetailTabs
      title={`${user.userName} (${user.userId})`}
      subtitle={`User ID: ${user.userId} • ${user.subscriptionType} Subscription`}
      defaultTab="profile"
      onBack={() => navigate(-1)}
      tabs={tabs}
    />
  );
}
