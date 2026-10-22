/**
 * Every global modal from legacy src/App/Modals/index.js, driven by useAppStore / useAuth.
 * D8: EmailSetupModal and NoticeBoxModal are dead in legacy and are not ported.
 */
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { useChromeStore } from './chromeStore';
import SubscriptionWarningModal from './modals/SubscriptionWarningModal';
import ProfileModal from './modals/ProfileModal';
import ReplyModal from './modals/ReplyModal';
import { ErrorModal, ForgotPasswordModal, IPMisuseModal, RealtimeNotificationModal } from './modals/SmallModals';

export default function GlobalModals({ onAuthPage }: { onAuthPage: boolean }) {
  const { user, warning, modalError, setModalError, ipMisuse, realtimeNotification, setRealtimeNotification } = useAuth();
  const showWarningModal = useAppStore((s) => s.showWarningModal);
  const showProfileModal = useAppStore((s) => s.showProfileModal);
  const showForgotPasswordModal = useAppStore((s) => s.showForgotPasswordModal);
  const showIPWarningModal = useAppStore((s) => s.showIPWarningModal);
  const tourType = useAppStore((s) => s.tourType);
  const set = useAppStore((s) => s.set);
  const replyFor = useChromeStore((s) => s.replyFor);
  const setReplyFor = useChromeStore((s) => s.setReplyFor);

  return (
    <>
      <SubscriptionWarningModal
        show={showWarningModal && !onAuthPage}
        onHide={() => set({ showWarningModal: false, warningDismissed: true })}
        warningContent={warning}
      />
      <ProfileModal show={showProfileModal} onHide={() => set({ showProfileModal: false })} />
      <ErrorModal
        show={!!modalError?.show}
        onHide={() => setModalError({ show: false, title: '', message: '' })}
        errorModal={modalError}
      />
      <ForgotPasswordModal
        show={showForgotPasswordModal}
        onHide={() => set({ showForgotPasswordModal: false })}
        user={user}
        tourType={tourType}
      />
      <IPMisuseModal
        show={showIPWarningModal && !onAuthPage}
        onHide={() => set({ showIPWarningModal: false, ipWarningDismissed: true })}
        ipMisuseData={ipMisuse}
      />
      <RealtimeNotificationModal
        show={!!realtimeNotification}
        onHide={() => setRealtimeNotification(null)}
        realtimeNotification={realtimeNotification}
      />
      {replyFor && <ReplyModal notif={replyFor} onHide={() => setReplyFor(null)} />}
    </>
  );
}
