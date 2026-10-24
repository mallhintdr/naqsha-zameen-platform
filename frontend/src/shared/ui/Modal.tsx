/**
 * Modal built on Radix Dialog.
 * Legacy parity: dark radial-gradient header (#f8fbff title), white body, #f9fafb footer,
 * sits BELOW the 42px navbar (legacy `.modal { top:42px }`).
 * Sizes map to legacy dialog classes:
 *   compact = .modern-modal-compact (315px), warning = .subscription-warning-dialog (300px),
 *   sm = 360px (.compact-fit-modal), md = 500px, lg = 900px (.modal-lg), salg = min(960px,96vw),
 *   wide = min(1200px,96vw), xl = 95%.
 * On phones (<640px) compact/sm/warning/md render as a bottom sheet (decision D4).
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

export type ModalSize = 'compact' | 'warning' | 'sm' | 'md' | 'lg' | 'salg' | 'wide' | 'xl';

// Widths apply on every screen: on phones a window is centred and only as wide as it needs.
const WIDTH: Record<ModalSize, string> = {
  compact: 'max-w-[315px]',
  warning: 'max-w-[300px]',
  sm: 'max-w-[340px] sm:max-w-[360px]',
  md: 'max-w-[400px] sm:max-w-[500px]',
  lg: 'sm:max-w-[900px]',
  salg: 'sm:max-w-[min(960px,96vw)]',
  wide: 'sm:max-w-[min(1200px,96vw)]',
  xl: 'sm:max-w-[95%]',
};
const SHEET: ModalSize[] = []; // bottom sheets disabled: windows stay compact and centred on phones

export interface ModalProps {
  show: boolean;
  onHide: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** 'static' = clicking the backdrop / Escape does not close */
  backdrop?: 'static' | true;
  closeButton?: boolean;
  /** Header style: chrome (dark radial, default), table (dark teal gradient), custom (pass headerStyle) */
  headerVariant?: 'chrome' | 'table' | 'custom' | 'none';
  headerStyle?: CSSProperties;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  className?: string;
  /** Extra id/class on the content for tours and tests */
  id?: string;
  scrollable?: boolean;
  /** Stack above other modals (nested dialogs) */
  zIndex?: number;
}

export function Modal({
  show, onHide, title, children, footer, size = 'md', backdrop = true, closeButton = true,
  headerVariant = 'chrome', headerStyle, headerClassName, bodyClassName, footerClassName, className, id, scrollable = true, zIndex = 10500,
}: ModalProps) {
  const sheet = SHEET.includes(size);
  const compact = size === 'compact' || size === 'warning';
  return (
    <Dialog.Root open={show} onOpenChange={(o) => !o && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-x-0 bottom-0 top-[42px] bg-black/50 animate-fade-in"
          style={{ zIndex: zIndex - 10 }}
        />
        <Dialog.Content
          id={id}
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            // Guided tours drive modals from their own tooltip: clicks there must not close the modal.
            const t = e.target as Element | null;
            if (backdrop === 'static' || t?.closest?.('.tour-tooltip')) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => backdrop === 'static' && e.preventDefault()}
          style={{ zIndex }}
          className={cn(
            'fixed flex flex-col bg-white outline-none overflow-hidden',
            'shadow-[0_15px_35px_rgba(0,0,0,0.4),0_0_20px_rgba(0,255,255,0.1)] border border-white/10',
            sheet
              ? 'inset-x-0 bottom-0 max-h-[calc(100dvh-52px)] rounded-t-2xl animate-sheet-up pb-[env(safe-area-inset-bottom)] sm:pb-0'
              : 'rounded-xl animate-pop-in',
            // Centred in the area below the 42px navbar without transforms (the open animation
            // uses transform): pinned top and bottom, auto margins, height fits the content.
            'inset-x-0 top-[50px] bottom-2 m-auto h-fit w-[calc(100vw-24px)] max-h-[calc(100dvh-58px)] sm:w-full',
            compact && 'sm:rounded-[10px]',
            WIDTH[size],
            className,
          )}
        >
          {headerVariant !== 'none' && (
            <div
              className={cn(
                'flex items-center justify-between gap-2 shrink-0',
                compact ? 'px-3 py-2' : 'px-3.5 py-1 min-h-[38px]',
                headerVariant === 'chrome' && 'modal-header-chrome',
                headerVariant === 'table' && 'modal-header-table',
                headerClassName,
              )}
              style={headerStyle}
            >
              <Dialog.Title className={cn('m-0 font-semibold tracking-[0.5px] flex items-center gap-2 min-w-0', compact ? 'text-[0.85rem]' : 'text-[0.95rem]', headerVariant !== 'custom' && 'text-[#f8fbff]')}>
                {title}
              </Dialog.Title>
              {closeButton && (
                <Dialog.Close
                  className={cn('rounded p-1 opacity-80 hover:opacity-100 hover:bg-white/10 shrink-0', headerVariant === 'custom' ? 'text-current' : 'text-white')}
                  aria-label="Close"
                >
                  <X size={compact ? 16 : 18} />
                </Dialog.Close>
              )}
            </div>
          )}
          {headerVariant === 'none' && <Dialog.Title className="sr-only">{title}</Dialog.Title>}
          <div className={cn(scrollable && 'overflow-y-auto overscroll-contain', 'min-h-0 flex-1', compact ? 'px-3.5 py-3 text-[0.9rem]' : 'p-4 text-[0.95rem] max-sm:p-2.5', 'text-teal-ink', bodyClassName)}>
            {children}
          </div>
          {footer && (
            <div className={cn('flex flex-wrap items-center justify-end gap-2 shrink-0 border-t border-[#e5e7eb] bg-[#f9fafb]', compact ? 'px-3 py-2' : 'px-3.5 py-2', footerClassName)}>
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
