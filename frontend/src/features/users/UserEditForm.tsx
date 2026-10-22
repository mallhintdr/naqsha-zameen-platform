// User edit modal (legacy components/User/UserEditForm.js).
// Opened from the user list row click / ?activateUserId, and by the sub-admin customers screen.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeftRight, CheckCheck, Check, Copy, Eye, FileText, Info, KeyRound, Link2, LogIn, Paperclip, Trash2 } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiBase } from '@/shared/api/base';
import { Alert, Badge, Button, Modal, PageSpinner, cn, toast, useDialog } from '@/shared/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { fmtDate, fmtDateTime } from '@/shared/lib/format';
import { fetchConsolidatedTehsils, fetchMauzas as fetchMauzasRaw } from '@/shared/lib/mouzaApi';
import { withoutAkar } from '@/shared/lib/akar';
import { formatPhoneNumber, uniqSort, normalizeMauzas, arraysEqual } from '@/shared/lib/formUtils';
import { subscriptionOptions, calculateEndDate, calculateStatus, calculateDaysRemaining } from '@/shared/lib/userUtils';
import { PaymentProofInput, RenewalProofList, uploadPaymentProof, hasProof, EMPTY_PROOF } from '@/shared/components/PaymentProof';
import { resetPasswordAndCopy, PasswordCopiedModal, copyToClipboard, type PasswordResetInfo } from '@/shared/components/PasswordResetModal';
import { ProfileSection, SubscriptionSection, AccessSection, MultiUseSection } from './UserEditSections';

const fetchTehsils = async () => {
  const list = await fetchConsolidatedTehsils();
  return Array.isArray(list) ? list : [];
};
const fetchMauzas = async (tehsil: string) => {
  if (!tehsil?.trim()) return [];
  const list = await fetchMauzasRaw(tehsil);
  return Array.isArray(list) ? list : [];
};
const sumMouzas = (a: any[]) => a.reduce((s, t) => s + (Array.isArray(t.mouzas) ? t.mouzas.length : 0), 0);
const errMsg = (e: any) => e?.response?.data?.message || e?.message;

type Assignment = { tehsil: string; mouzas: string[]; tempGrants?: any[] };

export interface UserEditFormProps {
  userId: string;
  handleClose: () => void;
  refreshUsers?: () => void;
  initialTab?: 'profile' | 'subscription' | 'access' | 'multiuse' | string;
}

