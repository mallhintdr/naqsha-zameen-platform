/** legacy ErrorModal, ForgotPasswordModal, IPMisuseModal, RealtimeNotificationModal (inv-01 §4.3/4.4/4.6/4.8). */
import { useState, type FormEvent } from 'react';
import { Bell, ChevronDown, ChevronUp, CircleCheck, KeyRound, ShieldAlert } from 'lucide-react';
import { Modal, Spinner } from '@/shared/ui';
import { api } from '@/shared/api/client';
import { ChromeButton, profileHeader } from './shared';
import WaText from '../WaText';

/* ---------------- ErrorModal ---------------- */
export function ErrorModal({ show, onHide, errorModal }: { show: boolean; onHide: () => void; errorModal: any }) {
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="compact"
      className="modern-modal-compact"
      headerVariant="custom"
      headerClassName="text-white"
      headerStyle={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}
      title={<>❌ {errorModal?.title || 'Error'}</>}
      footer={
        <ChromeButton background="linear-gradient(135deg, #667eea 0%, #764ba2 100%)" className="!w-full !px-5 !text-[0.9rem]" onClick={onHide}>
          OK
        </ChromeButton>
      }
    >
      <div role="alert" className="whitespace-pre-line rounded-md border border-[#dc3545] bg-[#ffe6e8] p-3 text-[0.85rem] text-[#721c24]">
        {errorModal?.message || 'An unexpected error occurred.'}
      </div>
    </Modal>
  );
}

/* ---------------- ForgotPasswordModal ("Reset Password") ---------------- */
export function ForgotPasswordModal({ show, onHide, user, tourType }: { show: boolean; onHide: () => void; user: any; tourType?: string }) {
  const [msg, setMsg] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [userIdInput, setUserIdInput] = useState('');

  const close = () => {
    onHide();
    setMsg(null);
    setUserIdInput('');
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    if (tourType === 'changePassword') {
      setTimeout(() => {
        setMsg({ type: 'success', text: '📧 [TUTORIAL] A password reset link has been simulated and sent to your registered email address.' });
        setLoading(false);
      }, 1000);
      return;
    }
    const targetUserId = user?.userId || userIdInput.trim();
    if (!targetUserId) {
      setMsg({ type: 'danger', text: 'User ID is required.' });
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.post('/forgot-password', { userId: targetUserId });
      const email = data?.email || '';
      setMsg({
        type: 'success',
        text: email ? `A reset link has been sent to your registered email: ${email}` : 'A reset link has been sent to your registered email address.',
      });
    } catch (err: any) {
      setMsg({ type: 'danger', text: err?.response?.data?.message || 'Failed to send reset email. Please try again later.' });
    }
    setLoading(false);
  };

  return (
    <Modal
      show={show}
      onHide={close}
      size="warning"
      className="modern-modal-compact forgot-password-modal-dialog"
      headerVariant="custom"
      headerClassName="text-white !py-2"
      headerStyle={{ background: '#0d6efd' }}
      title={<><KeyRound size={15} /> Reset Password</>}
      bodyClassName="!p-3"
    >
      {msg && (
        <div role="alert" className={`alert alert-${msg.type} mb-3 !px-3 !py-2 !text-[0.85rem]`}>
          {msg.text}
        </div>
      )}
      <form onSubmit={handleForgot}>
        {!msg && (
          <>
            {!user?.userId && (
              <div className="mb-3">
                <input
                  type="text"
                  className="input input-sm"
                  placeholder="Enter User ID"
                  required
                  name="userIdInput"
                  id="userIdInput"
                  value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value)}
                />
              </div>
            )}
            <div className="mb-3 rounded border border-[#dee2e6] bg-[#f8f9fa] p-2 text-center">
              <p className="m-0 text-[0.8rem] text-[#6c757d]">A reset link will be sent to your registered email address.</p>
            </div>
          </>
        )}
        {msg?.type === 'success' ? (
          <button type="button" className="btn btn-primary btn-sm btn-block min-h-[36px] font-bold" onClick={close}>
            OK
          </button>
        ) : (
          <button id="reset-password-submit-btn" type="submit" className="btn btn-primary btn-sm btn-block min-h-[36px] font-bold" disabled={loading}>
            {loading ? (
              <>
                <Spinner size="sm" className="text-white" /> Sending...
              </>
            ) : (
              '📧 Send Reset Link'
            )}
          </button>
        )}
      </form>
    </Modal>
  );
}

