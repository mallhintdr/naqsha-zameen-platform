/** Port of legacy components/Auth/UserRegistration.js (inv-02 §4). Route: /admin/register (admin only). */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff, Home, MousePointer, Receipt, ShieldHalf, UserCircle, X } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Badge, Spinner, toast, cn } from '@/shared/ui';
import { fetchConsolidatedTehsils, fetchMauzas } from '@/shared/lib/mouzaApi';
import { formatPhoneNumber, uniqSort } from '@/shared/lib/formUtils';
import { getCurrentDate, subscriptionOptions } from '@/shared/lib/userUtils';
import { useAuth } from '@/features/auth/AuthProvider';
import RegistrationSuccessModal from '../components/RegistrationSuccessModal';
import NotificationModal, { type FormMessage } from '../components/NotificationModal';
import { AssignmentSummary, EmptyBox, TehsilList, tehsilName, type Assignment, type TehsilItem } from '../components/AreaPicker';

const makeEmptyForm = () => ({
  userName: '', userId: '', password: '', confirmPassword: '', mobileNumber: '', email: '',
  startDate: getCurrentDate(), subscriptionType: 'Trial', userType: 'user', fee: 1000 as number,
});
const normalizeMauzas = (list: any[] = []): string[] =>
  uniqSort((Array.isArray(list) ? list : []).map((m) => (typeof m === 'string' ? m.trim() : String(m))).filter(Boolean));
const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-999999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
};

