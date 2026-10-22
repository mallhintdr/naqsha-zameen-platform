/** Port of legacy components/Auth/ResetPassword.js (inv-02 §5). Route: /reset-password?token= */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Modal, Spinner } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';

const clearClientCookies = () => {
  const parts = window.location.hostname.split('.');
  const parent = parts.length >= 2 ? '.' + parts.slice(-2).join('.') : '';
  ['authToken', 'adminAuthToken', 'x-csrf-token'].forEach((name) => {
    const exp = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = exp;
    document.cookie = `${exp} domain=${window.location.hostname};`;
    if (parent) document.cookie = `${exp} domain=${parent};`;
  });
};

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'danger' | 'success'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const resetUserIdRef = useRef('');
  const navigate = useNavigate();
  const { switchAccount } = useAuth();
  const loggedOut = useRef(false);

  // Opening the link logs out every session on this device.
  useEffect(() => {
    if (loggedOut.current) return;
    loggedOut.current = true;
    try {
      sessionStorage.removeItem('user');
    } catch {
      /* ignore */
    }
    switchAccount().finally(clearClientCookies); // POST /api/logout {clearAll:true} + local reset
  }, [switchAccount]);

  const goToLogin = () => {
    setShowSuccessModal(false);
    navigate('/login', { state: { userId: resetUserIdRef.current, focusPassword: true } });
  };

  useEffect(() => {
    if (!showSuccessModal) return;
    const t = setTimeout(goToLogin, 2000);
    return () => clearTimeout(t);
     
  }, [showSuccessModal]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (password.length < 6) {
      setMessage({ type: 'danger', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: 'danger', text: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/api/reset-password', { token, password });
      resetUserIdRef.current = data?.userId || '';
      setShowSuccessModal(true);
    } catch (err: any) {
      setMessage({ type: 'danger', text: err?.response?.data?.message || 'Failed to reset password. The link may be invalid or expired.' });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto mt-12 max-w-[720px] px-4">
        <Alert variant="danger" className="mb-3">Invalid reset link. Please request a new one from the login page.</Alert>
        <button type="button" className="btn btn-primary min-h-9" onClick={() => navigate('/login')}>Go to Login</button>
      </div>
    );
  }

  const field = (
    id: string, label: string, value: string, set: (v: string) => void, show: boolean, toggle: () => void, placeholder: string,
  ) => (
    <div className="mb-4">
      <label htmlFor={id} className="mb-2 block text-[0.9rem] font-medium text-[#1f2937]">{label}</label>
      <div className="flex">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="input h-[45px] !rounded-l-[10px] !rounded-r-none"
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          required
        />
        <button type="button" onClick={toggle} aria-label="Toggle password" className="btn btn-outline-secondary h-[45px] w-12 shrink-0 !rounded-l-none !rounded-r-[10px] !border-l-0">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f9] p-5 max-sm:px-4">
      <div className="w-full max-w-[480px]">
        <div className="rounded-2xl bg-white p-10 shadow-[0_10px_30px_rgba(0,0,0,0.08)] max-sm:px-5 max-sm:py-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex size-[60px] items-center justify-center rounded-full bg-[#e7f0ff] text-[#0d6efd]">
              <Lock size={24} />
            </div>
            <h3 className="m-0 text-[1.5rem] font-bold text-[#212529]">Reset Password</h3>
            <p className="mt-1 text-[#6c757d]">Enter your new secure password below</p>
          </div>
          {message && <Alert variant={message.type} className="mb-4 !rounded-[10px]">{message.text}</Alert>}
          <form onSubmit={handleSubmit}>
            {field('rp-password', 'New Password', password, setPassword, showPassword, () => setShowPassword((p) => !p), 'Min. 8 characters')}
            {field('rp-confirm', 'Confirm Password', confirm, setConfirm, showConfirm, () => setShowConfirm((p) => !p), 'Re-enter password')}
            <button
              type="submit"
              disabled={loading}
              className="btn h-[45px] w-full !rounded-[10px] !border-0 !bg-[#0d6efd] font-semibold text-white"
            >
              {loading ? 'Processing...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>

      <Modal
        show={showSuccessModal}
        onHide={goToLogin}
        size="compact"
        backdrop="static"
        headerVariant="custom"
        headerStyle={{
          background: 'radial-gradient(circle at 20% 20%, rgba(40,167,69,0.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,0.9), rgba(18,26,54,0.92))',
          color: '#fff',
          padding: '6px 12px',
        }}
        title={<span className="flex items-center gap-2 text-[0.95rem]"><CheckCircle2 size={16} /> Reset Successful</span>}
        bodyClassName="!p-6 text-center"
        footerClassName="!border-0 !bg-white !px-[15px] !py-2.5"
        footer={
          <button
            type="button"
            onClick={goToLogin}
            className="btn w-full !rounded-md !border-0 !p-2.5 text-[0.9rem] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
          >
            Go to Login
          </button>
        }
      >
        <CheckCircle2 size={48} className="mx-auto mb-3 text-[#28a745]" />
        <h5 className="mb-2 text-[1.1rem] font-bold text-[#2c3e50]">Password Updated!</h5>
        <p className="mb-3 text-[0.85rem] text-[#6c757d]">
          Your password has been changed. You have been logged out from all other devices for security.
        </p>
        <p className="m-0 flex items-center justify-center gap-2 text-[0.82rem] font-medium text-[#0d6efd]">
          <Spinner size="sm" className="!border-2 text-current" /> Redirecting to login...
        </p>
      </Modal>
    </div>
  );
}
