/**
 * legacy src/App/Modals/ProfileModal.js (inv-01 §4.2).
 * D7: "Change Password" now opens the same reset flow as the sidebar item (was a dead button).
 * D6: dates dd-mm-yyyy.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CircleUser } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { Modal } from '@/shared/ui';
import { fmtDate } from '@/shared/lib/format';
import { calculateDaysRemaining, calculateEndDate } from '@/shared/lib/userUtils';
import ChangeMouzasModal, { canChangeMouzas } from '@/features/users/ChangeMouzasModal';
import { ChromeButton, profileHeader, Row } from './shared';

const selectCls =
  'h-[34px] w-full rounded border border-[#dee2e6] px-2 py-1 text-[0.8rem] text-[#212529] disabled:bg-[#f8f9fa] bg-white';

export default function ProfileModal({ show, onHide }: { show: boolean; onHide: () => void }) {
  const { user, logout } = useAuth();
  const [selectedTehsil, setSelectedTehsil] = useState('');
  const [showChange, setShowChange] = useState(false);

  useEffect(() => {
    if (show && user) setSelectedTehsil(user.activeTehsil || '');
  }, [show, user]);

  const mouzaList = useMemo(() => {
    if (!selectedTehsil || !Array.isArray(user?.tehsilAccess)) return [];
    return user.tehsilAccess.find((t) => t.tehsil === selectedTehsil)?.mouzas || [];
  }, [selectedTehsil, user]);

  if (!user) return null;
  const u: any = user;
  const tehsilCount = Array.isArray(u.tehsilAccess) ? u.tehsilAccess.length : 0;
  const changeOk = canChangeMouzas(u);

  return (
    <>
      <Modal
        show={show}
        onHide={onHide}
        size="compact"
        className="modern-modal-compact profile-modal"
        headerVariant="custom"
        headerClassName="text-white"
        headerStyle={profileHeader()}
        title={<><CircleUser size={16} /> Profile</>}
        bodyClassName="!px-3 !py-2.5"
        footerClassName="!flex-nowrap"
        footer={
          <>
            <ChromeButton
              background="#6c757d"
              onClick={() => {
                onHide();
                useAppStore.getState().set({ showForgotPasswordModal: true });
              }}
            >
              🔑 Change Password
            </ChromeButton>
            <ChromeButton background="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" onClick={() => logout()}>
              Logout
            </ChromeButton>
          </>
        }
      >
        <div className="flex flex-col gap-1.5 text-[0.8rem]">
          <Row label="Name"><span className="font-semibold">{u.userName}</span></Row>
          <Row label="User ID">
            <code className="rounded-[3px] border border-[#e9ecef] bg-[#f8f9fa] px-1 py-px text-[0.75rem] text-[#495057]">{u.userId}</code>
          </Row>
          <Row label="Email">{u.email || 'Not Set'}</Row>
          <Row label="Mobile">{u.mobileNumber}</Row>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6c757d]">Tehsils</span>
              <span className="badge badge-primary badge-pill !px-1.5 !py-[3px] !text-[0.7rem]">{tehsilCount}</span>
            </div>
            <select className={selectCls} value={selectedTehsil} onChange={(e) => setSelectedTehsil(e.target.value)}>
              <option value="">-- Select Tehsil --</option>
              {(u.tehsilAccess || []).map((t: any, i: number) => (
                <option key={i} value={t.tehsil}>{t.tehsil}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6c757d]">Mouzas</span>
              <span className="badge badge-success badge-pill !px-1.5 !py-[3px] !text-[0.7rem]">{mouzaList.length}</span>
            </div>
            <select className={selectCls} disabled={!selectedTehsil} defaultValue="">
              <option value="">{selectedTehsil ? '-- Select Mouza --' : '-- Select Tehsil First --'}</option>
              {mouzaList.map((m: string, i: number) => (
                <option key={i} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <Row label="Plan">
            <span className="rounded px-1.5 py-[3px] text-[0.7rem] font-semibold text-white" style={{ background: '#5bc0de' }}>{u.subscriptionType}</span>
          </Row>
          <Row label="Start Date"><span className="text-[#2c3e50]">{fmtDate(u.startDate)}</span></Row>
          <Row label="Expires"><span className="text-[#2c3e50]">{fmtDate(calculateEndDate(u.startDate, u.subscriptionType))}</span></Row>
          <Row label="Remaining" last>
            <span className="rounded-[15px] px-2 py-1 text-[0.7rem] font-semibold text-white" style={{ background: '#28a745' }}>
              {calculateDaysRemaining(u.startDate, u.subscriptionType)} days
            </span>
          </Row>

          {u.userType === 'user' && (
            <ChromeButton
              className="mt-1 !flex-none !py-1.5"
              background="radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.45), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 1), rgba(18, 26, 54, 1))"
              disabled={!changeOk}
              onClick={() => {
                onHide();
                setShowChange(true);
              }}
            >
              <span title={changeOk ? '' : 'Available while your subscription is active. Please renew first.'} className="inline-flex items-center gap-1">
                <ArrowLeftRight size={13} /> {changeOk ? 'Request Mouza Change' : 'Mouza Change (renew first)'}
              </span>
            </ChromeButton>
          )}
        </div>
      </Modal>
      {u.userType === 'user' && <ChangeMouzasModal show={showChange} onHide={() => setShowChange(false)} user={u} />}
    </>
  );
}
