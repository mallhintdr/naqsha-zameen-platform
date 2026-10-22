// /users — admin user management (legacy components/User/UserList.js).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronsLeft, ChevronLeft, ChevronsRight, Home, Pencil, UserCog, Users, XCircle,
} from 'lucide-react';
import { api, isCancel } from '@/shared/api/client';
import { Alert, Badge, Button, Spinner, cn, useDialog } from '@/shared/ui';
import { fetchTehsils } from '@/shared/lib/mouzaApi';
import { fmtDateTime } from '@/shared/lib/format';
import UserEditForm from './UserEditForm';
import './users.css';

const normalizeMauzas = (list: any[] = []) =>
  Array.from(new Set((Array.isArray(list) ? list : []).map((m) => (typeof m === 'string' ? m.trim() : String(m))).filter(Boolean)));

type Sort = { key?: string; direction?: 'asc' | 'desc' };
const DATED: Record<string, string> = { publicRegistration: 'createdAt', recentlyEdited: 'profileEditedAt' };

const rowStatus = (u: any) =>
  u.status === 'Active' ? 'active' : u.status === 'Pending' ? 'pending' : u.daysRemaining > 0 && u.daysRemaining <= 7 ? 'expiring' : 'expired';
/** Card tints for the phone list (same as the table row colours). */
const CARD_TINT: Record<string, string> = {
  active: 'bg-[rgba(16,185,129,0.12)] border-l-[#10b981]',
  expiring: 'bg-[rgba(245,158,11,0.12)] border-l-[#f59e0b]',
  expired: 'bg-[rgba(239,68,68,0.12)] border-l-[#ef4444]',
  pending: 'bg-[rgba(255,193,7,0.15)] border-l-[#ffc107]',
};
const typeBadge = (t: string) => (t === 'admin' ? 'danger' : t === 'subadmin' ? 'primary' : t === 'demo' ? 'info' : 'secondary') as any;
const daysLabel = (u: any) => (u.subscriptionType === 'Permanent' ? 'Permanent' : u.daysRemaining > 0 ? `${u.daysRemaining} days` : 'Expired');

function MouzaCount({ user }: { user: any }) {
  const access = Array.isArray(user.tehsilAccess) ? user.tehsilAccess : [];
  if (!access.length) return <span className="text-ink-2">—</span>;
  const count = access.reduce((n: number, a: any) => n + (a.mouzas || []).length, 0);
  const whole = access.some((a: any) => !(a.mouzas || []).length);
  const title = access.map((a: any) => `${a.tehsil}: ${(a.mouzas || []).length || 'all'}`).join('\n');
  return (
    <span title={title}>
      <Badge bg={count ? 'primary' : 'secondary'} className="!text-[0.8rem]">{count}</Badge>
      {whole && <span className="ml-1 text-[0.7rem] text-ink-2">+all</span>}
    </span>
  );
}

