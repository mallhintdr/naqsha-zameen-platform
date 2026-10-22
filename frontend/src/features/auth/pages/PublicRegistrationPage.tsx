/** Port of legacy components/Auth/PublicUserRegistration.js (inv-02 §3). Route: /register */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router';
import { Clock, Eye, EyeOff, Info, MailOpen, MousePointer } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { api } from '@/shared/api/client';
import { Alert, Badge, Spinner } from '@/shared/ui';
import { fetchConsolidatedTehsils, fetchMauzas } from '@/shared/lib/mouzaApi';
import { withoutAkar } from '@/shared/lib/akar';
import { formatPhoneNumber, uniqSort } from '@/shared/lib/formUtils';
import { getDeviceId } from '@/shared/lib/device';
import RegistrationGuidanceModal, { type GuidanceData } from '../components/RegistrationGuidanceModal';
import RegistrationSuccessModal from '../components/RegistrationSuccessModal';
import NotificationModal, { type FormMessage } from '../components/NotificationModal';
import { AssignmentSummary, EmptyBox, TehsilList, tehsilName, type Assignment, type TehsilItem } from '../components/AreaPicker';

// D9: Turnstile is off unless VITE_ENABLE_TURNSTILE=true.
const ENABLE_TURNSTILE = import.meta.env.VITE_ENABLE_TURNSTILE === 'true';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const PUBLIC_MOUZA_LIMIT = 1;

const EMPTY_FORM = { userName: '', userId: '', password: '', confirmPassword: '', mobileNumber: '', email: '', subscriptionType: 'Trial' };
const normalizeMauzas = (list: any[] = []): string[] =>
  uniqSort(list.map((m) => (typeof m === 'string' ? m.trim() : String(m))).filter(Boolean));