/* ---------------- IPMisuseModal ---------------- */
export function IPMisuseModal({ show, onHide, ipMisuseData }: { show: boolean; onHide: () => void; ipMisuseData: any }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="compact"
      className="modern-modal-compact"
      headerVariant="custom"
      headerClassName="text-white"
      headerStyle={profileHeader('rgba(220, 53, 69, 0.35)')}
      title={<><ShieldAlert size={15} className="text-[#dc3545]" /> Multi-Device Access Detected</>}
      bodyClassName="!px-3 !py-2.5"
      footer={
        <ChromeButton id="multi-device-comply-btn" background="linear-gradient(135deg, #28a745 0%, #20c997 100%)" className="!w-full !p-2 !text-[0.85rem]" onClick={onHide}>
          I Understand &amp; Will Comply
        </ChromeButton>
      }
    >
      <div className="flex flex-col gap-2 text-[0.8rem]">
        <div id="multi-device-warning-banner" className="rounded-lg border border-[#feb2b2] bg-[#fff5f5] p-2.5">
          <p className="m-0 text-center text-[0.75rem] font-semibold leading-[1.4] text-[#c53030]">
            Your account is being accessed from multiple locations. Sharing accounts is strictly prohibited and may lead to a permanent ban.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div id="multi-device-ip30-row" className="flex items-center justify-between border-b border-[#f1f3f5] py-1">
            <span className="font-medium text-[#6c757d]">Devices (Last 30 Days)</span>
            <span className="badge badge-danger badge-pill !px-2 !py-1 !text-[0.75rem]">{ipMisuseData?.count30 || 0} devices</span>
          </div>
          <div id="multi-device-ip7-row" className="flex items-center justify-between border-b border-[#f1f3f5] py-1">
            <span className="font-medium text-[#6c757d]">Devices (Last 7 Days)</span>
            <span className="badge badge-warning badge-pill !px-2 !py-1 !text-[0.75rem]">{ipMisuseData?.count7 || 0} devices</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1 self-start p-0 text-left text-[0.7rem] font-semibold text-[#4a5568]"
        >
          {showDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {showDetails ? 'Hide Details' : 'View Devices Used'}
        </button>
        {showDetails && (
          <div className="max-h-[120px] overflow-y-auto rounded-md border border-[#e2e8f0] bg-[#f8f9fa] p-2 text-[0.7rem]">
            <div className="mb-1 border-b border-[#e2e8f0] font-bold text-[#4a5568]">Devices (30 Days):</div>
            <ul className="m-0 list-disc pl-[15px]">
              {(ipMisuseData?.ips30 || []).map((ip: string, i: number) => (
                <li key={i} className="font-mono text-[#2d3748]">{ip}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-1 text-center text-[0.65rem] italic text-[#718096]">* Unusual activity is being monitored by our security team.</div>
      </div>
    </Modal>
  );
}

/* ---------------- RealtimeNotificationModal ---------------- */
export function RealtimeNotificationModal({ show, onHide, realtimeNotification }: { show: boolean; onHide: () => void; realtimeNotification: any }) {
  const grad = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="compact"
      className="modern-modal-compact"
      headerVariant="custom"
      headerClassName="text-white"
      headerStyle={{ background: grad }}
      title={<><Bell size={15} /> {realtimeNotification?.title || 'Notification'}</>}
      bodyClassName="!p-[15px] text-center"
      footer={
        <ChromeButton background={grad} className="!w-full !p-2 !text-[0.85rem]" onClick={onHide}>
          Great!
        </ChromeButton>
      }
    >
      <div className="mb-3 flex justify-center text-[#38ef7d]">
        <CircleCheck size={48} />
      </div>
      <h6 className="font-normal text-[#2c3e50]" style={{ whiteSpace: 'pre-wrap' }}><WaText text={realtimeNotification?.message || 'Your account has been updated successfully.'} /></h6>
      <p className="mt-2 text-[0.75rem] text-[#6c757d]">Changes take effect immediately.</p>
    </Modal>
  );
}
