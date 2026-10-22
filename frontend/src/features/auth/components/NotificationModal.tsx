/** The small "Error / Notification" modal used by both registration forms (legacy inline Modal, modern-modal-compact). */
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from '@/shared/ui';

export interface FormMessage {
  type: 'danger' | 'info' | 'success';
  text: string;
}

export default function NotificationModal({ message, onHide }: { message: FormMessage | null; onHide: () => void }) {
  const danger = message?.type === 'danger';
  return (
    <Modal
      show={!!message}
      onHide={onHide}
      size="compact"
      title={
        danger ? (
          <><AlertTriangle size={15} className="text-[#ef4444]" />Error</>
        ) : (
          <><Info size={15} className="text-[#7dd3fc]" />Notification</>
        )
      }
      bodyClassName="text-center"
      footerClassName="!justify-center"
      footer={
        <button type="button" className={`btn btn-sm min-h-9 px-4 ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onHide}>
          Close
        </button>
      }
    >
      <p className={`m-0 text-[0.9rem] font-bold ${danger ? 'text-[#dc3545]' : 'text-[#198754]'}`}>{message?.text}</p>
    </Modal>
  );
}
