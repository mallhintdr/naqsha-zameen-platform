/** Port of legacy components/Auth/RegistrationSuccessModal.js (inv-02 §3.2). */
import { CheckCircle2 } from 'lucide-react';
import { Alert, Badge, Modal } from '@/shared/ui';

export default function RegistrationSuccessModal({
  show, onHide, userData, isAdminRegistered = false,
}: { show: boolean; onHide: () => void; userData: any; isAdminRegistered?: boolean }) {
  if (!userData) return null;
  const tehsils: string[] = (userData.tehsilAccess || []).map((t: any) => t.tehsil).filter(Boolean);
  const row = 'flex justify-between gap-2 py-0.5';
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="sm"
      backdrop="static"
      headerVariant="custom"
      headerStyle={{ background: '#0096c7', color: '#fff' }}
      headerClassName="!py-2"
      bodyClassName="!p-3 text-center"
      title={<span className="flex items-center gap-2 text-base"><CheckCircle2 size={17} /> Registration Successful</span>}
    >
      <Alert variant="success" className="mb-3 px-3 py-2 text-left text-[0.85rem]">
        {isAdminRegistered ? (
          <>
            <strong>Registration successful!</strong>
            <br />
            The account is active and credentials are created.
          </>
        ) : (
          <>
            <strong>Dear {userData.userName},</strong>
            <br />
            An activation link has been sent to <strong>{userData.email || 'your email'}</strong>. Please click it to start your trial.
          </>
        )}
      </Alert>
      <div className="mb-3 rounded border border-[#dee2e6] bg-[#f8f9fa] p-2 text-left text-[0.8rem] text-[#6c757d]">
        <div className={row}><span>Name:</span><span className="text-[#212529]">{userData.userName}</span></div>
        <div className={row}><span>User ID:</span><span className="font-bold text-[#0096c7]">{userData.userId}</span></div>
        <div className={row}><span>Subscription:</span><Badge bg="info">{userData.subscriptionType} Plan</Badge></div>
        <div className={row}>
          <span>Tehsil:</span>
          <span className="max-w-[60%] break-words text-right text-[#212529]">{tehsils.length ? tehsils.join(', ') : 'Full System Access'}</span>
        </div>
      </div>
      <p className="mb-3 text-[0.75rem] italic text-[#6c757d]">
        Note: After your trial period ends, please contact the admin for payment and renewal.
      </p>
      <button type="button" className="btn btn-primary btn-sm btn-block min-h-9 font-bold" onClick={onHide}>
        OK
      </button>
    </Modal>
  );
}
