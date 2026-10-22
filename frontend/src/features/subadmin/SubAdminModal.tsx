// Legacy SubAdminModal.js: AppModal (unified-modal for lg/xl, compact otherwise). useDialog() is the shared one.
import type { ReactNode } from 'react';
import { Modal } from '@/shared/ui';

export { useDialog } from '@/shared/ui';

export default function AppModal({
  show = true, onHide, title, size, footer, children, bodyClassName, scrollable = true,
}: { show?: boolean; onHide: () => void; title?: ReactNode; size?: 'sm' | 'lg' | 'xl'; footer?: ReactNode; children?: ReactNode; bodyClassName?: string; scrollable?: boolean }) {
  const mapped = size === 'xl' ? 'wide' : size === 'lg' ? 'salg' : 'compact';
  return (
    <Modal show={show} onHide={onHide} title={title} size={mapped} footer={footer} bodyClassName={bodyClassName} scrollable={scrollable}>
      {children}
    </Modal>
  );
}
