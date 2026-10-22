/** Shared bits of the compact chrome modals (legacy CompactModal ROW_STYLE / PROFILE_HEADER_STYLE). */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/shared/ui';

export const profileHeader = (tint = 'rgba(45, 152, 255, 0.35)'): CSSProperties => ({
  background: `radial-gradient(circle at 20% 20%, ${tint}, transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 0.9), rgba(18, 26, 54, 0.92))`,
  border: 'none',
});

export const Row = ({ label, children, last, id }: { label: ReactNode; children: ReactNode; last?: boolean; id?: string }) => (
  <div id={id} className={cn('flex items-center justify-between gap-2 py-0.5', !last && 'border-b border-[#f1f3f5]')}>
    <span className="font-medium text-[#6c757d]">{label}</span>
    <span className="min-w-0 break-words text-right text-[#212529]">{children}</span>
  </div>
);

/** Footer / action button (legacy CompactButton look). */
export const ChromeButton = ({
  onClick, children, background, className, disabled, id, type = 'button',
}: { onClick?: () => void; children: ReactNode; background: string; className?: string; disabled?: boolean; id?: string; type?: 'button' | 'submit' }) => (
  <button
    id={id}
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={cn('inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border-none px-1 py-2 text-[0.8rem] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60', className)}
    style={{ background }}
  >
    {children}
  </button>
);