export default function UserListPage() {
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation();

  const [users, setUsers] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 50;
  const [statistics, setStatistics] = useState<any>({ total: 0, active: 0, expiring: 0, expired: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editInitialTab, setEditInitialTab] = useState('profile');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<Sort>({});
  const [activeTab, setActiveTab] = useState('all');
  const [searchId, setSearchId] = useState('');
  const [debouncedSearchId, setDebouncedSearchId] = useState('');
  const [filterType, setFilterType] = useState('tehsil');
  const [filterValue, setFilterValue] = useState('');
  const [debouncedFilterValue, setDebouncedFilterValue] = useState('');
  const [tehsilOptions, setTehsilOptions] = useState<string[]>([]);
  const [showTehsilDropdown, setShowTehsilDropdown] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [subAdminList, setSubAdminList] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idInputRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const notify = (type: 'success' | 'warning' | 'danger', text: string) =>
    dialog.alert(<span className={cn('font-bold', type === 'danger' ? 'text-[#dc3545]' : 'text-[#10b981]')}>{text}</span>, { title: type === 'danger' ? 'Error' : 'Notification', variant: type === 'danger' ? 'danger' : 'primary', okLabel: 'Close' });

  useEffect(() => {
    fetchTehsils().then((l: any) => setTehsilOptions(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  /* ---------- deep links: ?owner, ?tab, ?activateUserId ---------- */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const ownerParam = params.get('owner');
    if (ownerParam) {
      setFilterType('subadmin');
      setOwnerFilter(ownerParam);
      setCurrentPage(1);
    }
    if (tabParam) {
      setActiveTab(tabParam);
      if (DATED[tabParam]) setSortConfig({ key: DATED[tabParam], direction: 'desc' });
      setCurrentPage(1);
    }
    const activateUserId = params.get('activateUserId');
    if (activateUserId) {
      setEditUserId(activateUserId);
      setEditInitialTab('subscription');
      navigate('/users', { replace: true });
    }
  }, [location.search]);  

  const filterParams = useCallback(() => {
    const p: Record<string, any> = {};
    if (ownerFilter) p.owner = ownerFilter;
    if (filterType === 'tehsil') p.searchTehsil = debouncedFilterValue;
    if (filterType === 'mobileNumber') p.searchPhone = debouncedFilterValue;
    if (filterType === 'email') p.searchEmail = debouncedFilterValue;
    return p;
  }, [ownerFilter, filterType, debouncedFilterValue]);

  /* ---------- fetch (previous request cancelled: race fix) ---------- */
  const fetchUsers = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        limit: usersPerPage,
        tab: activeTab,
        sortKey: sortConfig.key || DATED[activeTab],
        sortDir: sortConfig.direction || (DATED[activeTab] ? 'desc' : undefined),
        searchId: debouncedSearchId,
        ...filterParams(),
      };
      const { data } = await api.get('/api/users', { params, signal: ctrl.signal });
      const list = Array.isArray(data) ? data : data.users || [];
      const enriched = list.map((u: any) => {
        const assignments = Array.isArray(u.tehsilAssignments)
          ? u.tehsilAssignments
          : (Array.isArray(u.tehsilAccess) ? u.tehsilAccess : [])
            .map(({ tehsil, mouzas }: any) => ({ tehsil, mouzas: normalizeMauzas(Array.isArray(mouzas) ? mouzas : []) }))
            .filter(({ tehsil }: any) => tehsil);
        const activeTehsil = u.activeTehsil && assignments.some(({ tehsil }: any) => tehsil === u.activeTehsil) ? u.activeTehsil : assignments[0]?.tehsil || '';
        return {
          ...u,
          tehsilAssignments: assignments,
          activeTehsil,
          tehSummary: assignments.map(({ tehsil }: any) => tehsil).join(', '),
          mauzaList: assignments.find(({ tehsil }: any) => tehsil === activeTehsil)?.mouzas || [],
        };
      });
      setUsers(enriched);
      setStatistics(data.statistics || { total: 0, active: 0, expiring: 0, expired: 0, publicRegistration: 0 });
      if (Array.isArray(data.subAdmins)) setSubAdminList(data.subAdmins);
      if (data.pagination) {
        setTotalPages(data.pagination.pages);
        setTotalFiltered(data.pagination.total);
      }
      setError(null);
      setLoading(false);
    } catch (err) {
      if (isCancel(err)) return;
      setError('Failed to load user data.');
      setLoading(false);
    }
  }, [currentPage, activeTab, debouncedSearchId, sortConfig, filterParams]);

  useEffect(() => {
    fetchUsers();
    return () => abortRef.current?.abort();
  }, [fetchUsers]);

  /* ---------- bulk assign ---------- */
  const handleBulkAssign = async () => {
    if (!selectedIds.length) return;
    const label = assignTarget ? subAdminList.find((s) => s.userId === assignTarget)?.userName || assignTarget : 'yourself (take back)';
    if (!(await dialog.confirm(`Assign ${selectedIds.length} user(s) to ${label}?`, { okLabel: 'Assign' }))) return;
    setAssigning(true);
    try {
      const data = { moved: 0, skipped: [] as string[] };
      for (let i = 0; i < selectedIds.length; i += 500) {
        const { data: part } = await api.post('/api/admin/users/assign', { userIds: selectedIds.slice(i, i + 500), subAdminId: assignTarget || null });
        data.moved += part.moved || 0;
        data.skipped.push(...(part.skipped || []));
      }
      const text = assignTarget
        ? `${data.moved} user(s) assigned to sub-admin ${label} (${assignTarget}).`
        : `${data.moved} user(s) taken back. You now manage them directly.`;
      const extra = data.skipped.length ? ` Skipped: ${data.skipped.join(', ')}.` : '';
      notify(data.skipped.length ? 'warning' : 'success', text + extra);
      setSelectedIds([]);
      fetchUsers();
    } catch (err: any) {
      notify('danger', err.response?.data?.message || 'Assignment failed.');
    } finally {
      setAssigning(false);
    }
  };

  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const base = { tab: activeTab, searchId: debouncedSearchId, limit: 100, ...filterParams() };
      const ids = new Set(selectedIds);
      for (let p = 1; p <= 100; p++) {
        const { data } = await api.get('/api/users', { params: { ...base, page: p } });
        (data.users || []).filter((u: any) => u.userType === 'user').forEach((u: any) => ids.add(u.userId));
        if (p >= (data.pagination?.pages || 1)) break;
      }
      setSelectedIds([...ids]);
    } catch (err: any) {
      notify('danger', err.response?.data?.message || 'Could not select all users.');
    } finally {
      setSelectingAll(false);
    }
  };
  const toggleSelected = (id: string) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /* ---------- filters ---------- */
  const debounce = (fn: () => void) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(fn, 500);
  };
  const handleIdChange = (v: string) => {
    setSearchId(v);
    debounce(() => { setDebouncedSearchId(v); setCurrentPage(1); });
  };
  const handleClearId = () => {
    setSearchId('');
    setDebouncedSearchId('');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setCurrentPage(1);
    idInputRef.current?.focus();
  };
  const handleFilterTypeChange = (type: string) => {
    setFilterType(type);
    if (type !== 'subadmin') setOwnerFilter('');
    setFilterValue('');
    setDebouncedFilterValue('');
    setCurrentPage(1);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  };
  const handleFilterValueChange = (v: string) => {
    setFilterValue(v);
    debounce(() => { setDebouncedFilterValue(v); setCurrentPage(1); });
  };
  const handleClearFilter = () => {
    setFilterValue('');
    setDebouncedFilterValue('');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setCurrentPage(1);
    filterInputRef.current?.focus();
  };
  const noEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); };

  const handleSort = (key: string) =>
    setSortConfig((p) => (p.key === key ? { key, direction: p.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'createdAt' || key === 'profileEditedAt' ? 'desc' : 'asc' }));

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setSortConfig(DATED[tab] ? { key: DATED[tab], direction: 'desc' } : {});
  };

  const handleActivateUser = async (uid: string) => {
    try {
      await api.put(`/api/users/${uid}`, { status: 'Active' });
      notify('success', `User ${uid} activated successfully.`);
      fetchUsers();
    } catch {
      notify('danger', `Failed to activate user ${uid}.`);
    }
  };

  const openEdit = (uid: string) => { setEditInitialTab('profile'); setEditUserId(uid); };

  if (error) return <div className="p-4"><Alert variant="danger">{error}</Alert></div>;

  const isPublic = activeTab === 'publicRegistration';
  const showActions = activeTab === 'pending' || isPublic;
  const pageIds = users.filter((u) => u.userType === 'user').map((u) => u.userId);

  const tabs = [
    { id: 'all', label: 'All Users', icon: <Users />, badge: <Badge bg="secondary">{statistics.total}</Badge> },
    { id: 'recentlyEdited', label: 'Recently Edited', icon: <Pencil />, badge: <Badge bg="info">{statistics.recentlyEdited || 0}</Badge> },
    { id: 'active', label: 'Active', icon: <CheckCircle2 />, badge: <Badge bg="success">{statistics.active}</Badge> },
    { id: 'expiring', label: 'Expiring Soon', icon: <AlertTriangle />, badge: <Badge bg="warning">{statistics.expiring}</Badge> },
    { id: 'expired', label: 'Expired', icon: <XCircle />, badge: <Badge bg="danger">{statistics.expired}</Badge> },
    { id: 'publicRegistration', label: 'Public Registration', icon: <Users />, badge: <Badge bg="warning" className="!bg-[#ff9800] !text-white">{statistics.publicRegistration}</Badge> },
    { id: 'awaitingActivation', label: 'Awaiting Activation', icon: <AlertTriangle />, badge: statistics.awaitingActivation !== undefined && <Badge bg="info">{statistics.awaitingActivation}</Badge> },
    { id: 'unactivated', label: 'Link Expired', icon: <XCircle />, badge: statistics.unactivated !== undefined && <Badge bg="secondary">{statistics.unactivated}</Badge> },
  ];

  const SortTh = ({ k, children, className }: { k: string; children: any; className?: string }) => (
    <th onClick={() => handleSort(k)} className={cn('sortable', className)}>
      <div className="th-content flex items-center justify-center gap-2">
        {children}
        {sortConfig.key === k && <span className="sort-indicator text-[0.75rem] text-[#a855f7]">{sortConfig.direction === 'asc' ? ' ▲' : ' ▼'}</span>}
      </div>
    </th>
  );

  const inputCls = 'input h-9 !rounded-md !border-[rgba(0,150,180,0.65)] !py-1 !text-[0.9rem] !text-teal-ink focus:!border-[#00d4ff] focus:!shadow-[0_0_0_3px_rgba(0,212,255,0.1)] max-sm:!text-base';
  const clearBtn = 'absolute top-1/2 -translate-y-1/2 border-0 bg-transparent p-1 text-[0.9rem] font-bold text-[#dc3545]';

  const activateCell = (u: any) =>
    u.status !== 'Active' && u.status !== 'Trial' ? (
      <button type="button" className="btn btn-success !px-2 !py-0.5 !text-[0.8rem] !font-bold max-sm:min-h-9" onClick={(e) => { e.stopPropagation(); handleActivateUser(u.userId); }}>Activate</button>
    ) : (
      <span className="text-[0.8rem] font-medium text-ink-2">Activated</span>
    );

  return (
    <div className="user-list-container flex min-h-[calc(100dvh-42px)] flex-col overflow-y-auto bg-white p-6 text-teal-ink max-md:p-3">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-[#dee2e6] pb-2">
        <h3 className="m-0 text-[1.75rem] font-bold text-[#0A2540] max-sm:text-[1.3rem]">User Management</h3>
        <Button variant="outline-primary" onClick={() => navigate('/')}><Home size={15} /> Home</Button>
      </div>

      {/* Tabs */}
      <div className="user-list-tabs mb-8 flex flex-wrap gap-4 max-md:mb-3 max-md:gap-[0.6rem]">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => handleTabChange(t.id)}
            className={cn(
              'user-list-tab inline-flex items-center gap-2 rounded-md border border-[rgba(0,150,180,0.6)] bg-white px-4 py-2 text-[0.85rem] font-medium text-[#64748b] transition-all hover:border-[rgba(0,150,180,0.85)] hover:bg-[#f1f5f9] hover:text-[#0ea5e9] [&>svg]:size-[1.1rem]',
              'max-md:min-h-9 max-md:flex-[1_1_calc(50%-0.3rem)] max-md:justify-center max-md:px-2 max-md:py-[0.4rem] max-md:font-semibold max-md:[&_.badge]:px-[0.35rem] max-md:[&_.badge]:py-[0.2rem] max-md:[&_.badge]:text-[0.7rem]',
              activeTab === t.id && 'active !border-[#0ea5e9] !bg-[#e0f2fe] !text-[#0ea5e9] shadow-[0_1px_2px_rgba(0,0,0,0.05)]',
            )}>
            {t.icon} {t.label} {t.badge}
          </button>
        ))}
      </div>

      {/* Search / filter bar */}
      <div className="search-filter-bar-new flex w-full flex-nowrap items-end gap-2 max-sm:flex-wrap">
        <div className="min-w-0 flex-[1_1_30%] max-sm:flex-[1_1_45%]">
          <label className="filter-label mb-1 block truncate text-[0.85rem] font-medium text-black max-md:font-semibold">User ID</label>
          <div className="autocomplete-wrapper relative">
            <input ref={idInputRef} className={cn(inputCls, searchId ? '!pr-7' : '!pr-2')} placeholder="ID..." value={searchId}
              onChange={(e) => handleIdChange(e.target.value)} onKeyDown={noEnter} />
            {searchId && <button type="button" className={cn(clearBtn, 'right-2')} onClick={handleClearId} title="Clear User ID filter" aria-label="Clear User ID filter">✕</button>}
          </div>
        </div>
        <div className="min-w-0 flex-[0_0_110px] max-sm:flex-[1_1_45%]">
          <label className="filter-label mb-1 block truncate text-[0.85rem] font-medium text-black max-md:font-semibold">Filter By</label>
          <select className={cn(inputCls, 'select !pl-2')} value={filterType} onChange={(e) => handleFilterTypeChange(e.target.value)}>
            <option value="tehsil">Tehsil</option>
            <option value="mobileNumber">Phone</option>
            <option value="email">Email</option>
            <option value="subadmin">Sub-Admin</option>
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_45%] max-sm:flex-[1_1_100%]">
          <label className="filter-label mb-1 block truncate text-[0.85rem] font-medium text-black max-md:font-semibold">
            {filterType === 'tehsil' ? 'Select Tehsil' : filterType === 'subadmin' ? 'Select Sub-Admin' : 'Search Term'}
          </label>
          <div className="autocomplete-wrapper relative">
            {filterType === 'subadmin' ? (
              <select className={cn(inputCls, 'select !pl-2')} value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setCurrentPage(1); }}>
                <option value="">All owners</option>
                <option value="direct">Mine (direct)</option>
                <option value="subadmins">Any sub-admin</option>
                {subAdminList.map((s) => <option key={s.userId} value={s.userId}>{s.userName || s.userId}</option>)}
              </select>
            ) : filterType === 'tehsil' ? (
              <>
                <input ref={filterInputRef} className={cn(inputCls, filterValue ? '!pr-14' : '!pr-2')} placeholder="Type to filter tehsils..." value={filterValue}
                  onChange={(e) => { handleFilterValueChange(e.target.value); setShowTehsilDropdown(true); }}
                  onKeyDown={noEnter} onFocus={() => setShowTehsilDropdown(true)} onBlur={() => setTimeout(() => setShowTehsilDropdown(false), 200)} />
                {showTehsilDropdown && (
                  <div className="autocomplete-dropdown absolute inset-x-0 top-full z-[1000] max-h-[200px] overflow-y-auto rounded border border-[#ccc] bg-white">
                    <div className="autocomplete-item cursor-pointer p-2 hover:bg-[#f1f5f9]" onMouseDown={() => { handleFilterValueChange(''); setShowTehsilDropdown(false); }}>-- All --</div>
                    {tehsilOptions.filter((t) => String(t).toLowerCase().includes(String(filterValue).toLowerCase())).map((t, i) => (
                      <div key={i} className="autocomplete-item cursor-pointer p-2 hover:bg-[#f1f5f9]" onMouseDown={() => { handleFilterValueChange(t); setShowTehsilDropdown(false); }}>{t}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <input ref={filterInputRef} className={cn(inputCls, filterValue ? '!pr-7' : '!pr-2')} placeholder="Search..." value={filterValue}
                onChange={(e) => handleFilterValueChange(e.target.value)} onKeyDown={noEnter} />
            )}
            {filterValue && filterType !== 'subadmin' && (
              <button type="button" className={cn(clearBtn, filterType === 'tehsil' ? 'right-[30px]' : 'right-2.5')} onClick={handleClearFilter} title="Clear filter value" aria-label="Clear filter value">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk assign */}
      <div className={cn('bulk-assign-bar my-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-[#b6d4fe] bg-[#eef6ff] text-[0.7rem]', bulkOpen ? 'p-1.5' : 'px-1.5 py-[3px]')}>
        <button type="button" onClick={() => setBulkOpen((o) => !o)} className="inline-flex min-h-7 items-center gap-1 border-0 bg-transparent p-0 text-[0.75rem] font-bold text-[#0b5ed7]">
          {bulkOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<UserCog size={13} />Bulk assign{!bulkOpen && selectedIds.length ? ` (${selectedIds.length} selected)` : ''}
        </button>
        {bulkOpen && (
          <>
            <Badge bg={selectedIds.length ? 'primary' : 'secondary'} className="!text-[0.62rem]">{selectedIds.length} selected</Badge>
            <button type="button" className="btn btn-sm btn-outline-primary !px-[0.45rem] !py-[0.15rem] !text-[0.7rem] max-sm:min-h-8" onClick={selectAllMatching} disabled={selectingAll}>
              {selectingAll ? 'Selecting…' : `Select all ${totalFiltered} matching`}
            </button>
            <select className="select select-sm w-auto max-w-full !py-[0.15rem] !pl-[0.45rem] !text-[0.7rem] max-sm:min-h-8" value={assignTarget} onChange={(e) => setAssignTarget(e.target.value)}>
              <option value="">Take back (manage directly)</option>
              {subAdminList.map((s) => <option key={s.userId} value={s.userId}>Assign to {s.userName || s.userId}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary !px-[0.45rem] !py-[0.15rem] !text-[0.7rem] max-sm:min-h-8" onClick={handleBulkAssign} disabled={assigning || !selectedIds.length}>{assigning ? 'Working…' : 'Apply'}</button>
            <button type="button" className="btn btn-sm btn-outline-secondary !px-[0.45rem] !py-[0.15rem] !text-[0.7rem] max-sm:min-h-8" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>Clear</button>
            <label className="ml-auto inline-flex items-center gap-1 sm:hidden">
              <input type="checkbox" className="check" checked={pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))}
                onChange={(e) => setSelectedIds((prev) => (e.target.checked ? [...new Set([...prev, ...pageIds])] : prev.filter((id) => !pageIds.includes(id))))} />
              This page
            </label>
          </>
        )}
      </div>

      {/* List */}
      {loading && users.length === 0 ? (
        <div className="my-12 rounded-xl border border-[rgba(0,212,255,0.2)] bg-white py-12 text-center">
          <Spinner />
          <div className="mt-2 text-[0.85rem] text-[#64748b]">Loading users...</div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {loading && <div className="user-list-loading-bar absolute inset-x-0 top-0 z-10 h-[3px]" />}
          {users.length === 0 ? (
            <div className="empty-state rounded-xl border border-dashed border-[rgba(0,212,255,0.3)] bg-white px-8 py-16 text-center">
              <Users className="mx-auto mb-4 size-16 text-[rgba(0,212,255,0.3)]" />
              <div className="mb-2 text-2xl font-semibold text-[#6c757d]">No Users Found</div>
              <div className="text-[#64748b]">Try adjusting your search or filter criteria</div>
            </div>
          ) : (
            <>
              {/* Desktop / tablet table */}
              <div className="user-list-table-wrapper table-wrap hidden min-h-[250px] flex-1 sm:block sm:max-h-[calc(100dvh-350px)] max-md:rounded-lg">
                <table className="user-list-table table">
                  <thead>
                    <tr>
                      {bulkOpen && (
                        <th className="w-7">
                          <input type="checkbox" className="check" aria-label="Select all on this page"
                            checked={users.length > 0 && users.every((u) => selectedIds.includes(u.userId))}
                            onChange={(e) => setSelectedIds((prev) => (e.target.checked ? [...new Set([...prev, ...pageIds])] : prev.filter((id) => !pageIds.includes(id))))} />
                        </th>
                      )}
                      <SortTh k="userName" className="freeze-column freeze ![background:#1b333c]">User</SortTh>
                      <SortTh k="activeTehsil">Tehsil</SortTh>
                      <th title="Number of mouzas assigned (across all tehsils)"><div className="th-content">Mouzas</div></th>
                      <SortTh k="daysRemaining">Days Left</SortTh>
                      <SortTh k="subscriptionType">Subscription</SortTh>
                      <SortTh k="mobileNumber">Phone</SortTh>
                      <th><div className="th-content">Sub-Admin</div></th>
                      {!isPublic && <SortTh k="userType">Type</SortTh>}
                      {isPublic && <SortTh k="createdAt">Registered At</SortTh>}
                      {isPublic && <SortTh k="status">Status</SortTh>}
                      {showActions && <th><div className="th-content">Actions</div></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => {
                      const st = rowStatus(u);
                      return (
                        <tr key={u.userId} className={cn('user-list-row', `status-${st}`, `row-${st}`, i % 2 === 1 && 'even')}>
                          {bulkOpen && (
                            <td onClick={(e) => e.stopPropagation()} className="text-center">
                              {u.userType === 'user' && <input type="checkbox" className="check" aria-label={`Select ${u.userId}`} checked={selectedIds.includes(u.userId)} onChange={() => toggleSelected(u.userId)} />}
                            </td>
                          )}
                          <td className="user-name clickable-id freeze-column freeze cursor-pointer font-bold hover:!bg-[#e6f7fb]" onClick={() => openEdit(u.userId)} title="Click to edit user">
                            <span className="user-id user-id-only text-[0.88rem] text-[#0096c7] max-md:text-[0.78rem]" title={u.userName}>{u.userId}</span>
                          </td>
                          <td className="user-tehsil text-[#7c3aed]">{u.activeTehsil}</td>
                          <td className="user-mouzas whitespace-nowrap text-center"><MouzaCount user={u} /></td>
                          <td className="user-days whitespace-nowrap">{daysLabel(u)}</td>
                          <td className="user-subscription">{u.subscriptionType}</td>
                          <td className="user-phone whitespace-nowrap">{u.mobileNumber || 'N/A'}</td>
                          <td className="user-subadmin whitespace-nowrap text-[0.8rem]">{u.subAdminName ? <Badge bg="primary">{u.subAdminName}</Badge> : <span className="text-ink-2">—</span>}</td>
                          {!isPublic && <td className="user-type"><Badge bg={typeBadge(u.userType)}>{u.userType || 'Regular'}</Badge></td>}
                          {isPublic && <td className="user-registered whitespace-nowrap text-[0.8rem] text-[#334155]">{fmtDateTime(u.createdAt, 'N/A')}</td>}
                          {isPublic && (
                            <td className="user-status">
                              {u.status === 'Active' || u.status === 'Trial'
                                ? <Badge bg="success" className="!px-2 !py-1 !text-[0.8rem]">Active</Badge>
                                : <Badge bg="secondary" className="!bg-[#6c757d] !px-2 !py-1 !text-[0.8rem]">Inactive</Badge>}
                            </td>
                          )}
                          {showActions && <td className="user-actions">{activateCell(u)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Phone card list */}
              <div className="flex flex-col gap-2 sm:hidden">
                {users.map((u) => {
                  const st = rowStatus(u);
                  return (
                    <div key={u.userId} role="button" tabIndex={0} onClick={() => openEdit(u.userId)} onKeyDown={(e) => { if (e.key === 'Enter') openEdit(u.userId); }}
                      className={cn('user-list-row rounded-lg border border-[rgba(0,212,255,0.2)] border-l-4 p-2.5 text-[0.85rem] text-teal-ink', `status-${st}`, CARD_TINT[st])}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {bulkOpen && u.userType === 'user' && (
                            <input type="checkbox" className="check size-5" aria-label={`Select ${u.userId}`} checked={selectedIds.includes(u.userId)}
                              onClick={(e) => e.stopPropagation()} onChange={() => toggleSelected(u.userId)} />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-bold text-[#0096c7]">{u.userId}</div>
                            <div className="truncate text-[0.75rem] text-ink-2">{u.userName}</div>
                          </div>
                        </div>
                        {isPublic
                          ? (u.status === 'Active' || u.status === 'Trial' ? <Badge bg="success">Active</Badge> : <Badge bg="secondary" className="!bg-[#6c757d]">Inactive</Badge>)
                          : <Badge bg={typeBadge(u.userType)}>{u.userType || 'Regular'}</Badge>}
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.78rem]">
                        <div className="truncate"><span className="text-ink-2">Tehsil: </span><span className="text-[#7c3aed]">{u.activeTehsil || '—'}</span></div>
                        <div><span className="text-ink-2">Mouzas: </span><MouzaCount user={u} /></div>
                        <div><span className="text-ink-2">Days: </span><strong>{daysLabel(u)}</strong></div>
                        <div className="truncate"><span className="text-ink-2">Plan: </span>{u.subscriptionType || '—'}</div>
                        <div className="truncate"><span className="text-ink-2">Phone: </span>{u.mobileNumber || 'N/A'}</div>
                        <div className="truncate"><span className="text-ink-2">Sub-Admin: </span>{u.subAdminName ? <Badge bg="primary">{u.subAdminName}</Badge> : '—'}</div>
                        {isPublic && <div className="col-span-2"><span className="text-ink-2">Registered: </span>{fmtDateTime(u.createdAt, 'N/A')}</div>}
                      </div>
                      {showActions && <div className="mt-2 flex justify-end">{activateCell(u)}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pagination */}
      {users.length > 0 && (
        <div className="pagination-controls mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(0,212,255,0.2)] px-4 py-2 max-md:px-2">
          <div className="pagination-info text-[0.9rem] font-medium text-teal-ink">Showing {users.length} of {totalFiltered} users</div>
          <div className="pagination-buttons flex items-center gap-1">
            {[
              { icon: <ChevronsLeft size={16} />, to: 1, dis: currentPage === 1, label: 'First page' },
              { icon: <ChevronLeft size={16} />, to: Math.max(1, currentPage - 1), dis: currentPage === 1, label: 'Previous page' },
            ].map((b) => (
              <button key={b.label} type="button" aria-label={b.label} className="btn min-h-9 border !border-[rgba(0,212,255,0.3)] bg-white !px-2.5 text-teal-ink disabled:!opacity-30" disabled={b.dis} onClick={() => setCurrentPage(b.to)}>{b.icon}</button>
            ))}
            <span className="mx-2 font-semibold">Page {currentPage} of {totalPages || 1}</span>
            {[
              { icon: <ChevronRight size={16} />, to: Math.min(totalPages, currentPage + 1), dis: currentPage === totalPages || totalPages === 0, label: 'Next page' },
              { icon: <ChevronsRight size={16} />, to: totalPages, dis: currentPage === totalPages || totalPages === 0, label: 'Last page' },
            ].map((b) => (
              <button key={b.label} type="button" aria-label={b.label} className="btn min-h-9 border !border-[rgba(0,212,255,0.3)] bg-white !px-2.5 text-teal-ink disabled:!opacity-30" disabled={b.dis} onClick={() => setCurrentPage(b.to)}>{b.icon}</button>
            ))}
          </div>
        </div>
      )}

      {editUserId && (
        <UserEditForm
          userId={editUserId}
          initialTab={editInitialTab}
          handleClose={() => { setEditUserId(null); setEditInitialTab('profile'); }}
          refreshUsers={fetchUsers}
        />
      )}
    </div>
  );
}
