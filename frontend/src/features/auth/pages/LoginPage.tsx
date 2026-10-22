/** Port of legacy components/Auth/Login.js (inv-02 §2). Route: /login */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Eye, EyeOff, KeyRound, Lock, MailOpen, Send, User } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Modal, Spinner } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';

type Msg = { type: 'success' | 'info' | 'danger'; text: string } | null;

const decodeToken = (t: string | null): { u?: string; p?: string } | null => {
  if (!t) return null;
  try {
    return JSON.parse(atob(t));
  } catch {
    return null;
  }
};

export default function LoginPage() {
  const [formData, setFormData] = useState({ userId: '', password: '', rememberMe: false, otp: '' });
  const [message, setMessage] = useState<Msg>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { login, loading, user, switchAccount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state: any = location.state || {};
  const [switching, setSwitching] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [needsOTP, setNeedsOTP] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const userIdInputRef = useRef<HTMLInputElement>(null);
  const forgotHandled = useRef(false);

  const search = new URLSearchParams(location.search);
  const redirectTo = (() => {
    const r = search.get('redirect');
    return r && r.startsWith('/') && !r.startsWith('//') ? r : '/';
  })();
  const targetUserId: string | null = (() => {
    const t = search.get('t');
    if (t) return decodeToken(t)?.u || null;
    return state.prefill?.userId || state.userId || null;
  })();

  // Opened for a specific account while someone is signed in: same -> skip form; different -> sign out first.
  useEffect(() => {
    if (!user || !targetUserId || switching) return;
    if (String(user.userId).toLowerCase() === String(targetUserId).toLowerCase()) {
      navigate(redirectTo, { replace: true });
      return;
    }
    setSwitching(user.userName || user.userId);
    switchAccount().finally(() => setSwitching(null));
     
  }, [user, targetUserId]);

  // ?t= quick-login token
  useEffect(() => {
    const decoded = decodeToken(new URLSearchParams(location.search).get('t'));
    if (decoded?.u && decoded?.p) setFormData((p) => ({ ...p, userId: decoded.u!, password: decoded.p!, rememberMe: false }));
  }, [location]);

  // location.state prefills / messages, remember-me
  useEffect(() => {
    const st: any = location.state || {};
    if (st.prefill) {
      const { userId, password } = st.prefill;
      setFormData((p) => ({ ...p, userId: userId || '', password: password || '' }));
      setMessage(
        st.activationSuccess
          ? { type: 'success', text: 'Account activated successfully! Click Login to enter your dashboard.' }
          : { type: 'info', text: 'Registration successful! Please login to continue.' },
      );
    } else if (st.userId) {
      setFormData((p) => ({ ...p, userId: st.userId }));
      setMessage(
        st.activationSuccess
          ? { type: 'success', text: 'Account activated successfully! Please enter your password to log in.' }
          : { type: 'success', text: 'Password reset successful. Please login with your new password.' },
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (st.userId || st.focusPassword) timer = setTimeout(() => passwordInputRef.current?.focus(), 150);

    let savedUserId: string | null = null;
    try {
      savedUserId = localStorage.getItem('userId');
      if (savedUserId && !st.userId && !st.prefill) setFormData((p) => ({ ...p, userId: savedUserId!, rememberMe: true }));
      localStorage.removeItem('password');
    } catch {
      /* storage blocked */
    }

    // D7 fix: RegistrationGuidanceModal "Forgot Password?" -> open the forgot-password flow here.
    if (st.openForgotPassword && !forgotHandled.current) {
      forgotHandled.current = true;
      if (savedUserId && !st.prefill && !st.userId) {
        void handleForgotPassword(savedUserId);
      } else {
        setMessage({ type: 'info', text: 'Enter your User ID, then click "Forgot Password?" to receive a reset link.' });
        timer = setTimeout(() => userIdInputRef.current?.focus(), 150);
      }
    }
    return () => timer && clearTimeout(timer);
     
  }, [location]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await login({
        userId: formData.userId,
        password: formData.password,
        otp: needsOTP ? formData.otp : undefined,
      });
      if (result?.needsOTP) {
        setNeedsOTP(true);
        setShowOtpModal(true);
        setSubmitting(false);
        return;
      }
      try {
        if (formData.rememberMe) localStorage.setItem('userId', formData.userId);
        else localStorage.removeItem('userId');
        localStorage.removeItem('password');
      } catch {
        /* storage blocked */
      }
      setMessage({ type: 'success', text: 'Login successful!' });
      navigate(redirectTo);
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data || {};
      if (status === 400 && needsOTP) {
        setMessage({ type: 'danger', text: data.message || 'Invalid verification code.' });
      } else if (status === 401) {
        setMessage({ type: 'danger', text: data.message || 'Invalid User ID or Password. Please try again.' });
      } else if (!needsOTP) {
        setMessage({ type: 'danger', text: data.message || error?.message || 'Login failed. Please check your network and credentials.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  async function handleForgotPassword(idOverride?: string) {
    const userId = (idOverride ?? formData.userId).trim();
    if (!userId) {
      setMessage({ type: 'danger', text: 'Please enter your User ID first.' });
      userIdInputRef.current?.focus();
      return;
    }
    setResetLoading(true);
    setMessage(null);
    try {
      const { data } = await api.post('/api/forgot-password', { userId });
      const targetEmail = data?.email || '';
      setMessage({
        type: 'info',
        text: targetEmail ? `A reset link has been sent to your registered email: ${targetEmail}` : data?.message,
      });
    } catch (error: any) {
      setMessage({ type: 'danger', text: error?.response?.data?.message || 'Failed to send reset link. Please try again.' });
    }
    setResetLoading(false);
  }

  const inputCls = 'input h-[42px] !rounded-lg !pl-[35px] text-[0.95rem]';
  const iconCls = 'pointer-events-none absolute left-3 top-[13px]';
  const labelCls = 'mb-2 block text-[0.9rem] font-medium text-[#495057]';
  const busy = loading || submitting;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f9] p-5 max-sm:px-4">
      <div className="w-full max-w-[400px]">
        <div className="overflow-hidden rounded-xl bg-white shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <div className="px-[30px] py-10 max-sm:px-5">
            <div className="mb-[30px] text-center">
              <div className="mx-auto mb-[15px] flex size-[60px] items-center justify-center rounded-full bg-[#e9ecef] text-[1.5rem]">🔐</div>
              <h3 className="m-0 text-[1.5rem] font-bold text-[#212529]">Welcome Back</h3>
              <p className="mt-2 text-[0.9rem] text-[#6c757d]">Sign in to your account</p>
            </div>

            {switching && (
              <Alert variant="info" className="mb-5 items-center px-[15px] py-2.5">
                <Spinner size="sm" className="mr-2 align-middle text-current" />
                Signing out {switching} so you can log in as {targetUserId}…
              </Alert>
            )}
            {message && (
              <Alert variant={message.type} className="mb-5 px-[15px] py-2.5">
                {message.text}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="login-userId" className={labelCls}>User ID</label>
                <div className="relative">
                  <User size={16} className={`${iconCls} text-[#adb5bd]`} />
                  <input
                    id="login-userId"
                    ref={userIdInputRef}
                    type="text"
                    name="userId"
                    autoComplete="username"
                    value={formData.userId}
                    onChange={handleChange}
                    placeholder="Enter User ID"
                    required
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="mb-4">
                <label htmlFor="login-password" className={labelCls}>Password</label>
                <div className="relative">
                  <Lock size={16} className={`${iconCls} text-[#adb5bd]`} />
                  <input
                    id="login-password"
                    ref={passwordInputRef}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Enter Password"
                    required
                    className={`${inputCls} !pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-0 flex h-[42px] w-9 items-center justify-center text-[#6c757d]"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {needsOTP && (
                <div className="mb-4 animate-fade-in">
                  <label htmlFor="login-otp" className="mb-2 block text-[0.9rem] font-bold text-[#198754]">Verification Code (OTP)</label>
                  <div className="relative">
                    <KeyRound size={16} className={`${iconCls} text-[#198754]`} />
                    <input
                      id="login-otp"
                      type="text"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={formData.otp}
                      onChange={handleChange}
                      placeholder="Enter 6-digit OTP"
                      required
                      maxLength={6}
                      className="input h-[42px] !rounded-lg !border-[#198754] !pl-[35px] text-center text-[1.1rem] font-bold tracking-[5px]"
                    />
                  </div>
                  <small className="mt-1 block text-center text-[#6c757d]">Check your email for the verification code.</small>
                </div>
              )}

              <div className="mb-6 flex items-center justify-between gap-2">
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[0.9rem] text-[#495057]">
                  <input type="checkbox" name="rememberMe" className="check" checked={formData.rememberMe} onChange={handleChange} />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => handleForgotPassword()}
                  disabled={resetLoading}
                  className="min-h-9 p-0 text-[0.85rem] font-medium text-[#0d6efd] no-underline disabled:opacity-65"
                >
                  {resetLoading ? 'Sending...' : 'Forgot Password?'}
                </button>
              </div>

              <button
                type="submit"
                disabled={busy || Boolean(switching)}
                className="btn btn-primary h-[45px] w-full !rounded-lg !p-2.5 text-base font-semibold"
              >
                {busy ? (
                  <>
                    <Spinner size="sm" className="mr-2 text-current" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            <div className="mt-5 text-center text-[0.9rem]">
              <span className="text-[#6c757d]">Don&apos;t have an account? </span>
              <Link to="/register" className="font-semibold text-[#0d6efd] no-underline">Sign Up</Link>
            </div>
            <div className="mt-[15px] text-center text-[0.85rem]">
              <span className="text-[#6c757d]">Help &amp; Support: </span>
              <a href="tel:03048840264" className="font-medium text-[#0d6efd] no-underline">0304-8840264</a>
            </div>
          </div>
        </div>
      </div>

      <Modal
        show={showOtpModal}
        onHide={() => setShowOtpModal(false)}
        size="sm"
        headerVariant="custom"
        headerStyle={{ background: '#198754', color: '#fff' }}
        className="sm:!rounded-[15px]"
        title={<span className="flex items-center gap-2 text-base"><Send size={15} /> OTP Sent</span>}
        bodyClassName="!py-6 text-center"
        footerClassName="!border-0 !bg-white"
        footer={
          <button type="button" className="btn btn-success min-h-9 w-full !rounded-lg" onClick={() => setShowOtpModal(false)}>
            OK
          </button>
        }
      >
        <div className="mb-4 flex justify-center text-[#198754]">
          <MailOpen size={40} />
        </div>
        <p className="m-0 text-[0.9rem] text-[#495057]">A verification code has been sent to your registered email address.</p>
      </Modal>
    </div>
  );
}
