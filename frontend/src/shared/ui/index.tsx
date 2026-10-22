import * as RTabs from '@radix-ui/react-tabs';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export { cn } from './cn';
export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';
export { DialogProvider, useDialog, toast, Toaster, dialogs } from './feedback';

/* ---------------- Button ---------------- */
export type Variant =
  | 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'dark' | 'light' | 'link'
  | 'outline-primary' | 'outline-secondary' | 'outline-success' | 'outline-danger' | 'outline-warning' | 'outline-info' | 'outline-dark';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block', className)}
      {...rest}
    >
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
});

/* ---------------- Spinner ---------------- */
export const Spinner = ({ size, className }: { size?: 'sm'; className?: string }) => (
  <span role="status" aria-label="Loading" className={cn('spinner', size === 'sm' && 'spinner-sm', className)} />
);
export const PageSpinner = ({ label }: { label?: string }) => (
  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-10 text-ink-2">
    <Spinner />
    {label && <span className="text-sm">{label}</span>}
  </div>
);

/* ---------------- Alert ---------------- */
export function Alert({
  variant = 'info', children, onClose, className,
}: { variant?: 'danger' | 'success' | 'info' | 'warning' | 'secondary'; children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('alert', `alert-${variant}`, className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 shrink-0 px-1 text-lg leading-none opacity-60 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export const Badge = ({
  bg = 'secondary', pill, children, className, title, onClick,
}: { bg?: 'success' | 'primary' | 'danger' | 'warning' | 'info' | 'secondary' | 'dark' | 'light'; pill?: boolean; children: ReactNode; className?: string; title?: string; onClick?: () => void }) => (
  <span title={title} onClick={onClick} className={cn('badge', `badge-${bg}`, pill && 'badge-pill', onClick && 'cursor-pointer', className)}>
    {children}
  </span>
);

/* ---------------- Card ---------------- */
export const Card = ({ title, children, className, bodyClassName, headerRight }: { title?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; headerRight?: ReactNode }) => (
  <section className={cn('card', className)}>
    {title && (
      <header className="card-header flex items-center justify-between gap-2">
        <div className="min-w-0">{title}</div>
        {headerRight}
      </header>
    )}
    <div className={cn('card-body', bodyClassName)}>{children}</div>
  </section>
);

/* ---------------- Stat tile ---------------- */
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'purple';
export const StatTile = ({ tone, value, label, onClick, title }: { tone: Tone; value: ReactNode; label: ReactNode; onClick?: () => void; title?: string }) => (
  <div title={title} onClick={onClick} className={cn('stat-tile h-full', `tone-${tone}`, onClick && 'cursor-pointer hover:brightness-[0.97]')}>
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
  </div>
);

/* ---------------- Tabs (compact-tabs pill style) ---------------- */
export interface TabDef { key: string; title: ReactNode; content?: ReactNode; disabled?: boolean }
export function Tabs({
  tabs, value, onChange, className, listClassName, equal, mountOnEnter = true,
}: { tabs: TabDef[]; value: string; onChange: (k: string) => void; className?: string; listClassName?: string; equal?: boolean; mountOnEnter?: boolean }) {
  return (
    <RTabs.Root value={value} onValueChange={onChange} className={className}>
      <RTabs.List className={cn('tabs', equal && 'tabs-equal', listClassName)}>
        {tabs.map((t) => (
          <RTabs.Trigger key={t.key} value={t.key} disabled={t.disabled} className="tab">
            {t.title}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) =>
        t.content === undefined ? null : (
          <RTabs.Content key={t.key} value={t.key} forceMount={mountOnEnter ? undefined : true} className="outline-none data-[state=inactive]:hidden">
            {t.content}
          </RTabs.Content>
        ),
      )}
    </RTabs.Root>
  );
}

/* ---------------- Field wrapper ---------------- */
export const Field = ({ label, children, error, hint, className, htmlFor }: { label?: ReactNode; children: ReactNode; error?: ReactNode; hint?: ReactNode; className?: string; htmlFor?: string }) => (
  <div className={cn('mb-3', className)}>
    {label && <label htmlFor={htmlFor} className="field-label">{label}</label>}
    {children}
    {error && <div className="field-error">{error}</div>}
    {!error && hint && <div className="field-hint">{hint}</div>}
  </div>
);

/* ---------------- Pager ---------------- */
export function Pager({ page, pages, onChange, className }: { page: number; pages: number; onChange: (p: number) => void; className?: string }) {
  if (pages <= 1) return null;
  const btn = 'btn btn-sm btn-outline-primary min-w-[2rem]';
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-1', className)}>
      <button className={btn} disabled={page <= 1} onClick={() => onChange(1)}>«</button>
      <button className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
      <span className="px-2 text-sm text-ink-2">Page {page} of {pages}</span>
      <button className={btn} disabled={page >= pages} onClick={() => onChange(page + 1)}>›</button>
      <button className={btn} disabled={page >= pages} onClick={() => onChange(pages)}>»</button>
    </div>
  );
}

/* ---------------- Empty state ---------------- */
export const Empty = ({ children }: { children: ReactNode }) => <div className="py-6 text-center text-sm italic text-ink-2">{children}</div>;
