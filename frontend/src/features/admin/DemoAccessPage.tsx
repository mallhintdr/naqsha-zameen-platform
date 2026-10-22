/** Port of legacy components/Admin/DemoAccess.js (inv-03 §13). Route: /demo/:token */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiUrl } from '@/shared/api/base';

// Redirects the browser to the backend so the demo token can set the auth cookie.
export default function DemoAccessPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      navigate('/', { replace: true });
      return;
    }
    window.location.replace(apiUrl(`/demo-access/${encodeURIComponent(token)}`));
  }, [navigate, token]);

  return (
    <div className="flex h-full min-h-[50dvh] items-center justify-center">
      <span>Preparing demo access…</span>
    </div>
  );
}
