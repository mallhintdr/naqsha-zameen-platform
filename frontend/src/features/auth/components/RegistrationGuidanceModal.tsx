/** Port of legacy components/Auth/RegistrationGuidanceModal.js (inv-02 §3.1). */
import { AlertCircle, AlertTriangle, Info, KeyRound, LogIn, WandSparkles } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Modal } from '@/shared/ui';

export interface GuidanceData {
  type?: string;
  title?: string;
  message?: string;
  details?: string[];
  fieldToFocus?: string | null;
}

const getTheme = (type: string) => {
  switch (type) {
    case 'DEVICE_EXISTS':
    case 'EMAIL_EXISTS':
    case 'USERID_EXISTS':
    case 'DISPOSABLE_EMAIL':
      return { Icon: AlertCircle, headerBg: 'linear-gradient(135deg, #c0392b 0%, #8e44ad 100%)', borderColor: '#e74c3c' };
    case 'PASSWORD_MISMATCH':
    case 'PASSWORD_INVALID':
    case 'USERID_INVALID':
    case 'MISSING_FIELDS':
    case 'MOUZA_REQUIRED':
      return { Icon: AlertTriangle, headerBg: 'linear-gradient(135deg, #d35400 0%, #f39c12 100%)', borderColor: '#e67e22' };
    default:
      return { Icon: Info, headerBg: 'linear-gradient(135deg, #16a085 0%, #2980b9 100%)', borderColor: '#2980b9' };
  }
};

export default function RegistrationGuidanceModal({
  show, onHide, guidanceData, onSuggestUserId, onFocusField,
}: {
  show: boolean;
  onHide: () => void;
  guidanceData: GuidanceData | null;
  onSuggestUserId?: () => void;
  onFocusField?: (field: string) => void;
}) {
  const navigate = useNavigate();
  if (!guidanceData) return null;
  const { type = 'GENERIC', title = 'Registration Notice', message = '', details = [], fieldToFocus = null } = guidanceData;
  const { Icon, headerBg, borderColor } = getTheme(type);

  const handleAction = () => {
    onHide();
    if (fieldToFocus && onFocusField) setTimeout(() => onFocusField(fieldToFocus), 150);
  };
  const handleSuggest = () => {
    onHide();
    if (onSuggestUserId) setTimeout(() => onSuggestUserId(), 150);
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="compact"
      backdrop="static"
      headerVariant="custom"
      headerStyle={{ background: headerBg, color: '#fff', padding: '8px 14px' }}
      bodyClassName="!p-3.5 bg-[#fcfcfd]"
      title={
        <span className="flex items-center gap-2 text-[0.92rem] font-bold">
          <Icon size={17} className="shrink-0" />
          {title}
        </span>
      }
    >
      <div
        className="mb-2.5 rounded-lg bg-white px-3 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
        style={{ borderLeft: `4px solid ${borderColor}` }}
      >
        <p className="m-0 text-[0.84rem] font-medium leading-[1.45] text-[#2c3e50]">{message}</p>
      </div>
      {details.length > 0 && (
        <div className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5">
          <div className="mb-1.5 text-[0.78rem] font-bold uppercase tracking-[0.5px] text-[#4a5568]">How to resolve:</div>
          <ul className="m-0 list-disc pl-[18px] text-[0.8rem] leading-[1.5] text-[#4a5568]">
            {details.map((d, i) => (
              <li key={i} className="mb-[3px]">{d}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        {(type === 'USERID_EXISTS' || type === 'USERID_INVALID') && (
          <button
            type="button"
            onClick={handleSuggest}
            className="btn btn-sm min-h-9 text-[0.82rem] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)', borderColor: '#d35400' }}
          >
            <WandSparkles size={14} /> Generate Suggested User ID
          </button>
        )}
        {(type === 'DEVICE_EXISTS' || type === 'EMAIL_EXISTS') && (
          <button
            type="button"
            onClick={() => { onHide(); navigate('/login'); }}
            className="btn btn-sm min-h-9 border-0 font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #2980b9 0%, #3498db 100%)' }}
          >
            <LogIn size={14} /> Go to Login Page
          </button>
        )}
        {type === 'EMAIL_EXISTS' && (
          <button
            type="button"
            onClick={() => { onHide(); navigate('/login', { state: { openForgotPassword: true } }); }}
            className="btn btn-sm btn-outline-secondary min-h-9 text-[0.78rem] font-semibold"
          >
            <KeyRound size={13} /> Forgot Password?
          </button>
        )}
        <button
          type="button"
          onClick={handleAction}
          className="btn btn-sm min-h-9 border-0 p-1.5 text-[0.82rem] font-semibold text-white"
          style={{ background: '#2c3e50' }}
        >
          {fieldToFocus ? 'Fix Now' : 'Got It'}
        </button>
      </div>
    </Modal>
  );
}
