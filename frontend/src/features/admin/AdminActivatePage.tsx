/**
 * Port of legacy components/Admin/AdminActivate.js (inv-03 §9). Route: /admin/activate/:token
 * Admin / sub-admin deep link from a customer's renewal or mouza-change request. Handles auth itself.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CircleCheck, CircleX, UserPen } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';

const Center = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-[80dvh] flex-col items-center justify-center px-3 py-6">{children}</div>
);

export default function AdminActivatePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'unauthorized'>('loading');
  const [data, setData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const hasFetched = useRef(false); // guard against StrictMode double-invocation

  const targetFor = (id: string) =>
    user?.userType === 'subadmin'
      ? `/subadmin/users?edit=${encodeURIComponent(id)}`
      : `/users?activateUserId=${encodeURIComponent(id)}`;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/admin/activate/${token}`)}`, { replace: true });
      return;
    }
    if (user.userType !== 'admin' && user.userType !== 'subadmin') {
      setStatus('unauthorized');
      return;
    }
    if (hasFetched.current) return;
    hasFetched.current = true;
    (async () => {
      try {
        const res = await api.get(`/api/admin/resolve-token/${token}`);
        setData(res.data);
        setStatus('success');
      } catch (err: any) {
        setErrorMsg(err?.response?.data?.message || 'Failed to resolve token');
        setStatus('error');
      }
    })();
  }, [token, user, authLoading, navigate]);

  if (authLoading || status === 'loading') {
    return (
      <Center>
        <Spinner className="!size-12" />
        <p className="mt-4 font-semibold text-[#6c757d]">Verifying activation link...</p>
      </Center>
    );
  }

  if (status === 'unauthorized') {
    return (
      <Center>
        <div className="text-center">
          <CircleX size={60} className="mx-auto mb-4 text-[#dc3545]" />
          <h4 className="mb-2 text-[1.5rem] font-medium">Access Denied</h4>
          <p className="mb-4 text-[#6c757d]">This link is only accessible to administrators.</p>
          <button type="button" className="btn btn-outline-secondary min-h-9" onClick={() => navigate('/')}>Go Home</button>
        </div>
      </Center>
    );
  }

  if (status === 'error') {
    return (
      <Center>
        <div
          className="w-full max-w-[460px] rounded-2xl p-6 text-center shadow-[0_0.5rem_1rem_rgba(0,0,0,0.15)] max-sm:p-4"
          style={{ background: 'linear-gradient(135deg, rgba(220,53,69,0.08), rgba(220,53,69,0.03))', border: '1px solid rgba(220,53,69,0.25)' }}
        >
          <CircleX size={52} className="mx-auto mb-4 text-[#dc3545]" />
          <h5 className="mb-2 text-[1.25rem] font-bold">Link Invalid or Expired</h5>
          <Alert variant="danger" className="mb-4 py-2 text-left text-[0.85rem]">{errorMsg}</Alert>
          <p className="mb-4 text-[0.8rem] text-[#6c757d]">
            Each admin link is single-use and valid for <strong>7 days</strong>. Ask the user to send a new WhatsApp request to generate a fresh link.
          </p>
          <button type="button" className="btn btn-primary min-h-9" onClick={() => navigate('/users')}>
            <UserPen size={16} /> Open User Management
          </button>
        </div>
      </Center>
    );
  }

  const c = data?.customer;
  const rows: [string, any][] = c
    ? [
        ['User ID', c.userId],
        ['Name', c.userName],
        ['Mouzas', c.mouzaCount],
        ['Subscription', `${c.plan || '—'}${c.status ? ` (${c.status})` : ''}`],
        ['Ends', c.endDate ? `${new Date(c.endDate).toLocaleDateString('en-GB')} · ${c.daysLeft} day(s) left` : '—'],
        ['Fee (last paid)', `Rs ${Number(c.lastFeePaid || 0).toLocaleString('en-PK')}`],
        ...(c.mobile ? ([['Mobile', c.mobile]] as [string, any][]) : []),
      ]
    : [];

  return (
    <Center>
      <div
        className="w-full max-w-[460px] rounded-[18px] p-6 text-center text-white shadow-[0_1rem_3rem_rgba(0,0,0,0.175)] max-sm:p-4"
        style={{
          background: 'radial-gradient(circle at 20% 20%, rgba(45,152,255,0.18), transparent 60%), linear-gradient(135deg, rgba(11,14,40,0.97), rgba(18,26,54,0.99))',
          border: '1px solid rgba(45,152,255,0.2)',
        }}
      >
        <CircleCheck size={56} className="mx-auto mb-4 text-[#28a745]" />
        <div
          className="mb-2 inline-block rounded px-2 py-1 text-[0.7rem] font-bold uppercase tracking-[1px] text-[#ffc107]"
          style={{ background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.3)' }}
        >
          {data.requestType === 'AssignmentChange' ? 'Mouza Change' : data.requestType} Request
        </div>
        <h4 className="mt-2 mb-0 break-words text-[1.5rem] font-bold text-white">{data.userName}</h4>
        <p className="mb-1 break-all font-mono text-[0.85rem] text-[#93a8c4]">{data.userId}</p>
        <div className="mt-2 mb-4 rounded p-2 text-[0.75rem] text-[#8aa0bc]" style={{ background: 'rgba(255,255,255,0.07)' }}>
          Request received: <strong className="text-[#cdd9e8]">{new Date(data.requestedAt).toLocaleString()}</strong>
        </div>
        {c && (
          <table className="mb-4 w-full border-collapse text-left text-[0.82rem]">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap px-2 py-[3px] text-[#8aa0bc]" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{k}</td>
                  <td className="break-words px-2 py-[3px] font-bold text-white" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          type="button"
          className="btn btn-success btn-lg w-full text-base font-bold tracking-[0.5px]"
          onClick={() => navigate(targetFor(data.userId), { replace: true })}
        >
          <UserPen size={18} /> Open User Edit Form
        </button>
        <p className="mt-4 mb-0 text-[0.7rem] text-[#5a7499]">This link can be reopened for 1 hour from the first opening.</p>
      </div>
    </Center>
  );
}
