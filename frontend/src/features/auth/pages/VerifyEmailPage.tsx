/** Port of legacy components/Auth/VerifyEmail.js (inv-02 §6). Route: /verify-email?token= */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, UserCheck, XCircle } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';

const NAVY = 'radial-gradient(circle at 20% 20%, rgba(45,152,255,0.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,0.9), rgba(18,26,54,0.92))';
const btnCls = 'flex min-h-9 flex-1 items-center justify-center rounded-md border-0 px-1 py-2 text-[0.8rem] font-semibold text-white no-underline';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [verifiedUserId, setVerifiedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const started = useRef(false); // token is single-use: never verify twice (StrictMode)

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setErrorMsg('No verification token was provided.');
      return;
    }
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let res;
        try {
          res = await api.get('/api/verify-email', { params: { token } });
        } catch {
          res = await api.get('/verify-email', { params: { token } });
        }
        setVerifiedUserId(res?.data?.userId || '');
        setSuccess(true);
      } catch (err: any) {
        setErrorMsg(err?.response?.data?.error || 'The activation link is invalid or has expired. Please contact support or register again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleGoToLogin = () => {
    let prefill: any = null;
    try {
      const stored = sessionStorage.getItem('pending_activation_creds');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.userId === verifiedUserId || !verifiedUserId) prefill = parsed;
      }
    } catch {
      /* ignore */
    }
    if (prefill) {
      navigate('/login', { state: { prefill: { userId: prefill.userId, password: prefill.password }, activationSuccess: true } });
    } else {
      navigate('/login', { state: { userId: verifiedUserId, activationSuccess: true } });
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[rgba(15,23,42,0.55)] p-4">
      <div className="w-full max-w-[320px] overflow-hidden rounded-lg bg-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[0.95rem] font-semibold text-white" style={{ background: NAVY }}>
          <UserCheck size={16} /> Account Activation
        </div>
        <div className="px-3 py-2.5 text-[0.8rem]">
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-[#6c757d]">
              <Spinner size="sm" /> Verifying your email and activating your account...
            </div>
          ) : success ? (
            <>
              <CheckCircle2 size={32} className="mx-auto mb-1 text-[#28a745]" />
              <div className="mb-2 text-center font-bold text-[#28a745]">Account Activated Successfully!</div>
              <div className="flex items-center justify-between border-b border-[#f1f3f5] py-0.5">
                <span>User ID</span>
                <code className="rounded-[3px] border border-[#e9ecef] bg-[#f8f9fa] px-1 py-px text-[0.75rem] text-[#495057]">{verifiedUserId}</code>
              </div>
              <div className="flex items-center justify-between border-b border-[#f1f3f5] py-0.5">
                <span>Status</span>
                <span className="rounded-[15px] bg-[#28a745] px-2 py-0.5 text-[0.7rem] text-white">Trial active</span>
              </div>
              <p className="mt-2 mb-0 text-[0.75rem] text-[#6c757d]">
                Your email has been verified and your trial access is now active. Log in to explore the dashboard.
              </p>
            </>
          ) : (
            <>
              <XCircle size={32} className="mx-auto mb-1 text-[#dc3545]" />
              <div className="mb-2 text-center font-bold text-[#dc3545]">Activation Failed</div>
              <Alert variant="danger" className="m-0 px-2 py-1 text-[0.75rem]">{errorMsg}</Alert>
            </>
          )}
        </div>
        {!loading && (
          <div className="flex gap-2 border-t border-[#e9ecef] bg-white px-3 py-2">
            {success ? (
              <button type="button" onClick={handleGoToLogin} className={btnCls} style={{ background: NAVY }}>Go to Login</button>
            ) : (
              <>
                <Link to="/register" className={btnCls} style={{ background: '#6c757d' }}>Register Again</Link>
                <Link to="/login" className={btnCls} style={{ background: NAVY }}>Login</Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