export default function UserEditForm({ userId, handleClose, refreshUsers, initialTab = 'profile' }: UserEditFormProps) {
  const { loading, userType, user, fetchUserProfile, loginAs } = useAuth() as any;
  const dialog = useDialog();
  const navigate = useNavigate();
  const isSubAdmin = userType === 'subadmin';
  const signOff = isSubAdmin ? `${user?.userName || 'Your provider'}${user?.mobileNumber ? `\n${user.mobileNumber}` : ''}` : 'GeoMatrix Technologies';
  const planOptions = isSubAdmin ? subscriptionOptions.filter((o: any) => ['Monthly', 'Yearly'].includes(o.value)) : subscriptionOptions;
  const refresh = () => refreshUsers?.();

  const [form, setForm] = useState<any>(null);
  const [initialPassword, setInitialPassword] = useState('');
  const [passwordIsHashed, setPasswordIsHashed] = useState(false);
  const [editableFields, setEditableFields] = useState({ userName: false, email: false, password: false, mobile: false });
  const [tehsilOptions, setTehsilOptions] = useState<any[]>([]);
  const [tehsilFilter, setTehsilFilter] = useState('');
  const [tehsilAssignments, setTehsilAssignments] = useState<Assignment[]>([]);
  const [activeTehsil, setActiveTehsil] = useState('');
  const [selectedTehsil, setSelectedTehsil] = useState('');
  const [mauzaOptions, setMauzaOptions] = useState<string[]>([]);
  const [selectedMauzas, setSelectedMauzas] = useState<string[]>([]);
  const [mauzaFilter, setMauzaFilter] = useState('');
  const [msg, setMsg] = useState<{ type: any; text: string } | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>(initialTab);
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({ profile: false, subscription: false, access: false });
  const [saving, setSaving] = useState(false);
  const [renewProof, setRenewProof] = useState(EMPTY_PROOF);
  const [attachingProof, setAttachingProof] = useState(false);
  const [proofMsg, setProofMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [proofRefresh, setProofRefresh] = useState(0);
  const [mouzaLoading, setMouzaLoading] = useState(false);
  const [ipPeriod, setIpPeriod] = useState('30');
  const [pwInfo, setPwInfo] = useState<PasswordResetInfo | null>(null);
  const mauzaFilterRef = useRef<HTMLInputElement>(null);
  const originalUserRef = useRef<any>(null);

  /* ---------- Row of profile actions ---------- */
  const handleLoginAs = async () => {
    try {
      await loginAs(userId);
    } catch {
      dialog.alert('Failed to login as user.');
    }
  };

  const resetAndCopy = async (withQuickLink: boolean) => {
    if (!form) return;
    try {
      const info = await resetPasswordAndCopy(form.userId || userId, { userName: form.userName, signOff, withQuickLink });
      setForm((prev: any) => ({ ...prev, password: info.password }));
      setInitialPassword(info.password);
      setPasswordIsHashed(false);
      setPwInfo(info);
    } catch (err: any) {
      dialog.alert('Failed to reset the password: ' + errMsg(err));
    }
  };

  const handleCreateDemoLink = async () => {
    const input = await dialog.prompt('Enter demo access duration in days (e.g. 2 for two days):', { defaultValue: '1', type: 'number' });
    if (input === null) return;
    const days = Number(input);
    if (!Number.isFinite(days) || days <= 0) {
      dialog.alert('Please provide a valid positive number of days.');
      return;
    }
    const expiresInMinutes = Math.round(days * 24 * 60);
    try {
      const { data } = await api.post(`/api/users/${userId}/demo-links`, { expiresInMinutes });
      const token = data?.token;
      let shareLink = data?.url || '';
      if (token) {
        try {
          const apiOrigin = new URL(apiBase()).origin;
          shareLink = `${apiOrigin.replace(/\/$/, '')}/demo-access/${encodeURIComponent(token)}`;
        } catch {
          shareLink = data?.url || `${window.location.origin.replace(/\/$/, '')}/demo/${encodeURIComponent(token)}`;
        }
      }
      if (shareLink) {
        await copyToClipboard(shareLink);
        dialog.alert(<span className="whitespace-pre-wrap break-all">{`Demo link created and copied to clipboard:\n${shareLink}`}</span>);
      } else {
        dialog.alert('Demo link created.');
      }
    } catch {
      dialog.alert('Failed to create demo link.');
    }
  };

  const handleDeleteUser = async () => {
    if (!(await dialog.confirm(`Are you sure you want to delete user ${userId}?`, { variant: 'danger', okLabel: 'Delete' }))) return;
    try {
      setSaving(true);
      await api.delete(`/api/users/${userId}`);
      toast.success('User deleted successfully.');
      handleClose();
      refresh();
    } catch (err: any) {
      dialog.alert(err.response?.data?.message || 'Failed to delete user.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMouzas = async () => {
    try {
      const header = `Total Tehsil Access=${tehsilAssignments.length}\nTotal No. of Mouza=${sumMouzas(tehsilAssignments)}\n`;
      const sections = tehsilAssignments.map((entry) => {
        const lines = Array.isArray(entry.mouzas) ? entry.mouzas.map((m, i) => `${i + 1}. ${m}`).join('\n') : '';
        return `\n${entry.tehsil}\nNo. of mouza=${Array.isArray(entry.mouzas) ? entry.mouzas.length : 0}\n${lines}`;
      });
      const ok = await copyToClipboard(header + sections.join('\n'));
      if (!ok) throw new Error('Clipboard unavailable');
      toast.success('Mouza list copied to clipboard!');
    } catch (err: any) {
      toast.error('Failed to copy mouza list: ' + err.message);
    }
  };

  /* ---------- Payment proof ---------- */
  const proofHiddenReason = (() => {
    if (!form) return null;
    const plan = String(form.subscriptionType || '');
    if (/trial/i.test(plan)) return 'Trial selected: no payment, so no payment proof is needed.';
    if (plan === 'Permanent') return null;
    const days = calculateDaysRemaining(form.startDate, plan);
    if (Number.isFinite(days) && days <= 0) {
      return 'With this start date and plan the subscription is already expired, so nothing is activated: no payment proof, and it is not counted as a renewal or revenue.';
    }
    return null;
  })();

  const attachProofToLastRenewal = async () => {
    if (!hasProof(renewProof)) {
      setProofMsg({ ok: false, text: 'Add a screenshot or paste the payment SMS first, then click Attach.' });
      return;
    }
    setAttachingProof(true);
    setProofMsg(null);
    try {
      await uploadPaymentProof({ kind: 'renewal', userId, proof: renewProof, attachToLatest: true });
      setRenewProof(EMPTY_PROOF);
      setProofRefresh((x) => x + 1);
      setProofMsg({ ok: true, text: 'Proof attached to the last renewal. No new renewal was recorded.' });
    } catch (err: any) {
      setProofMsg({ ok: false, text: errMsg(err) || 'Could not attach the proof.' });
    } finally {
      setAttachingProof(false);
    }
  };

  useEffect(() => {
    fetchTehsils().then((list) => setTehsilOptions(isSubAdmin ? withoutAkar(list || []) : list || []));
  }, []);  

  /* ---------- Pending mouza change request ---------- */
  const [reloadTick, setReloadTick] = useState(0);
  const [changeReq, setChangeReq] = useState<any>(null);
  const [reqFee, setReqFee] = useState('');
  const [reqPlan, setReqPlan] = useState('Monthly');
  const [reqPlanFee, setReqPlanFee] = useState('');
  const [reqReduction, setReqReduction] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [MOUZA_INVOICES, setMouzaInvoices] = useState(false);
  useEffect(() => {
    if (!userId) return;
    api.get(`/api/assignment-requests/user/${encodeURIComponent(userId)}`)
      .then((r) => {
        setChangeReq(r.data?.request || null);
        setMouzaInvoices(r.data?.invoicesEnabled === true);
        setReqFee(''); setReqPlanFee(''); setReqReduction(''); setReqNote('');
      })
      .catch(() => setChangeReq(null));
  }, [userId, reloadTick]);

  const decideChange = async (action: 'approve' | 'confirm' | 'reject') => {
    if (!changeReq) return;
    const nAdd = (changeReq.toAdd || []).reduce((s: number, e: any) => s + (e.mouzas?.length || 0), 0);
    const trial = ['Trial', 'Trial24'].includes(form?.subscriptionType);
    if (action === 'approve' && !MOUZA_INVOICES && reqFee === '') { setMsg({ type: 'warning', text: 'Enter the fee for this change (0 if free) before approving.' }); return; }
    if (action === 'approve' && MOUZA_INVOICES && nAdd > 0 && reqFee === '') { setMsg({ type: 'warning', text: 'Enter the monthly price of the added mouzas (0 if free).' }); return; }
    if (action === 'approve' && MOUZA_INVOICES && nAdd > 0 && trial && reqPlanFee === '') { setMsg({ type: 'warning', text: 'Trial customer: enter the subscription fee of the plan.' }); return; }
    if (action === 'reject' && !(await dialog.confirm(changeReq.status === 'invoiced' ? 'Cancel this invoice and reject the request?' : 'Reject this mouza change request?', { variant: 'danger' }))) return;
    setReqBusy(true);
    try {
      const path = { approve: 'approve', confirm: 'confirm-payment', reject: 'reject' }[action];
      const body = action === 'approve' && !MOUZA_INVOICES
        ? { fee: Number(reqFee), note: reqNote }
        : action === 'approve'
          ? { monthlyPrice: reqFee === '' ? 0 : Number(reqFee), plan: reqPlan, planFee: reqPlanFee === '' ? 0 : Number(reqPlanFee), feeReduction: reqReduction === '' ? 0 : Number(reqReduction), note: reqNote }
          : action === 'confirm' ? { paymentRef: reqNote } : { reason: reqNote };
      const { data } = await api.post(`/api/assignment-requests/${changeReq._id}/${path}`, body);
      refresh();
      if (data.invoiceText) {
        try { await navigator.clipboard.writeText(data.invoiceText); data.message += ' Invoice text copied for WhatsApp.'; } catch { /* ignore */ }
      }
      if (action === 'confirm' || (action === 'approve' && data.request?.status === 'approved')) {
        toast.success(data.message);
        handleClose();
        return;
      }
      setMsg({ type: 'success', text: data.message });
      setReloadTick((x) => x + 1);
    } catch (e: any) {
      setMsg({ type: 'danger', text: errMsg(e) });
    } finally {
      setReqBusy(false);
    }
  };

  /* ---------- Load user ---------- */
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { data: u } = await api.get(`/api/users/${userId}`);
        originalUserRef.current = u;
        const assignments: Assignment[] = Array.isArray(u.tehsilAccess) && u.tehsilAccess.length
          ? u.tehsilAccess
            .map((entry: any) => ({ tehsil: entry.tehsil, mouzas: normalizeMauzas(Array.isArray(entry.mouzas) ? entry.mouzas : []), tempGrants: Array.isArray(entry.tempGrants) ? entry.tempGrants : [] }))
            .filter(({ tehsil }: any) => tehsil)
          : typeof u.tehsil === 'string' && u.tehsil
            ? [{ tehsil: u.tehsil, mouzas: normalizeMauzas(Array.isArray(u.mauzaList) ? u.mauzaList : []) }]
            : [];

        const startDate = u.startDate && !Number.isNaN(Date.parse(u.startDate)) ? new Date(u.startDate).toISOString().split('T')[0] : '';
        const endDate = startDate && u.subscriptionType ? calculateEndDate(startDate, u.subscriptionType) : null;
        const computedEnd = endDate ? new Date(endDate).toISOString().split('T')[0] : '';
        const status = u.status === 'Pending' ? 'Pending' : startDate && u.subscriptionType ? calculateStatus(endDate, u.subscriptionType) : u.status || 'Unknown';
        const currentPassword = typeof u.password === 'string' ? u.password : '';
        setInitialPassword(currentPassword);
        setPasswordIsHashed(Boolean(u.passwordIsHashed));
        setForm({
          userName: u.userName || '', userId: u.userId || '', email: u.email || '', password: currentPassword,
          mobile: u.mobileNumber || '', startDate, subscriptionType: u.subscriptionType || '', endDate: computedEnd, status,
          fee: u.fee ?? 1000, renewalHistory: u.renewalHistory || [], ipMisuse: u.ipMisuse || null,
        });
        setTehsilAssignments(assignments);
        const initialTehsil = assignments.find(({ tehsil }) => tehsil === u.activeTehsil)?.tehsil || assignments[0]?.tehsil || '';
        setActiveTehsil(initialTehsil);
        setSelectedTehsil(initialTehsil);
        setSelectedMauzas(assignments.find(({ tehsil }) => tehsil === initialTehsil)?.mouzas || []);
      } catch {
        setMsg({ type: 'danger', text: 'Failed to load user details.' });
      }
    })();
  }, [userId, reloadTick]);

  /* ---------- Known mouzas (localStorage geo_known_mouzas_{user}_{tehsil}) ---------- */
  const tehsilAssignmentsRef = useRef(tehsilAssignments);
  const knownMouzasMapRef = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    tehsilAssignmentsRef.current = tehsilAssignments;
    tehsilAssignments.forEach((entry) => {
      if (!entry.tehsil || !Array.isArray(entry.mouzas)) return;
      if (!knownMouzasMapRef.current.has(entry.tehsil)) {
        let initialSet: string[] = [];
        if (userId) {
          try {
            const raw = localStorage.getItem(`geo_known_mouzas_${userId}_${entry.tehsil}`);
            if (raw) initialSet = JSON.parse(raw);
          } catch {}
        }
        knownMouzasMapRef.current.set(entry.tehsil, new Set(initialSet));
      }
      const set = knownMouzasMapRef.current.get(entry.tehsil)!;
      entry.mouzas.forEach((m) => m && set.add(m));
      if (userId && set.size > 0) {
        try { localStorage.setItem(`geo_known_mouzas_${userId}_${entry.tehsil}`, JSON.stringify(Array.from(set))); } catch {}
      }
    });
  }, [tehsilAssignments, userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedTehsil) { if (!cancelled) setMauzaOptions([]); return; }
      try {
        setMouzaLoading(true);
        const list = await fetchMauzas(selectedTehsil);
        if (cancelled) return;
        const existing = normalizeMauzas(tehsilAssignmentsRef.current.find((e) => e.tehsil === selectedTehsil)?.mouzas || []);
        let storedKnown: string[] = [];
        if (userId) {
          try {
            const raw = localStorage.getItem(`geo_known_mouzas_${userId}_${selectedTehsil}`);
            if (raw) storedKnown = JSON.parse(raw);
          } catch {}
        }
        const refKnown = Array.from(knownMouzasMapRef.current.get(selectedTehsil) || []);
        const allKnown = uniqSort([...existing, ...storedKnown, ...refKnown]);
        if (!knownMouzasMapRef.current.has(selectedTehsil)) knownMouzasMapRef.current.set(selectedTehsil, new Set());
        const cur = knownMouzasMapRef.current.get(selectedTehsil)!;
        uniqSort([...list, ...allKnown]).forEach((m: string) => cur.add(m));
        setMauzaOptions(uniqSort([...uniqSort(list), ...allKnown]));
      } catch {
        if (!cancelled) setMsg({ type: 'danger', text: `Failed to load mouzas for ${selectedTehsil}` });
      } finally {
        if (!cancelled) setMouzaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTehsil, userId]);

  useEffect(() => {
    if (!selectedTehsil) return;
    const normalized = normalizeMauzas(selectedMauzas);
    setTehsilAssignments((prev) => {
      const existing = prev.find((e) => e.tehsil === selectedTehsil);
      if (existing) {
        if (arraysEqual(existing.mouzas, normalized)) return prev;
        return prev.map((e) => (e.tehsil === selectedTehsil ? { ...e, mouzas: normalized } : e));
      }
      return [...prev, { tehsil: selectedTehsil, mouzas: normalized }];
    });
  }, [selectedTehsil, selectedMauzas]);

  useEffect(() => {
    if (!tehsilAssignments.length) { if (activeTehsil) setActiveTehsil(''); return; }
    if (!activeTehsil || !tehsilAssignments.some((t) => t.tehsil === activeTehsil)) setActiveTehsil(tehsilAssignments[0].tehsil);
  }, [tehsilAssignments, activeTehsil]);

  useEffect(() => {
    if (!form?.startDate || !form?.subscriptionType) return;
    const endDate = calculateEndDate(form.startDate, form.subscriptionType);
    const computedEnd = endDate ? new Date(endDate).toISOString().split('T')[0] : '';
    const status = calculateStatus(endDate, form.subscriptionType);
    setForm((prev: any) => ({ ...prev, endDate: computedEnd, status }));
  }, [form?.startDate, form?.subscriptionType]);

  const handleChange = (field: string, value: any) => {
    const formatted = field === 'mobile' ? formatPhoneNumber(value) : value;
    setForm((prev: any) => ({ ...prev, [field]: formatted }));
  };
  const handlePasswordChange = (value: string) => {
    setForm((prev: any) => ({ ...prev, password: value }));
    if (passwordIsHashed) setPasswordIsHashed(false);
  };

  const handleTehsilSelect = (tehsil: string) => {
    setSelectedTehsil(tehsil);
    setMauzaFilter('');
    const existing = tehsilAssignments.find((t) => t.tehsil === tehsil);
    setSelectedMauzas(existing ? normalizeMauzas(existing.mouzas) : []);
  };

  const handleMauzaToggle = (mauza: string) => {
    const isUnselecting = selectedMauzas.includes(mauza);
    setSelectedMauzas((prev) => (prev.includes(mauza) ? prev.filter((x) => x !== mauza) : [...prev, mauza]));
    if (isUnselecting) {
      setTehsilAssignments((prev) => prev.map((e) => (e.tehsil === selectedTehsil ? { ...e, tempGrants: Array.isArray(e.tempGrants) ? e.tempGrants.filter((g) => g.mouza !== mauza) : [] } : e)));
    }
    setMauzaFilter('');
    setTimeout(() => mauzaFilterRef.current?.focus(), 0);
  };

  const handleTempGrant = (mauza: string, durationDays: number | null) => {
    setTehsilAssignments((prev) => {
      const existing = prev.find((e) => e.tehsil === selectedTehsil);
      if (!existing) return prev;
      let tempGrants = existing.tempGrants ? existing.tempGrants.map((g) => ({ ...g })) : [];
      if (!durationDays) {
        tempGrants = tempGrants.filter((g) => g.mouza !== mauza);
      } else {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + durationDays);
        const i = tempGrants.findIndex((g) => g.mouza === mauza);
        if (i >= 0) tempGrants[i].expiresAt = expiresAt;
        else tempGrants.push({ mouza: mauza, expiresAt });
        if (!selectedMauzas.includes(mauza)) setSelectedMauzas((pm) => [...pm, mauza]);
      }
      return prev.map((e) => (e.tehsil === selectedTehsil ? { ...e, tempGrants } : e));
    });
  };

  const selectAllMauzas = () => setSelectedMauzas(normalizeMauzas(mauzaOptions));
  const clearAllMauzas = () => {
    setSelectedMauzas([]);
    setTehsilAssignments((prev) => prev.map((e) => (e.tehsil === selectedTehsil ? { ...e, tempGrants: [] } : e)));
  };
  const handleRemoveAssignment = (tehsil: string) => {
    setTehsilAssignments((prev) => prev.filter((e) => e.tehsil !== tehsil));
    if (selectedTehsil === tehsil) {
      setSelectedTehsil('');
      setSelectedMauzas([]);
      setMauzaOptions([]);
    }
  };
  const handleEditAssignment = (tehsil: string) => {
    setSelectedTehsil(tehsil);
    const existing = tehsilAssignments.find((t) => t.tehsil === tehsil);
    setSelectedMauzas(existing ? normalizeMauzas(existing.mouzas) : []);
    setMauzaFilter('');
    setSelectedTab('access');
  };

  /* ---------- Save ---------- */
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setMsg(null);
    const errors = { profile: false, subscription: false, access: false };
    const fail = (tab: 'profile' | 'subscription' | 'access', text: string) => {
      errors[tab] = true;
      setMsg({ type: 'danger', text });
      setValidationErrors(errors);
      setSelectedTab(tab);
    };
    if (!form.userName || !form.mobile) return fail('profile', 'Please fill in all required profile fields.');
    if (!form.startDate || !form.subscriptionType || !form.fee) return fail('subscription', 'Please fill in all required subscription fields.');
    const assignments = tehsilAssignments
      .map((entry) => ({ tehsil: entry.tehsil, mouzas: normalizeMauzas(entry.mouzas), tempGrants: Array.isArray(entry.tempGrants) ? entry.tempGrants : [] }))
      .filter(({ tehsil }) => tehsil);
    if (!assignments.length) return fail('access', 'Assign at least one tehsil and mouzas to the user.');
    const empty = assignments.find(({ mouzas }) => mouzas.length === 0);
    if (empty) return fail('access', `Select at least one mouza for ${empty.tehsil}.`);
    setValidationErrors(errors);

    const primaryTehsil = assignments.some(({ tehsil }) => tehsil === activeTehsil) ? activeTehsil : assignments[0].tehsil;
    const payload: any = {
      userName: form.userName, email: form.email, password: form.password, mobileNumber: form.mobile,
      startDate: form.startDate, subscriptionType: form.subscriptionType, fee: Number(form.fee),
      tehsilAccess: assignments, activeTehsil: primaryTehsil,
    };
    if (!payload.email || !payload.email.trim()) delete payload.email;
    if (!payload.password || !payload.password.trim() || payload.password === initialPassword) delete payload.password;
    if (payload.mobileNumber === '+92' || !payload.mobileNumber) delete payload.mobileNumber;

    // WhatsApp message (byte-exact with legacy, en-GB dates) copied silently when subscription or mouzas changed.
    const orig = originalUserRef.current;
    const subscriptionChanged = orig && (orig.subscriptionType !== payload.subscriptionType || orig.startDate !== payload.startDate);
    const flat = (list: any) => {
      if (!Array.isArray(list)) return [] as string[];
      const out: string[] = [];
      list.forEach((entry: any) => { if (Array.isArray(entry.mouzas)) entry.mouzas.forEach((m: string) => out.push(`${entry.tehsil} - ${m}`)); });
      return out;
    };
    const oldFlat = flat(orig?.tehsilAccess);
    const newFlat = flat(payload.tehsilAccess);
    const added = newFlat.filter((m) => !oldFlat.includes(m));
    const removed = oldFlat.filter((m) => !newFlat.includes(m));
    const mouzaAccessChanged = added.length > 0 || removed.length > 0;

    if (subscriptionChanged || mouzaAccessChanged) {
      const parts: string[] = [];
      const currentEnd = form.endDate ? new Date(form.endDate).toLocaleDateString('en-GB') : 'N/A';
      if (subscriptionChanged) {
        const daysRemaining = calculateDaysRemaining(payload.startDate, payload.subscriptionType);
        const todayStr = new Date().toLocaleDateString('en-GB');
        let sub = `Your subscription is renewed on *${todayStr}*.\n`;
        sub += `Subscription Details:\n`;
        sub += `- Type: *${payload.subscriptionType}*\n`;
        sub += `- Total Mouzas: *${newFlat.length}*\n`;
        sub += `- End Date: *${currentEnd}*\n`;
        sub += `- Days Remaining: *${daysRemaining}* days`;
        if (payload.subscriptionType.toLowerCase().includes('trial')) sub += `\n\nPlease pay the subscription fee within 1 day to keep using the services.`;
        parts.push(sub);
      }
      if (mouzaAccessChanged) {
        let mp = `Your mouza access has been updated.\n`;
        mp += `- Current Mouzas: *${oldFlat.length}*\n`;
        mp += `- Removed Mouzas: *${removed.map((m) => m.split(' - ')[1]).join(', ') || 'None'}*\n`;
        mp += `- Added Mouzas: *${added.map((m) => m.split(' - ')[1]).join(', ') || 'None'}*\n`;
        mp += `- Total Mouzas after editing: *${newFlat.length}*\n`;
        mp += `- Expiry Date: *${currentEnd}*`;
        parts.push(mp);
      }
      let full = `Dear *${payload.userName}*,\n`;
      full += `User ID: *${userId}*\n\n`;
      full += parts.join('\n\n') + '\n\n';
      const ipCount = orig?.ipMisuse?.count30 || orig?.ipCount30 || 0;
      if (ipCount >= 5 && !payload.subscriptionType?.toLowerCase().includes('trial')) {
        full += `- No of devices used in 30 Days: *${ipCount}*\n`;
        full += `⚠️ Warning: Using the service on multiple devices violates the terms and your account may be flagged and permanently blocked if not complied with the terms.\n\n`;
      }
      full += `Thanks,\n*${signOff}*`;
      copyToClipboard(full);
    }

    try {
      setSaving(true);
      await api.put(`/api/users/${userId}`, payload);
      if (subscriptionChanged && !proofHiddenReason && hasProof(renewProof)) {
        try {
          await uploadPaymentProof({ kind: 'renewal', userId, proof: renewProof });
        } catch (proofErr: any) {
          await dialog.alert(`Subscription saved, but the payment proof could not be attached: ${errMsg(proofErr)}`);
        }
      }
      refresh();
      if (user && user.userId === userId) await fetchUserProfile();
      handleClose();
    } catch (error: any) {
      const d = error.response?.data;
      let text = `Failed to update: ${error.message}`;
      if (d) {
        if (d.error === 'Validation failed' && Array.isArray(d.errors)) text = d.errors.map((x: any) => x.msg).join(', ');
        else if (d.message) text = d.message;
        else if (d.error) text = d.error;
      }
      setMsg({ type: 'danger', text });
      setSaving(false);
    }
  };

  const activatePending = async () => {
    try {
      setSaving(true);
      const { data } = await api.post(`/api/subscriptions/${userId}/activate`, { type: form.subscriptionType || 'Monthly' });
      setForm((prev: any) => ({
        ...prev,
        status: data.subscription.status,
        startDate: data.subscription.startDate ? data.subscription.startDate.split('T')[0] : prev.startDate,
        endDate: data.subscription.endDate ? data.subscription.endDate.split('T')[0] : '',
      }));
      setMsg({ type: 'success', text: 'User activated successfully.' });
      refresh();
      setSaving(false);
    } catch (err: any) {
      setSaving(false);
      setMsg({ type: 'danger', text: err.response?.data?.message || 'Failed to activate user.' });
    }
  };

  /* ---------- Render ---------- */
  const modalCls = 'sm:max-w-[580px] max-sm:inset-0 max-sm:top-[42px] max-sm:rounded-none max-sm:border-0';
  if (loading || !form) {
    return (
      <Modal show onHide={handleClose} size="lg" className={modalCls} title="Edit User:">
        {msg ? <Alert variant={msg.type}>{msg.text}</Alert> : <PageSpinner label="Loading…" />}
      </Modal>
    );
  }

  const ipCount = form.ipMisuse?.count30 || 0;
  const totalMouzas = sumMouzas(tehsilAssignments);
  const subTabStyle = (() => {
    const daysRem = calculateDaysRemaining(form.startDate, form.subscriptionType);
    const status = form.status || calculateStatus(form.endDate, form.subscriptionType);
    if (status === 'Expired' || daysRem <= 0) return { background: '#f8d7da', color: '#842029', borderColor: '#f5c2c7', fontWeight: 700 };
    if (daysRem <= 2) return { background: '#fff3cd', color: '#664d03', borderColor: '#ffecb5', fontWeight: 700 };
    return { background: '#d1e7dd', color: '#0f5132', borderColor: '#badbcc', fontWeight: 700 };
  })();
  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'subscription', label: 'Subscription', icon: '💳' },
    { id: 'access', label: 'Access', icon: '🔐' },
    { id: 'multiuse', label: 'Multi-Use Info', icon: '🌐' },
  ].filter((t) => !(isSubAdmin && t.id === 'multiuse'));
  const actionBtn = 'btn btn-sm h-7 w-full !gap-1 !px-2 !py-1 !text-[0.72rem] !font-semibold max-sm:h-9';

  return (
    <>
      <Modal show onHide={handleClose} size="lg" id="user-edit-modal" scrollable={false}
        className={cn(modalCls, 'user-edit-modal sm:h-[min(90vh,calc(100dvh-58px))]')}
        title={<span className="text-[1.15rem] max-sm:text-base">Edit User: {form.userName || ''}</span>}
        bodyClassName="!p-0 flex flex-col overflow-hidden">
        {msg && <Alert variant={msg.type} className="m-2 mb-0 shrink-0 !px-3 !py-2" onClose={() => setMsg(null)}>{msg.text}</Alert>}
        {changeReq && (
          <ChangeRequestPanel
            changeReq={changeReq} form={form} isSubAdmin={isSubAdmin} invoices={MOUZA_INVOICES} busy={reqBusy} decide={decideChange}
            reqFee={reqFee} setReqFee={setReqFee} reqPlan={reqPlan} setReqPlan={setReqPlan} reqPlanFee={reqPlanFee} setReqPlanFee={setReqPlanFee}
            reqReduction={reqReduction} setReqReduction={setReqReduction} reqNote={reqNote} setReqNote={setReqNote} />
        )}
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="user-detail-tabs-container sticky top-0 z-10 shrink-0 border-b border-[#e2e8f0] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
            <div className="tab-navigation flex gap-1 overflow-x-auto px-2 pt-1.5 max-md:grid max-md:grid-cols-2 max-md:gap-1.5 max-md:bg-[#f8fafc] max-md:p-1.5">
              {tabs.map((tab) => {
                const active = selectedTab === tab.id;
                const err = validationErrors[tab.id];
                return (
                  <button key={tab.id} type="button"
                    className={cn(
                      'user-list-tab tab-nav-item inline-flex flex-[1_1_auto] items-center justify-center gap-0.5 whitespace-nowrap rounded-md border border-[rgba(0,150,180,0.6)] bg-white px-1 py-[0.35rem] text-[0.65rem] font-medium text-[#64748b] transition-all hover:border-[rgba(0,150,180,0.85)] hover:bg-[#f1f5f9] hover:text-[#0ea5e9]',
                      'max-md:min-h-9 max-md:w-full max-md:border-[#cbd5e1] max-md:px-1 max-md:py-2 max-md:text-[0.75rem]',
                      active && '!border-[#0ea5e9] !bg-[#e0f2fe] !text-[#0ea5e9] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.05)]',
                      err && 'has-error !border-[#fca5a5] !text-[#ef4444]',
                      active && 'active',
                    )}
                    style={tab.id === 'subscription' && !err ? subTabStyle : undefined}
                    onClick={() => {
                      setSelectedTab(tab.id);
                      if (err) { setValidationErrors((p) => ({ ...p, [tab.id]: false })); setMsg(null); }
                    }}>
                    <span className="tab-icon text-[0.7rem]">{tab.icon}</span>
                    <span>{tab.label}</span>
                    {tab.id === 'access' && <Badge bg="success" className="ml-0.5 !rounded !px-1 !py-0.5 !text-[0.55rem]">{tehsilAssignments.length}</Badge>}
                    {tab.id === 'multiuse' && (
                      <Badge bg={ipCount > 3 ? (ipCount >= 8 ? 'danger' : 'warning') : 'success'} className={cn('ml-0.5 !rounded !px-1 !py-0.5 !text-[0.55rem]', ipCount > 3 && ipCount < 8 ? '!text-black' : '!text-white')}>{ipCount}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedTab === 'profile' && (
              <div className={cn('mt-2 mb-2 grid gap-2 px-1', isSubAdmin ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
                <button type="button" className={cn(actionBtn, 'btn-outline-success')} onClick={handleLoginAs}><LogIn size={14} color="#28a745" /><span>Login As</span></button>
                <button type="button" className={cn(actionBtn, 'btn-outline-secondary')} onClick={() => resetAndCopy(true)}><KeyRound size={14} color="#fd7e14" /><span>Quick Login</span></button>
                <button type="button" className={cn(actionBtn, 'btn-outline-secondary')} onClick={handleCreateDemoLink}><Link2 size={14} color="#0d6efd" /><span>Demo Link</span></button>
                {!isSubAdmin && (
                  <button type="button" className={cn(actionBtn, 'btn-outline-info')} onClick={() => { handleClose(); navigate(`/users/${userId}`); }}><Eye size={14} color="#17a2b8" /><span>View Details</span></button>
                )}
                <button type="button" className={cn(actionBtn, 'btn-outline-primary')} onClick={handleCopyMouzas}><Copy size={14} color="#6f42c1" /><span>Copy Mouzas</span></button>
                {!isSubAdmin && (
                  <button type="button" className={cn(actionBtn, 'btn-outline-danger')} onClick={handleDeleteUser}><Trash2 size={14} color="#dc3545" /><span>Delete User</span></button>
                )}
              </div>
            )}
          </div>

          <div className="tab-content-wrapper min-h-0 flex-1 overflow-y-auto px-4 py-2.5 max-sm:px-2">
            {selectedTab === 'profile' && (
              <ProfileSection form={form} handleChange={handleChange} editableFields={editableFields} setEditableFields={setEditableFields}
                handlePasswordChange={handlePasswordChange} passwordIsHashed={passwordIsHashed} userType={userType} />
            )}
            {selectedTab === 'subscription' && (
              <>
                <SubscriptionSection form={form} handleChange={handleChange} subscriptionOptions={planOptions} />
                {proofHiddenReason ? (
                  <div className="mt-2 text-sm italic text-ink-2"><Info size={13} className="mr-1 inline" />{proofHiddenReason}</div>
                ) : (
                  <div className="mt-2">
                    <PaymentProofInput value={renewProof} onChange={setRenewProof} compact disabled={attachingProof} />
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[0.72rem] text-ink-2">Renewing now? It is attached when you save. Proof for a renewal already done? Use the button, no new renewal is made.</div>
                      <Button size="sm" variant="outline-info" disabled={attachingProof} onClick={attachProofToLastRenewal} title="Save this proof to the customer's latest renewal without renewing again">
                        {attachingProof ? 'Saving…' : <><Paperclip size={12} />Attach to last renewal</>}
                      </Button>
                    </div>
                    {proofMsg && <div className={cn('mt-1 text-sm', proofMsg.ok ? 'text-[#10b981]' : 'text-[#dc3545]')}>{proofMsg.text}</div>}
                  </div>
                )}
                <RenewalProofList userId={userId} refreshKey={proofRefresh} />
              </>
            )}
            {selectedTab === 'access' && (
              <AccessSection tehsilAssignments={tehsilAssignments} selectedTehsil={selectedTehsil} selectedMauzas={selectedMauzas} mauzaOptions={mauzaOptions}
                tehsilOptions={tehsilOptions} allowTemp tehsilFilter={tehsilFilter} setTehsilFilter={setTehsilFilter} mauzaFilter={mauzaFilter}
                setMauzaFilter={setMauzaFilter} mouzaLoading={mouzaLoading} form={form} handleTehsilSelect={handleTehsilSelect}
                handleMauzaToggle={handleMauzaToggle} handleTempGrant={handleTempGrant} selectAllMauzas={selectAllMauzas} clearAllMauzas={clearAllMauzas}
                handleRemoveAssignment={handleRemoveAssignment} handleEditAssignment={handleEditAssignment} mauzaFilterRef={mauzaFilterRef} />
            )}
            {selectedTab === 'multiuse' && <MultiUseSection form={form} ipPeriod={ipPeriod} setIpPeriod={setIpPeriod} userId={userId} />}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#dee2e6] bg-[#f8f9fa] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <div className="text-[0.75rem] font-bold text-ink-2">
              <span className="mr-3">No of Tehsil={tehsilAssignments.length}</span>
              <span>Total No of Mouza={totalMouzas}</span>
            </div>
            <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
              {form.status === 'Pending' && selectedTab === 'subscription' && (
                <button type="button" className="btn btn-success !border-[#13653f] !bg-[#146c43] !text-white" disabled={saving} onClick={activatePending}>
                  {saving ? 'Activating...' : 'Activate User'}
                </button>
              )}
              <Button type="submit" variant="primary" disabled={saving} loading={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
              <Button variant="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
            </div>
          </div>
        </form>
      </Modal>
      <PasswordCopiedModal info={pwInfo} onHide={() => setPwInfo(null)} />
    </>
  );
}

/* ---------- Pending mouza change request panel ---------- */
function ChangeRequestPanel({ changeReq, form, isSubAdmin, invoices, busy, decide, reqFee, setReqFee, reqPlan, setReqPlan, reqPlanFee, setReqPlanFee, reqReduction, setReqReduction, reqNote, setReqNote }: any) {
  const rows = [
    ...(changeReq.toAdd || []).filter((e: any) => e.mouzas?.length).map((e: any) => ({ kind: 'Add', ...e })),
    ...(changeReq.toRemove || []).filter((e: any) => e.mouzas?.length).map((e: any) => ({ kind: 'Remove', ...e })),
  ];
  const nAdd = (changeReq.toAdd || []).reduce((s: number, e: any) => s + (e.mouzas?.length || 0), 0);
  const nRem = (changeReq.toRemove || []).reduce((s: number, e: any) => s + (e.mouzas?.length || 0), 0);
  const trial = ['Trial', 'Trial24'].includes(form?.subscriptionType);
  const inv = changeReq.invoice || {};
  const rsf = (n: any) => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
  const up50 = (n: number) => Math.ceil(Math.max(0, n) / 50) * 50;
  const inp = 'input input-sm !py-1 max-sm:!text-base';
  const btnS = 'btn btn-sm max-sm:min-h-9';

  let body;
  if (changeReq.status === 'invoiced') {
    body = (
      <>
        <div className="mb-1 rounded border border-[#e2c27a] bg-white p-1">
          <strong>Invoice {inv.number}: {rsf(inv.amount)}</strong>
          <span className="text-ink-2"> · due {inv.dueAt ? fmtDate(inv.dueAt) : '—'}</span>
          <div className="text-[0.72rem] text-ink-2">
            {inv.trial ? `${inv.plan} ${rsf(inv.planFee)} + mouzas ${rsf(inv.mouzaFee)}` : `${rsf(inv.monthlyPrice)}/month × ${inv.daysLeft} day(s) ÷ 30`} · new fee {rsf(inv.newFee)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={cn(inp, 'flex-[1_1_160px]')} placeholder="Payment ref / TID (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
          <button type="button" className={cn(btnS, 'btn-success')} disabled={busy} onClick={() => decide('confirm')}><CheckCheck size={13} />Confirm payment</button>
          <button type="button" className={cn(btnS, 'btn-outline-danger')} disabled={busy} onClick={() => decide('reject')}>Cancel invoice</button>
        </div>
        <div className="mt-1 text-[0.7rem] text-ink-2">The mouzas are added only when you confirm the payment{isSubAdmin ? ' (the amount is then added to your bill)' : ''}.</div>
      </>
    );
  } else if (!invoices) {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <input className={cn(inp, 'w-[110px]')} type="number" min="0" placeholder="Fee (Rs)" value={reqFee} onChange={(e) => setReqFee(e.target.value)} />
          <input className={cn(inp, 'flex-[1_1_160px]')} placeholder="Note / payment ref (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
          <button type="button" className={cn(btnS, 'btn-success')} disabled={busy} onClick={() => decide('approve')}><Check size={13} />Approve</button>
          <button type="button" className={cn(btnS, 'btn-outline-danger')} disabled={busy} onClick={() => decide('reject')}>Reject</button>
        </div>
        <div className="mt-1 text-[0.7rem] text-ink-2">Check the customer&apos;s payment, enter the fee (0 if free) and approve; the mouzas change straight away{isSubAdmin ? ' and the fee is added to your bill' : ''}.</div>
      </>
    );
  } else {
    const price = Number(reqFee) || 0;
    const planFee = Number(reqPlanFee) || 0;
    const red = Number(reqReduction) || 0;
    const days = changeReq.daysLeft || 0;
    const mouzaPart = nAdd ? (trial ? (reqPlan === 'Yearly' ? price * 12 : price) : (price * days) / 30) : 0;
    const amount = nAdd ? up50((trial ? planFee : 0) + mouzaPart) : 0;
    const perPeriod = form?.subscriptionType === 'Yearly' ? price * 12 : price;
    const newFee = Math.max(0, (trial && nAdd ? planFee + mouzaPart : (Number(form?.fee) || 0) + (nAdd ? perPeriod : 0)) - red);
    const invoiceMode = amount > 0 || (trial && nAdd);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {nAdd > 0 && <input className={cn(inp, 'w-[160px]')} type="number" min="0" placeholder="Added mouzas Rs/month" value={reqFee} onChange={(e) => setReqFee(e.target.value)} />}
          {nAdd > 0 && trial && (
            <>
              <select className="select select-sm w-[105px] !py-1" value={reqPlan} onChange={(e) => setReqPlan(e.target.value)}><option>Monthly</option><option>Yearly</option></select>
              <input className={cn(inp, 'w-[130px]')} type="number" min="0" placeholder={`${reqPlan} fee (Rs)`} value={reqPlanFee} onChange={(e) => setReqPlanFee(e.target.value)} />
            </>
          )}
          {nRem > 0 && <input className={cn(inp, 'w-[140px]')} type="number" min="0" placeholder="Fee reduction (Rs)" value={reqReduction} onChange={(e) => setReqReduction(e.target.value)} />}
          <input className={cn(inp, 'flex-[1_1_140px]')} placeholder="Note (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
        </div>
        <div className="mt-1 text-[0.75rem]">
          {nAdd > 0
            ? <>Invoice: <strong>{rsf(amount)}</strong> <span className="text-ink-2">({trial ? `${reqPlan} ${rsf(planFee)} + mouzas ${rsf(mouzaPart)}` : `${rsf(price)} × ${days} day(s) ÷ 30`}, rounded up to Rs 50)</span></>
            : <>No charge (removal only).</>}
          {' '}· New subscription fee: <strong>{rsf(newFee)}</strong>
        </div>
        <div className="mt-1 flex gap-2">
          <button type="button" className={cn(btnS, 'btn-success')} disabled={busy} onClick={() => decide('approve')}>
            {invoiceMode ? <FileText size={13} /> : <Check size={13} />}{invoiceMode ? 'Send invoice' : 'Approve'}
          </button>
          <button type="button" className={cn(btnS, 'btn-outline-danger')} disabled={busy} onClick={() => decide('reject')}>Reject</button>
        </div>
        <div className="mt-1 text-[0.7rem] text-ink-2">Additions: the customer gets an invoice (due in 3 days) and the mouzas are added after you confirm the payment. Removals are applied straight away with no refund.</div>
      </>
    );
  }

  return (
    <div className="m-2 mb-0 max-h-[45%] shrink-0 overflow-y-auto rounded-lg border-2 border-[#f59e0b] bg-[#fffbeb] p-2 text-[0.8rem]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <strong><ArrowLeftRight size={13} className="mr-1 inline text-[#f59e0b]" />Pending mouza change request</strong>
        <span className="text-[0.72rem] text-ink-2">{fmtDateTime(changeReq.createdAt)} · {changeReq.daysLeft} day(s) left on {changeReq.plan}</span>
      </div>
      <details className="mb-1">
        <summary className="cursor-pointer font-semibold">
          <span className="text-[#10b981]">+{nAdd} add</span> · <span className="text-[#ef4444]">−{nRem} remove</span> <span className="font-normal text-ink-2">(tap to show mouzas)</span>
        </summary>
        <div className="mt-1 max-h-[28vh] overflow-y-auto rounded-md border border-[#e2c27a] bg-white">
          <table className="w-full border-collapse text-[0.75rem]">
            <thead className="sticky top-0 z-[1] bg-[#fef3c7]">
              <tr>
                <th className="w-[70px] border border-[#dee2e6] px-1 py-0.5 text-left">Change</th>
                <th className="w-[130px] border border-[#dee2e6] px-1 py-0.5 text-left">Tehsil</th>
                <th className="border border-[#dee2e6] px-1 py-0.5 text-left">Mouzas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} style={{ background: r.kind === 'Add' ? '#f0fdf4' : '#fef2f2' }}>
                  <td className={cn('border border-[#dee2e6] px-1 py-0.5 font-bold', r.kind === 'Add' ? 'text-[#10b981]' : 'text-[#ef4444]')}>{r.kind}</td>
                  <td className="border border-[#dee2e6] px-1 py-0.5 font-semibold">{r.tehsil}</td>
                  <td className="border border-[#dee2e6] px-1 py-0.5">{r.mouzas.join(', ')} <span className="text-ink-2">({r.mouzas.length})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {changeReq.note && <div className="mb-1 text-ink-2">Customer: “{changeReq.note}”</div>}
      {body}
    </div>
  );
}
