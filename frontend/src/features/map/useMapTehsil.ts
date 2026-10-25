import { useMemo } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';

/** Tehsil shown on the map: the browsed one in All Mouzas mode, else the account's active tehsil. */
export function mapTehsilOf(user: any, s: { browseMode: string; browseTehsil: string | null }): string {
  return (s.browseMode === 'all' && s.browseTehsil) || user?.activeTehsil || '';
}

export function useMapTehsil(): string {
  const { user } = useAuth();
  const browseMode = useAppStore((s) => s.browseMode);
  const browseTehsil = useAppStore((s) => s.browseTehsil);
  return mapTehsilOf(user, { browseMode, browseTehsil });
}

/**
 * The user object the map works with: activeTehsil is the map tehsil, and `_preview`
 * marks a preview mouza (isLimitedUser -> tiles only, locked features).
 */
export function useMapUser(): any {
  const { user } = useAuth();
  const tehsil = useMapTehsil();
  const previewActive = useAppStore((s) => s.previewActive);
  return useMemo(() => (user ? { ...user, activeTehsil: tehsil, _preview: previewActive || undefined } : user), [user, tehsil, previewActive]);
}
