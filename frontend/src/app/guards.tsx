import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { useAuth, type UserType } from '@/features/auth/AuthProvider';
import { PageSpinner } from '@/shared/ui';

export function ProtectedRoute({ children, role }: { children: ReactNode; role?: UserType }) {
  const { user, loading } = useAuth();
  if (loading && !user) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.userType !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function SelfOrAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { userId } = useParams();
  if (loading && !user) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.userType === 'admin' || user.userId === userId) return <>{children}</>;
  return <Navigate to="/" replace />;
}