const localIsoDate = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const SectionCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card mb-3">
    <header className="card-header !py-2">
      <h6 className="m-0 text-[0.9rem] font-bold">{title}</h6>
    </header>
    <div className="px-3 py-2 max-sm:px-2.5">{children}</div>
  </section>
);
const Label = ({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-[#1f2937]">{children}</label>
);
const colHead = 'mb-2 text-[0.85rem] font-semibold text-[#495057]';
const listBox = 'h-[300px] overflow-y-auto rounded-[5px] border border-[#dee2e6] bg-white p-[5px] md:h-[350px]';

export default function PublicRegistrationPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [tehsilOptions, setTehsilOptions] = useState<TehsilItem[]>([]);
  const [selectedTehsil, setSelectedTehsil] = useState('');
  const [tehsilFilter, setTehsilFilter] = useState('');
  const [tehsilAssignments, setTehsilAssignments] = useState<Assignment[]>([]);
  const [activeTehsil, setActiveTehsil] = useState('');
  const [mauzaOptions, setMauzaOptions] = useState<string[]>([]);
  const [selectedMauzas, setSelectedMauzas] = useState<string[]>([]);
  const [mauzaFilter, setMauzaFilter] = useState('');
  const [expandedTehsil, setExpandedTehsil] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<any>(null);
  const [guidance, setGuidance] = useState<{ show: boolean; data: GuidanceData | null }>({ show: false, data: null });
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaError, setCaptchaError] = useState(false);
  const [userIdError, setUserIdError] = useState('');
  const [isValidatingUserId, setIsValidatingUserId] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const userIdInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const tehsilInputRef = useRef<HTMLInputElement>(null);
  const mauzaInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef(formData);
  formRef.current = formData;

  const showGuidance = (data: GuidanceData) => setGuidance({ show: true, data });

  const focusField = (key: string) => {
    const map: Record<string, RefObject<HTMLInputElement | null>> = {
      userName: nameInputRef, userId: userIdInputRef, password: passwordInputRef, confirmPassword: confirmPasswordRef,
      mobileNumber: phoneInputRef, email: emailRef, tehsil: tehsilInputRef, mauza: mauzaInputRef,
    };
    const el = map[key]?.current;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  useEffect(() => {
    nameInputRef.current?.focus();
    // AKAR chaks are admin-only: not offered on public sign-up.
    fetchConsolidatedTehsils()
      .then((list: any) => setTehsilOptions(withoutAkar(list || [])))
      .catch(() => setTehsilOptions([]));
  }, []);

  // Debounced (500 ms) live User ID availability check
  useEffect(() => {
    if (!formData.userId.trim()) {
      setUserIdError('');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setIsValidatingUserId(true);
      try {
        const { data } = await api.get(`/api/public/check-userid/${encodeURIComponent(formData.userId)}`, { signal: ctrl.signal });
        setUserIdError(data?.exists ? 'This User ID is already taken. Please choose another one.' : '');
      } catch {
        /* fallback: keep previous state */
      } finally {
        if (!ctrl.signal.aborted) setIsValidatingUserId(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [formData.userId]);

  // Load mouzas when the tehsil changes
  useEffect(() => {
    let cancelled = false;
    if (!selectedTehsil) {
      setMauzaOptions([]);
      return;
    }
    fetchMauzas(selectedTehsil)
      .then((list: any) => !cancelled && setMauzaOptions(uniqSort(list || [])))
      .catch(() => !cancelled && setMauzaOptions([]));
    return () => {
      cancelled = true;
    };
  }, [selectedTehsil]);

  // Keep the checked mouzas in sync with the assignment of the selected tehsil
  useEffect(() => {
    const existing = tehsilAssignments.find((a) => a.tehsil === selectedTehsil);
    setSelectedMauzas(existing ? normalizeMauzas(existing.mouzas) : []);
  }, [selectedTehsil, tehsilAssignments]);

  const suggestUserId = () => {
    const f = formRef.current;
    if (!f.userName) return;
    const cleanName = f.userName.toLowerCase().replace(/\s+/g, '.');
    const suffix = f.mobileNumber ? f.mobileNumber.replace(/\D/g, '').slice(-4) : Math.floor(100 + Math.random() * 900);
    setFormData((p) => ({ ...p, userId: `${cleanName}_${suffix}` }));
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: name === 'mobileNumber' ? formatPhoneNumber(value) : value }));
  };

  const filteredTehsils = useMemo(() => {
    const f = tehsilFilter.toLowerCase();
    return tehsilOptions.filter((t) => tehsilName(t).toLowerCase().includes(f));
  }, [tehsilOptions, tehsilFilter]);
  const filteredMauzas = useMemo(
    () => mauzaOptions.filter((m) => m.toLowerCase().includes(mauzaFilter.toLowerCase())),
    [mauzaOptions, mauzaFilter],
  );

  const handleMauzaToggle = (m: string) => {
    const prev = selectedMauzas;
    let next: string[];
    if (prev.includes(m)) {
      next = prev.filter((x) => x !== m);
    } else {
      const others = tehsilAssignments.filter((t) => t.tehsil !== selectedTehsil).reduce((s, t) => s + t.mouzas.length, 0);
      if (others + prev.length + 1 > PUBLIC_MOUZA_LIMIT) {
        setMessage({ type: 'danger', text: 'Selection limit reached: Public accounts can access a maximum of 1 mouza.' });
        return;
      }
      next = [...prev, m];
      if (!activeTehsil) setActiveTehsil(selectedTehsil);
    }
    setSelectedMauzas(next);
    setTehsilAssignments((cur) => {
      const filtered = cur.filter((t) => t.tehsil !== selectedTehsil);
      return next.length ? [...filtered, { tehsil: selectedTehsil, mouzas: next }] : filtered;
    });
    setMauzaFilter('');
    setTimeout(() => mauzaInputRef.current?.focus(), 0);
  };

  const handleRemoveAssignment = (tehsil: string) => {
    setTehsilAssignments((p) => p.filter((e) => e.tehsil !== tehsil));
    if (activeTehsil === tehsil) setActiveTehsil('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (ENABLE_TURNSTILE && !captchaToken && import.meta.env.PROD) {
      showGuidance({
        type: 'GENERIC',
        title: 'Security Verification Required',
        message: 'Please complete the Cloudflare security verification before registering.',
        details: ['Check the security checkbox below the form.'],
      });
      return;
    }

    const mobileEmpty = !formData.mobileNumber?.trim() || formData.mobileNumber.trim() === '+92';
    const missing: string[] = [];
    if (!formData.userName?.trim()) missing.push('Full Name');
    if (!formData.userId?.trim()) missing.push('User ID');
    if (!formData.email?.trim()) missing.push('Email Address');
    if (mobileEmpty) missing.push('Mobile Number');
    if (!formData.password) missing.push('Password');
    if (!formData.confirmPassword) missing.push('Confirm Password');
    if (!tehsilAssignments.some((a) => a.tehsil && (a.mouzas || []).length > 0)) missing.push('Tehsil & Mouza (select at least 1 mouza)');
    if (missing.length) {
      const first = !formData.userName?.trim() ? 'userName'
        : !formData.userId?.trim() ? 'userId'
        : !formData.email?.trim() ? 'email'
        : mobileEmpty ? 'mobileNumber'
        : !formData.password ? 'password'
        : !formData.confirmPassword ? 'confirmPassword' : 'tehsil';
      showGuidance({
        type: 'MISSING_FIELDS',
        title: 'Missing Required Information',
        message: 'Please fill in all mandatory fields before submitting your registration.',
        details: missing.map((m) => `${m} is required`),
        fieldToFocus: first,
      });
      return;
    }

    const cleanUserId = formData.userId.trim();
    if (cleanUserId.length < 3) {
      showGuidance({
        type: 'USERID_INVALID',
        title: 'User ID Too Short',
        message: 'Your User ID must be at least 3 characters long.',
        details: ['Enter a longer username or click "Suggest ID" to automatically generate one.'],
        fieldToFocus: 'userId',
      });
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanUserId)) {
      showGuidance({
        type: 'USERID_INVALID',
        title: 'Invalid User ID Format',
        message: `The User ID "${cleanUserId}" contains spaces or unsupported symbols.`,
        details: [
          'Only letters (A-Z, a-z), numbers (0-9), dots (.), underscores (_), and dashes (-) are allowed.',
          'Spaces and other special characters cannot be used.',
          'Click "Generate Suggested User ID" below to create a valid ID automatically.',
        ],
        fieldToFocus: 'userId',
      });
      return;
    }
    if (userIdError) {
      showGuidance({
        type: 'USERID_EXISTS',
        title: 'User ID Already Taken',
        message: `The User ID "${cleanUserId}" is already in use by another account.`,
        details: [
          'Please choose a different unique username.',
          'Or click "Generate Suggested User ID" below to get an available ID immediately.',
        ],
        fieldToFocus: 'userId',
      });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormData((p) => ({ ...p, confirmPassword: '' }));
      showGuidance({
        type: 'PASSWORD_MISMATCH',
        title: 'Passwords Do Not Match',
        message: 'The password and confirm password you entered do not match.',
        details: ['Please re-enter your confirm password carefully.', 'Tip: Click the eye icon to verify what you entered in both fields.'],
        fieldToFocus: 'confirmPassword',
      });
      return;
    }
    const pw = formData.password;
    const rules: string[] = [];
    if (pw.length < 6) rules.push('At least 6 characters in length');
    if (!/[A-Z]/.test(pw)) rules.push('At least one uppercase letter (A-Z)');
    if (!/[a-z]/.test(pw)) rules.push('At least one lowercase letter (a-z)');
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) rules.push('At least one special character (!@#$%^&*...)');
    if (rules.length) {
      showGuidance({
        type: 'PASSWORD_INVALID',
        title: 'Password Security Requirements',
        message: 'Your chosen password does not meet the minimum security standards.',
        details: rules.map((r) => `Required: ${r}`),
        fieldToFocus: 'password',
      });
      return;
    }
    if (!tehsilAssignments.length) {
      showGuidance({
        type: 'MOUZA_REQUIRED',
        title: 'Tehsil & Mouza Required',
        message: 'Please select 1 Tehsil and 1 Mouza to activate your trial account.',
        details: ['Select your desired Tehsil from the list.', 'Click on exactly 1 Mouza from the available mouzas list.'],
        fieldToFocus: 'tehsil',
      });
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/register', {
        ...formData,
        userId: cleanUserId,
        captchaToken,
        userType: 'user',
        tehsilAccess: tehsilAssignments,
        activeTehsil,
        startDate: localIsoDate(),
        deviceId: getDeviceId(),
      });
      try {
        sessionStorage.setItem('pending_activation_creds', JSON.stringify({ userId: cleanUserId, password: formData.password }));
      } catch {
        /* storage blocked */
      }
      setSuccessData({
        userName: formData.userName,
        userId: cleanUserId,
        password: formData.password,
        email: formData.email,
        subscriptionType: formData.subscriptionType,
        tehsilAccess: tehsilAssignments,
        activeTehsil,
      });
      setShowSuccessModal(true);
      setFormData(EMPTY_FORM);
      setTehsilAssignments([]);
      setActiveTehsil('');
      setSelectedTehsil('');
      setSelectedMauzas([]);
      setCaptchaToken('');
    } catch (error: any) {
      const data = error?.response?.data || {};
      const errCode = data.code;
      const errMsg: string = data.error || data.errors?.[0]?.msg || data.message || 'Registration failed. Please try again.';
      const lower = String(errMsg).toLowerCase();
      if (errCode === 'DEVICE_EXISTS' || lower.includes('device')) {
        showGuidance({
          type: 'DEVICE_EXISTS',
          title: 'Device Registration Limit Reached',
          message: 'A trial account has already been registered on this device.',
          details: [
            'Each device is limited to 1 trial registration to ensure fair use.',
            'If you already registered, please click "Go to Login Page" below.',
            'If your trial ended, you can submit a renewal request to continue using the system.',
          ],
        });
      } else if (errCode === 'EMAIL_EXISTS' || lower.includes('email')) {
        showGuidance({
          type: 'EMAIL_EXISTS',
          title: 'Email Address Already Registered',
          message: `An account is already registered with "${formData.email}".`,
          details: [
            'If this is your account, please log in with your credentials.',
            'If you forgot your password, click "Forgot Password" below to reset it.',
            'Or use a different email address to register a new account.',
          ],
          fieldToFocus: 'email',
        });
      } else if (errCode === 'USERID_EXISTS' || lower.includes('user id')) {
        showGuidance({
          type: 'USERID_EXISTS',
          title: 'User ID Already Taken',
          message: `The User ID "${cleanUserId}" is already in use by another account.`,
          details: ['Please choose another unique User ID.', 'Click "Generate Suggested User ID" below to create a unique available ID.'],
          fieldToFocus: 'userId',
        });
      } else if (lower.includes('disposable')) {
        showGuidance({
          type: 'DISPOSABLE_EMAIL',
          title: 'Permanent Email Required',
          message: 'Temporary or disposable email addresses are not allowed.',
          details: [
            'Please enter an email from a recognized provider (e.g. Gmail, Yahoo, Outlook).',
            'Your activation link will be delivered to this address.',
          ],
          fieldToFocus: 'email',
        });
      } else {
        showGuidance({ type: 'GENERIC', title: 'Registration Notice', message: errMsg, details: ['Please review the information you entered and try again.'] });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSuccessClose = () => {
    setShowSuccessModal(false);
    if (successData) {
      navigate('/login', { state: { prefill: { userId: successData.userId, password: successData.password } }, replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  const totalMouzas = tehsilAssignments.reduce((s, a) => s + a.mouzas.length, 0);
  const gated = ENABLE_TURNSTILE && !captchaToken && import.meta.env.PROD;
  const pwToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((p) => !p)}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      className="absolute inset-y-0 right-0 z-[5] flex w-10 items-center justify-center text-[#6c757d]"
    >
      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[1000px] px-3 py-2 max-sm:px-2">
      <RegistrationSuccessModal show={showSuccessModal} onHide={handleSuccessClose} userData={successData} />
      <RegistrationGuidanceModal
        show={guidance.show}
        onHide={() => setGuidance({ show: false, data: null })}
        guidanceData={guidance.data}
        onSuggestUserId={suggestUserId}
        onFocusField={focusField}
      />
      <NotificationModal message={message} onHide={() => setMessage(null)} />

      <div className="mb-2 text-center">
        <h3 className="my-[5px] text-[1.4rem] font-bold text-[#0b0e28]">Create Account</h3>
        <p className="m-0 text-sm text-[#6c757d]">Join GeoMatrix to access advanced mapping tools</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <SectionCard title="Basic Information">
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
            <div className="mb-2">
              <Label htmlFor="reg-userName">Full Name *</Label>
              <input id="reg-userName" ref={nameInputRef} className="input" type="text" name="userName" value={formData.userName} onChange={handleChange} placeholder="Enter your full name" autoComplete="name" />
            </div>
            <div className="mb-2">
              <Label htmlFor="reg-email">Email Address *</Label>
              <input id="reg-email" ref={emailRef} className="input" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@mail.com" autoComplete="email" />
              <div className="mt-1 flex items-center gap-1 text-[0.72rem] text-[#6c757d]">
                <MailOpen size={12} className="shrink-0 text-[#0096c7]" /> Activation link will be sent to this email.
              </div>
            </div>
            <div className="mb-2">
              <Label htmlFor="reg-mobile">Mobile Number *</Label>
              <input id="reg-mobile" ref={phoneInputRef} className="input" type="text" inputMode="tel" name="mobileNumber" value={formData.mobileNumber} onChange={handleChange} placeholder="+92 300 1234567" autoComplete="tel" />
            </div>
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="reg-userId" className="block text-sm font-semibold text-[#1f2937]">User ID *</label>
                <button type="button" onClick={suggestUserId} className="btn btn-dark btn-sm min-h-7 !border-0 !bg-[#1a1a1a] !px-2 !py-0 text-[0.7rem]">
                  Suggest ID
                </button>
              </div>
              <input id="reg-userId" ref={userIdInputRef} className="input" type="text" name="userId" value={formData.userId} onChange={handleChange} placeholder="Choose a unique ID" autoComplete="username" autoCapitalize="none" />
              {isValidatingUserId ? (
                <div className="mt-1 flex items-center gap-1 text-sm text-[#6c757d]">
                  <Spinner size="sm" className="!size-3 !border-2" /> Checking availability...
                </div>
              ) : userIdError ? (
                <div className="mt-1 text-sm text-[#dc3545]">{userIdError}</div>
              ) : formData.userId.trim() ? (
                <div className="mt-1 text-sm text-[#198754]">✓ User ID is available</div>
              ) : null}
            </div>
            <div className="mb-2">
              <Label htmlFor="reg-plan">Subscription Plan</Label>
              <select id="reg-plan" className="select" name="subscriptionType" value={formData.subscriptionType} onChange={handleChange}>
                <option value="Trial">Trial</option>
              </select>
              <div className="mt-1 flex items-center gap-1 text-[0.72rem] text-[#6c757d]">
                <Info size={12} className="shrink-0 text-[#06b6d4]" /> Free trial plan with access to 1 Tehsil &amp; 1 Mouza.
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Area of Interest">
          <div className="grid grid-cols-1 md:grid-cols-3">
            <div className="py-2 md:border-r md:border-[#f0f0f0] md:pr-3">
              <h5 className={colHead}>Available Tehsils</h5>
              <input ref={tehsilInputRef} className="input input-sm mb-2" placeholder="Search Tehsil..." value={tehsilFilter} onChange={(e) => setTehsilFilter(e.target.value)} />
              <TehsilList
                items={filteredTehsils}
                selected={selectedTehsil}
                onSelect={setSelectedTehsil}
                variant="public"
                className={listBox}
              />
            </div>

            <div className="border-t border-[#f0f0f0] py-2 md:border-r md:border-t-0 md:px-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h5 className="m-0 text-[0.85rem] font-semibold text-[#495057]">Select Mouzas</h5>
                {selectedTehsil && <Badge bg="primary" pill className="text-[0.7rem]">{selectedMauzas.length} selected</Badge>}
              </div>
              {!selectedTehsil ? (
                <EmptyBox className="h-[300px] border border-dashed border-[#dee2e6] md:h-[350px]" icon={<MousePointer size={24} />}>
                  Select a tehsil first
                </EmptyBox>
              ) : (
                <>
                  <input ref={mauzaInputRef} className="input input-sm mb-2" placeholder="Search Mouza..." value={mauzaFilter} onChange={(e) => setMauzaFilter(e.target.value)} />
                  <div className={listBox}>
                    {filteredMauzas.map((m) => {
                      const checked = selectedMauzas.includes(m);
                      return (
                        <div
                          key={m}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleMauzaToggle(m)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleMauzaToggle(m))}
                          className="mb-[3px] flex min-h-9 cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[0.85rem]"
                          style={{ background: checked ? '#d4edda' : 'transparent', borderBottom: '1px solid #f8f9fa' }}
                        >
                          <input type="checkbox" className="check pointer-events-none shrink-0" checked={checked} readOnly tabIndex={-1} />
                          <span className="truncate">{m}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-[#f0f0f0] py-2 md:border-t-0 md:pl-3">
              <h5 className={colHead}>Assigned Summary</h5>
              <div className="mb-2 text-[0.75rem]">
                Selected: <strong>{tehsilAssignments.length}/1</strong> Tehsil · <strong>{totalMouzas}/{PUBLIC_MOUZA_LIMIT}</strong> Mouza
              </div>
              <AssignmentSummary
                variant="public"
                assignments={tehsilAssignments}
                activeTehsil={activeTehsil}
                expanded={expandedTehsil}
                onToggleExpand={(t) => setExpandedTehsil((p) => (p === t ? null : t))}
                onEdit={setSelectedTehsil}
                onMakePrimary={setActiveTehsil}
                onRemove={handleRemoveAssignment}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Security">
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
            <div className="mb-2">
              <Label htmlFor="reg-password">Password *</Label>
              <div className="relative">
                <input id="reg-password" ref={passwordInputRef} className="input !pr-10" type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} placeholder="Min 6 characters" autoComplete="new-password" />
                {pwToggle}
              </div>
              <div className="mt-1 text-[0.72rem] text-[#6c757d]">
                Password must be at least 6 characters long and include at least one uppercase letter, one lowercase letter, and one special character.
              </div>
            </div>
            <div className="mb-2">
              <Label htmlFor="reg-confirm">Confirm Password *</Label>
              <div className="relative">
                <input id="reg-confirm" ref={confirmPasswordRef} className="input !pr-10" type={showPassword ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} placeholder="Repeat password" autoComplete="new-password" />
                {pwToggle}
              </div>
            </div>
          </div>
        </SectionCard>

        {ENABLE_TURNSTILE && (
          <div className="mb-3 flex flex-col items-center rounded border border-[#dee2e6] bg-[#f8f9fa] p-2 text-[0.8rem] shadow-sm">
            <span className="mb-1 font-semibold">Security Check *</span>
            {TURNSTILE_SITE_KEY ? (
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                options={{ theme: 'light', size: 'normal' }}
                onSuccess={(t) => {
                  setCaptchaToken(t);
                  setCaptchaError(false);
                }}
                onError={() => setCaptchaError(true)}
                onExpire={() => setCaptchaToken('')}
              />
            ) : (
              <Alert variant="warning" className="m-0 py-1">Turnstile Site Key missing in .env</Alert>
            )}
            {captchaError && (
              <Alert variant="danger" className="mt-2 mb-0 py-1 text-[0.78rem]">
                <Clock size={13} className="mr-1 inline align-[-2px]" />
                <strong>Verification Failed:</strong> Please ensure your device&apos;s date and time are set correctly. Incorrect time settings can cause Cloudflare security to fail.
              </Alert>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          onClick={(e) => {
            if (gated) {
              e.preventDefault();
              setMessage({ type: 'danger', text: 'Please complete the CAPTCHA verification.' });
            }
          }}
          className="btn btn-primary mt-2 w-full !rounded-[10px] !py-4 text-[1.1rem] font-bold shadow-sm"
          style={{
            background: 'radial-gradient(circle at 20% 20%, rgba(45,152,255,0.45), transparent 60%), linear-gradient(135deg, rgba(11,14,40,1), rgba(18,26,54,1))',
            border: '1px solid rgba(0,255,255,0.4)',
            opacity: gated ? 0.7 : undefined,
            cursor: gated ? 'not-allowed' : undefined,
          }}
        >
          {loading && <Spinner size="sm" className="mr-2 text-current" />}
          Create Account
        </button>
        <div className="mt-6 mb-4 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-[#1c2a4a]">Login here</Link>
        </div>
      </form>
    </div>
  );
}