const Section = ({ icon, title, border, headerBg, bodyBg, children }: { icon: ReactNode; title: string; border: string; headerBg: string; bodyBg: string; children: ReactNode }) => (
  <section className="mb-6 overflow-hidden rounded-lg max-md:-mx-3 max-md:rounded-none max-md:border-x-0" style={{ border: `1px solid ${border}` }}>
    <header className="flex items-center gap-2 px-4 py-2.5 font-semibold text-white" style={{ background: headerBg }}>
      {icon} {title}
    </header>
    <div className="p-[25px] max-md:p-[15px]" style={{ background: bodyBg }}>{children}</div>
  </section>
);
const L = ({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) => (
  <label htmlFor={htmlFor} className="mb-1.5 block font-semibold text-[#1f2937]">{children}</label>
);
const colHead = 'm-0 text-base font-semibold text-[#495057]';

export default function AdminRegistrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdminViewing = user?.userType === 'admin';
  const [formData, setFormData] = useState(makeEmptyForm);
  const [showPassword, setShowPassword] = useState(true); // generated password visible by default for admin
  const [tehsilOptions, setTehsilOptions] = useState<TehsilItem[]>([]);
  const [tehsilFilter, setTehsilFilter] = useState('');
  const [selectedTehsil, setSelectedTehsil] = useState('');
  const [tehsilAssignments, setTehsilAssignments] = useState<Assignment[]>([]);
  const [activeTehsil, setActiveTehsil] = useState('');
  const [mauzaOptions, setMauzaOptions] = useState<string[]>([]);
  const [selectedMauzas, setSelectedMauzas] = useState<string[]>([]);
  const [mauzaFilter, setMauzaFilter] = useState('');
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [mouzaLoading, setMouzaLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<any>(null);
  const [expandedTehsil, setExpandedTehsil] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const mauzaInputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const tehsilFilterInputRef = useRef<HTMLInputElement>(null);
  const assignmentsRef = useRef(tehsilAssignments);
  assignmentsRef.current = tehsilAssignments;

  useEffect(() => {
    nameInputRef.current?.focus();
    // Admin sees every tehsil (AKAR included).
    fetchConsolidatedTehsils()
      .then((list: any) => setTehsilOptions(Array.isArray(list) ? list : []))
      .catch(() => setTehsilOptions([]));
  }, []);

  // Auto-generate password: Capitalised name (no spaces) + '@' + last 5 mobile digits
  useEffect(() => {
    if (!formData.userName || !formData.mobileNumber) return;
    const rawName = formData.userName.replace(/\s+/g, '');
    if (!rawName) return;
    const digits = formData.mobileNumber.replace(/\D/g, '');
    const lastFive = digits.substring(digits.length - 5);
    if (lastFive.length === 5) {
      const pw = `${rawName.charAt(0).toUpperCase()}${rawName.slice(1).toLowerCase()}@${lastFive}`;
      setFormData((p) => ({ ...p, password: pw, confirmPassword: pw }));
    }
  }, [formData.userName, formData.mobileNumber]);

  useEffect(() => {
    if (formData.userType === 'admin') setFormData((p) => ({ ...p, subscriptionType: 'Permanent', fee: 0 }));
  }, [formData.userType]);

  // Load mouzas for the selected tehsil
  useEffect(() => {
    let cancelled = false;
    if (!selectedTehsil) {
      setMauzaOptions([]);
      setSelectedMauzas([]);
      return;
    }
    setMouzaLoading(true);
    fetchMauzas(selectedTehsil)
      .then((list: any) => {
        if (cancelled) return;
        const options: string[] = uniqSort(Array.isArray(list) ? list : []);
        setMauzaOptions(options);
        setMessage({ type: 'info', text: `The ${options.length} mouzas of ${selectedTehsil} is loading completed.` });
        const existing = assignmentsRef.current.find((e) => e.tehsil === selectedTehsil);
        setSelectedMauzas(existing ? normalizeMauzas(existing.mouzas) : []);
      })
      .catch(() => !cancelled && setMessage({ type: 'danger', text: `Failed to load mouzas for ${selectedTehsil}` }))
      .finally(() => !cancelled && setMouzaLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedTehsil]);

  // Auto-dismiss the "mouzas loaded" notice after 1 s
  useEffect(() => {
    if (message?.type === 'info' && message.text.includes('loading completed')) {
      const t = setTimeout(() => setMessage(null), 1000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const formatted = name === 'mobileNumber' ? formatPhoneNumber(value) : value;
    setFormData((p) => ({ ...p, [name]: name === 'fee' ? Number(formatted) : formatted }));
  };

  const suggestUserId = () => {
    if (!formData.userName) return;
    const cleanName = formData.userName.toLowerCase().replace(/\s+/g, '.');
    const digits = formData.mobileNumber.replace(/\D/g, '');
    const suffix = digits.substring(digits.length - 4) || Math.floor(1000 + Math.random() * 9000);
    setFormData((p) => ({ ...p, userId: `${cleanName}_${suffix}` }));
  };

  const handleCopyMouzaList = async () => {
    if (!selectedTehsil || !mauzaOptions.length) return;
    const sorted = [...mauzaOptions].sort((a, b) => a.localeCompare(b));
    const text =
      `Tehsil Name:${selectedTehsil}\nMouza availble as of now:${sorted.length}\n${'S.No'.padEnd(7)}Mouza Name\n` +
      sorted.map((n, i) => `${String(i + 1).padEnd(7)}${n}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${sorted.length} mouzas of ${selectedTehsil} to clipboard!`);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredTehsils = useMemo(() => {
    const f = tehsilFilter.toLowerCase();
    return tehsilOptions.filter((t) => tehsilName(t).toLowerCase().includes(f));
  }, [tehsilOptions, tehsilFilter]);
  const filteredMauzas = useMemo(() => {
    const f = mauzaFilter.toLowerCase();
    return mauzaOptions.filter((m) => m.toLowerCase().includes(f));
  }, [mauzaOptions, mauzaFilter]);
  const orderedMauzas = useMemo(
    () => [
      ...filteredMauzas.filter((m) => selectedMauzas.includes(m)).sort(byNumeric),
      ...filteredMauzas.filter((m) => !selectedMauzas.includes(m)).sort(byNumeric),
    ],
    [filteredMauzas, selectedMauzas],
  );

  const updateTehsilAssignment = (tehsil: string, mouzas: string[]) => {
    if (!tehsil) return;
    const norm = normalizeMauzas(mouzas);
    setTehsilAssignments((prev) => {
      const filtered = prev.filter((t) => t.tehsil !== tehsil);
      return norm.length ? [...filtered, { tehsil, mouzas: norm }] : filtered;
    });
    if (norm.length) setActiveTehsil((p) => p || tehsil);
  };

  const handleMauzaToggle = (m: string) => {
    if (!selectedTehsil) return;
    const next = selectedMauzas.includes(m) ? selectedMauzas.filter((x) => x !== m) : [...selectedMauzas, m];
    setSelectedMauzas(next);
    updateTehsilAssignment(selectedTehsil, next);
    setMauzaFilter('');
    setTimeout(() => mauzaInputRef.current?.focus(), 0);
  };
  const handleSelectAll = () => {
    if (!selectedTehsil || !mauzaOptions.length) return;
    setSelectedMauzas(mauzaOptions);
    updateTehsilAssignment(selectedTehsil, mauzaOptions);
  };
  const handleClear = () => {
    if (!selectedTehsil) return;
    setSelectedMauzas([]);
    updateTehsilAssignment(selectedTehsil, []);
  };
  const handleRemoveAssignment = (tehsil: string) => {
    setTehsilAssignments((p) => p.filter((e) => e.tehsil !== tehsil));
    if (activeTehsil === tehsil) setActiveTehsil('');
    if (selectedTehsil === tehsil) setSelectedMauzas([]);
  };
  const handleRemoveMouza = (tehsil: string, mouza: string) => {
    const entry = tehsilAssignments.find((e) => e.tehsil === tehsil);
    if (!entry) return;
    const next = entry.mouzas.filter((m) => m !== mouza);
    setTehsilAssignments((p) => {
      const filtered = p.filter((e) => e.tehsil !== tehsil);
      return next.length ? [...filtered, { tehsil, mouzas: next }] : filtered;
    });
    if (!next.length && activeTehsil === tehsil) setActiveTehsil('');
    if (selectedTehsil === tehsil) setSelectedMauzas((p) => p.filter((m) => m !== mouza));
  };

  const handleCancel = () => {
    setFormData(makeEmptyForm());
    setTehsilAssignments([]);
    setActiveTehsil('');
    setSelectedTehsil('');
    setSelectedMauzas([]);
    setMessage(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    const isAdmin = formData.userType === 'admin';
    const finalAssignments = [...tehsilAssignments];
    if (selectedTehsil && selectedMauzas.length) {
      const norm = normalizeMauzas(selectedMauzas);
      const idx = finalAssignments.findIndex((t) => t.tehsil === selectedTehsil);
      if (idx >= 0) finalAssignments[idx] = { tehsil: selectedTehsil, mouzas: norm };
      else finalAssignments.push({ tehsil: selectedTehsil, mouzas: norm });
    }
    const finalActiveTehsil = activeTehsil || finalAssignments[0]?.tehsil || '';

    if (!isAdmin && !finalAssignments.length) {
      setMessage({ type: 'danger', text: 'Please assign at least one tehsil.' });
      setLoading(false);
      window.scrollTo(0, 0);
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setMessage({ type: 'danger', text: 'Passwords do not match.' });
      setFormData((p) => ({ ...p, confirmPassword: '' }));
      setTimeout(() => confirmPasswordRef.current?.focus(), 100);
      setLoading(false);
      return;
    }
    if (formData.password.length < 8) {
      setMessage({ type: 'danger', text: 'Password must be at least 8 characters long.' });
      setLoading(false);
      return;
    }

    try {
      await api.post('/api/admin/users/register', {
        ...formData,
        tehsilAccess: isAdmin ? [] : finalAssignments,
        activeTehsil: isAdmin ? '' : finalActiveTehsil,
      });
      const token = btoa(JSON.stringify({ u: formData.userId, p: formData.password }));
      const origin = window.location.origin;
      const link = `${origin}/login?t=${token}`;
      try {
        await copyText(`User ID: ${formData.userId}\nPassword: ${formData.password}\n\nQuick Login Link:\n${link}`);
      } catch (clipErr) {
        console.error('Failed to copy quick login link to clipboard:', clipErr);
      }
      setSuccessData({
        userName: formData.userName,
        userId: formData.userId,
        password: formData.password,
        subscriptionType: formData.subscriptionType,
        tehsilAccess: isAdmin ? [] : finalAssignments,
      });
      setShowSuccessModal(true);
      handleCancel();
    } catch (error: any) {
      const data = error?.response?.data || {};
      const errorMsg: string = data.error || data.errors?.[0]?.msg || 'Registration failed. Please try again.';
      setMessage({ type: 'danger', text: errorMsg });
      if (String(errorMsg).toLowerCase().includes('email already exists')) {
        setFormData((p) => ({ ...p, email: '' }));
        setTimeout(() => emailRef.current?.focus(), 100);
      }
    }
    setLoading(false);
  };

  const grp = 'mb-4 max-md:mb-3';
  const navyBtn = {
    background: 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.45), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 1), rgba(18, 26, 54, 1))',
    border: '1px solid rgba(0, 255, 255, 0.4)',
  };

  return (
    <div className="registration-form-container w-full px-3 py-6 md:px-6">
      <RegistrationSuccessModal show={showSuccessModal} onHide={() => setShowSuccessModal(false)} userData={successData} isAdminRegistered />
      <NotificationModal message={message} onHide={() => setMessage(null)} />

      <div className="mb-6 flex items-center justify-between gap-2 border-b border-[#dee2e6] pb-2">
        <h3 className="m-0 text-[1.5rem] font-bold text-[#0A2540] max-sm:text-[1.25rem]">Admin User Registration</h3>
        <button type="button" className="btn btn-outline-primary min-h-9 shrink-0" onClick={() => navigate('/')}>
          <Home size={15} /> Home
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <Section icon={<UserCircle size={17} />} title="Basic Information" border="#cbd5e1" headerBg="#1e293b" bodyBg="#f8fafc">
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            <div className={grp}>
              <L htmlFor="ar-userName">User Name *</L>
              <input id="ar-userName" ref={nameInputRef} className="input" type="text" name="userName" value={formData.userName} onChange={handleChange} required placeholder="Full Name" />
            </div>
            <div className={grp}>
              <L htmlFor="ar-email">Email Address</L>
              <input id="ar-email" ref={emailRef} className="input" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="email@example.com (Optional)" />
            </div>
            <div className="mb-3">
              <L htmlFor="ar-mobile">Mobile Number *</L>
              <input id="ar-mobile" className="input" type="text" inputMode="tel" name="mobileNumber" placeholder="+92 300 1234567" value={formData.mobileNumber} onChange={handleChange} required />
              <div className="mt-1 text-sm text-[#6c757d]">Directly paste contact number from WhatsApp (e.g. +92 345 6789012)</div>
            </div>
            <div className={grp}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="ar-userId" className="block font-semibold text-[#1f2937]">User ID *</label>
                <button
                  type="button"
                  onClick={suggestUserId}
                  className="btn btn-dark btn-sm min-h-7 !rounded-[3px] !border-0 !bg-[#1a1a1a] !px-2 !py-px text-[0.7rem] uppercase tracking-[0.5px]"
                >
                  Suggest ID
                </button>
              </div>
              <input id="ar-userId" className="input" type="text" name="userId" value={formData.userId} onChange={handleChange} required placeholder="username_123" autoCapitalize="none" />
            </div>
            <div className={grp}>
              <L htmlFor="ar-password">Password *</L>
              <div className="relative">
                <input id="ar-password" className="input !pr-10" type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} required placeholder="Auto-generated or type password" autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword((p) => !p)} aria-label="Toggle password" className="absolute inset-y-0 right-[5px] flex w-8 items-center justify-center text-[#6c757d]">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className={grp}>
              <L htmlFor="ar-confirm">Confirm Password *</L>
              <input id="ar-confirm" ref={confirmPasswordRef} className="input" type={showPassword ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} required placeholder="Repeat password" autoComplete="new-password" />
            </div>
          </div>
        </Section>

        <Section icon={<Receipt size={17} />} title="Subscription Details" border="#a7f3d0" headerBg="#0f766e" bodyBg="#f0fdf4">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 md:grid-cols-4">
            <div className={grp}>
              <L htmlFor="ar-start">Start Date *</L>
              <input id="ar-start" className="input" type="date" name="startDate" value={formData.startDate} onChange={handleChange} required />
            </div>
            <div className={grp}>
              <L htmlFor="ar-sub">Subscription Type</L>
              <select id="ar-sub" className="select" name="subscriptionType" value={formData.subscriptionType} onChange={handleChange}>
                {subscriptionOptions.map((opt: any) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value} ({opt.days === -1 ? 'Permanent' : `${opt.days} days`})
                  </option>
                ))}
              </select>
            </div>
            <div className={grp}>
              <L htmlFor="ar-type">User Type</L>
              <select id="ar-type" className="select" name="userType" value={formData.userType} onChange={handleChange} disabled={!isAdminViewing}>
                <option value="user">User</option>
                {isAdminViewing && <option value="admin">Admin</option>}
              </select>
            </div>
            <div className={grp}>
              <L htmlFor="ar-fee">Fee (PKR) *</L>
              <input id="ar-fee" className="input" type="number" name="fee" value={formData.fee} onChange={handleChange} required />
            </div>
          </div>
        </Section>

        {formData.userType !== 'admin' && (
          <Section icon={<ShieldHalf size={17} />} title="Tehsil & Mouza Access" border="#fde68a" headerBg="#b45309" bodyBg="#fffbeb">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="py-2.5 md:border-r-2 md:border-[#f8f9fa] md:pr-[25px]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h5 className={colHead}>Available Tehsils</h5>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm min-h-8"
                    disabled={!selectedTehsil || !mauzaOptions.length}
                    onClick={handleCopyMouzaList}
                  >
                    Copy List
                  </button>
                </div>
                <div className="relative mb-2">
                  <input ref={tehsilFilterInputRef} className="input input-sm !pr-8" placeholder="Search tehsils..." value={tehsilFilter} onChange={(e) => setTehsilFilter(e.target.value)} />
                  {tehsilFilter && (
                    <button
                      type="button"
                      className="input-clear-btn-red"
                      style={{ position: 'absolute', right: 8 }}
                      aria-label="Clear search"
                      onClick={() => {
                        setTehsilFilter('');
                        tehsilFilterInputRef.current?.focus();
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <TehsilList items={filteredTehsils} selected={selectedTehsil} onSelect={setSelectedTehsil} variant="admin" className="h-[300px] overflow-y-auto md:h-auto md:max-h-[250px]" />
              </div>

              <div className="border-t-2 border-[#f8f9fa] py-2.5 md:border-r-2 md:border-t-0 md:px-[25px]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h5 className={colHead}>Select Mouzas</h5>
                  <Badge bg="primary" pill className="text-[0.75rem]">{selectedMauzas.length} selected</Badge>
                </div>
                {!selectedTehsil ? (
                  <EmptyBox className="h-[300px] border-2 border-dashed border-[#dee2e6] md:h-[380px]" icon={<MousePointer size={30} />}>
                    Select a tehsil to view mouzas
                  </EmptyBox>
                ) : mouzaLoading ? (
                  <div className="flex h-[300px] flex-col items-center justify-center gap-2 md:h-[380px]">
                    <Spinner />
                    <span className="font-bold text-[#0096c7]">Loading mouzas for {selectedTehsil}...</span>
                  </div>
                ) : (
                  <div className="flex h-[300px] flex-col md:h-[380px]">
                    <input ref={mauzaInputRef} className="input input-sm mb-2" placeholder="Search mouzas..." value={mauzaFilter} onChange={(e) => setMauzaFilter(e.target.value)} />
                    <div className="mb-3 flex gap-2">
                      <button type="button" className="btn btn-outline-secondary btn-sm min-h-8 flex-1 text-[0.75rem]" onClick={handleSelectAll}>Select All</button>
                      <button type="button" className="btn btn-outline-secondary btn-sm min-h-8 flex-1 text-[0.75rem]" onClick={handleClear}>Clear</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-[#dee2e6] p-[5px]">
                      <div className="grid grid-cols-1 gap-1">
                        {orderedMauzas.map((m) => {
                          const checked = selectedMauzas.includes(m);
                          return (
                            <div
                              key={m}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleMauzaToggle(m)}
                              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleMauzaToggle(m))}
                              className={cn('flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[0.85rem]', checked ? 'font-medium' : 'font-normal')}
                              style={{ background: checked ? '#d4edda' : '#fff', border: `1px solid ${checked ? '#28a745' : '#dee2e6'}`, color: checked ? '#155724' : '#495057' }}
                            >
                              <span
                                className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white"
                                style={{ background: checked ? '#28a745' : '#fff', border: `1px solid ${checked ? '#28a745' : '#adb5bd'}` }}
                              >
                                {checked && '✓'}
                              </span>
                              <span className="min-w-0 break-words">{m}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t-2 border-[#f8f9fa] py-2.5 md:border-t-0 md:pl-[25px]">
                <h5 className={colHead}>Assigned Access Summary</h5>
                <small className="mb-2 block text-[#6c757d]">Review all tehsils and mouzas assigned to this user</small>
                <AssignmentSummary
                  variant="admin"
                  assignments={tehsilAssignments}
                  activeTehsil={activeTehsil}
                  expanded={expandedTehsil}
                  onToggleExpand={(t) => setExpandedTehsil((p) => (p === t ? null : t))}
                  onEdit={setSelectedTehsil}
                  onMakePrimary={setActiveTehsil}
                  onRemove={handleRemoveAssignment}
                  onRemoveMouza={handleRemoveMouza}
                />
              </div>
            </div>
          </Section>
        )}

        <div className="registration-buttons-row mt-6 mb-12 flex gap-4 max-md:justify-center md:justify-end">
          <button type="button" onClick={handleCancel} className="btn btn-secondary reg-btn !rounded-lg !px-[35px] !py-3 text-[0.95rem] font-semibold max-md:max-w-[200px] max-md:flex-1 max-md:!px-3">
            Reset Form
          </button>
          <button type="submit" disabled={loading} className="btn btn-primary reg-btn btn-primary-gradient !rounded-lg !px-[35px] !py-3 text-[0.95rem] font-semibold max-md:max-w-[200px] max-md:flex-1 max-md:!px-3" style={navyBtn}>
            {loading && <Spinner size="sm" className="mr-1 text-current" />}
            Register User
          </button>
        </div>
      </form>
    </div>
  );
}
