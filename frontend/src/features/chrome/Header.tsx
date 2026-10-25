/**
 * 42px navbar (legacy src/App/Header.js, inv-01 §1.4/1.5/§2).
 * Hamburger, Tehsil (only if > 1) / Chak / Murabba search dropdowns, gold profile button
 * with unread badge and the WhatsApp-palette notification panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import * as Popover from '@radix-ui/react-popover';
import { EllipsisVertical } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { api } from '@/shared/api/client';
import { Spinner, toast } from '@/shared/ui';
import NotificationPanel from './NotificationPanel';
import './chrome.css';

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://naqsha-zameen.com').replace(/\/$/, '');

type MenuKey = 'tehsil' | 'mauza' | 'murabba' | null;

const getOptionLabel = (o: any) => (typeof o === 'object' && o !== null ? String(o.label) : String(o));
const getOptionValue = (o: any) => (typeof o === 'object' && o !== null ? String(o.value) : String(o));

/** Numeric labels first (ascending), then natural-order alphabetic (legacy sortList). */
export const sortList = <T,>(list: T[]): T[] => {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const la = getOptionLabel(a);
    const lb = getOptionLabel(b);
    const na = /^\d+$/.test(la);
    const nb = /^\d+$/.test(lb);
    if (na && nb) return Number(la) - Number(lb);
    if (na) return -1;
    if (nb) return 1;
    return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' });
  });
};

/** Debounced (300 ms) uncontrolled search filter, as legacy. */
function useDebouncedFilter() {
  const [filter, setFilter] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useCallback((v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFilter(v), 300);
  }, []);
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFilter('');
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { filter, onChange, reset };
}

interface NavDropdownProps {
  id: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  label: ReactNode;
  title?: string;
  align?: 'start' | 'end';
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  filter: string;
  onFilter: (v: string) => void;
  onClearFilter?: () => void;
  clearTitle?: string;
  inputStyle?: React.CSSProperties;
  onInputClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  menuStyle?: React.CSSProperties;
  children: ReactNode;
}

function NavDropdown({
  id, open, onOpenChange, label, title, align = 'start', inputRef, placeholder, filter, onFilter, onClearFilter, clearTitle,
  inputStyle, onInputClick, menuStyle, children,
}: NavDropdownProps) {
  const [offset, setOffset] = useState(10);
  const handleOpen = (o: boolean) => {
    if (o) {
      // Open just below the navbar, not right under the toggle (legacy popper offset).
      const nav = document.querySelector('.navbar-tech-theme');
      const btn = document.getElementById(id);
      if (nav && btn) setOffset(Math.max(0, nav.getBoundingClientRect().bottom - btn.getBoundingClientRect().bottom) + 4);
    }
    onOpenChange(o);
  };
  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>
        <button type="button" id={id} className="rounded-dropdown dropdown-toggle" title={title}>
          <span className="dd-label">{label}</span>
          <span className="dd-caret" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align={align}
          sideOffset={offset}
          avoidCollisions={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="nav-dd-menu dropdown-menu"
          style={{ zIndex: 10000, ...menuStyle }}
        >
          <div className="dropdown-sticky-search">
            <input
              ref={inputRef}
              className="dd-search form-control"
              placeholder={placeholder}
              autoComplete="off"
              onChange={(e) => onFilter(e.target.value)}
              onClick={onInputClick}
              style={{ paddingRight: onClearFilter && filter ? 34 : 12, ...inputStyle }}
            />
            {onClearFilter && Boolean(filter) && (
              <button
                type="button"
                className="input-clear-btn-red"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearFilter();
                }}
                title={clearTitle}
                aria-label={clearTitle}
              >
                ✕
              </button>
            )}
          </div>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function Header() {
  const { user, setActiveTehsil, unreadNotificationsCount, logout } = useAuth();
  // Preview mode: only the mouza, account (log out) and a way back to the website.
  const previewActive = useAppStore((s) => s.previewActive);
  const navigate = useNavigate();
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const murabbaOptions = useAppStore((s) => s.murabbaOptions);
  const selectedMurabba = useAppStore((s) => s.selectedMurabba);
  const mouzaLoading = useAppStore((s) => s.mouzaLoading);
  const murabbaLoading = useAppStore((s) => s.murabbaLoading);
  const set = useAppStore((s) => s.set);

  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [showNotif, setShowNotif] = useState(false);
  const [shiftedMouzas, setShiftedMouzas] = useState<string[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  // ---- "All Mouzas" browsing: any mouza of any tehsil, unowned ones open as preview ----
  const browseMode = useAppStore((s) => s.browseMode);
  const browseTehsil = useAppStore((s) => s.browseTehsil);
  const previewLeft = useAppStore((s) => s.previewLeft);
  const browseAll = browseMode === 'all';
  const allTehsils: { name: string; own: boolean }[] = [];
  const allMouzas: { name: string; own: boolean }[] = [];
  const browseLoading = false;

  const tehsilInputRef = useRef<HTMLInputElement>(null);
  const mauzaInputRef = useRef<HTMLInputElement>(null);
  const murabbaInputRef = useRef<HTMLInputElement>(null);
  const tehsilF = useDebouncedFilter();
  const mauzaF = useDebouncedFilter();
  const murabbaF = useDebouncedFilter();

  const activeTehsil = (browseAll && browseTehsil) || user?.activeTehsil || '';



  /** My Mouzas <-> All Mouzas. Leaving All Mouzas returns to the account's own tehsil. */
  const setBrowse = (mode: 'mine' | 'all') => {
    if (mode === browseMode) return;
    const st = useAppStore.getState();
    if (mode === 'mine') {
      st.resetMapSelection();
      set({ browseMode: 'mine', browseTehsil: null, previewActive: false });
    } else {
      set({ browseMode: 'all', browseTehsil: user?.activeTehsil || null });
    }
    try { localStorage.setItem('nz_browse_mode', mode); } catch { /* private mode */ }
  };

  const fetchShiftedMouzas = useCallback(() => {
    if (!activeTehsil) {
      setShiftedMouzas([]);
      return;
    }
    api
      .get(`/api/geo/shifted-mouzas/${encodeURIComponent(activeTehsil)}`)
      .then(({ data }) => setShiftedMouzas(Array.isArray(data) ? data : []))
      .catch(() => setShiftedMouzas([]));
  }, [activeTehsil]);

  // Escape closes everything
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setShowNotif(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Close the notification panel on outside press
  useEffect(() => {
    if (!showNotif) return;
    const onDown = (e: PointerEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [showNotif]);

  // Reset filters / close lists when the active tehsil changes
  useEffect(() => {
    tehsilF.reset();
    mauzaF.reset();
    setOpenMenu((m) => (m === 'tehsil' || m === 'mauza' ? null : m));
    fetchShiftedMouzas();
     
  }, [activeTehsil, fetchShiftedMouzas]);

  const availableTehsils = useMemo(
    () => (Array.isArray(user?.tehsilAccess) ? user.tehsilAccess.map((e) => e.tehsil).filter(Boolean) : []),
    [user?.tehsilAccess],
  );
  const canSwitchTehsil = !browseAll && availableTehsils.length > 1;
  const ownTehsils = useMemo(() => new Set(availableTehsils.map((t) => t.toLowerCase())), [availableTehsils]);

  const tehsilSource = useMemo(
    () => (browseAll && allTehsils.length ? allTehsils.map((t) => t.name) : availableTehsils),
    [browseAll, allTehsils, availableTehsils],
  );
  const tehsilList = useMemo(
    () => sortList(tehsilSource.filter((t) => t.toLowerCase().includes(tehsilF.filter.toLowerCase())).slice(0, 1000)),
    [tehsilSource, tehsilF.filter],
  );
  const ownMouzaSet = useMemo(() => new Set(allMouzas.filter((m) => m.own).map((m) => m.name)), [allMouzas]);
  const mouzaList = useMemo(() => {
    if (browseAll) return selectedMauza ? [selectedMauza] : [];
    return activeTehsil && Array.isArray(user?.mauzaList) ? user.mauzaList : [];
  }, [browseAll, selectedMauza, activeTehsil, user?.mauzaList]);
  const sortedMouzaList = useMemo(() => {
    const hit = (m: any) => String(m).toLowerCase().includes(mauzaF.filter.toLowerCase());
    if (!browseAll) return sortList(mouzaList.filter(hit).slice(0, 1000));
    // Own mouzas first, then the rest.
    const own = sortList(mouzaList.filter((m: any) => ownMouzaSet.has(m) && hit(m)));
    const rest = sortList(mouzaList.filter((m: any) => !ownMouzaSet.has(m) && hit(m)));
    return [...own, ...rest].slice(0, 1500);
  }, [browseAll, mouzaList, ownMouzaSet, mauzaF.filter]);
  const sortedMurabbaList = useMemo(
    () => sortList((Array.isArray(murabbaOptions) ? murabbaOptions : []).filter((m) => getOptionLabel(m).toLowerCase().includes(murabbaF.filter.toLowerCase()))),
    [murabbaOptions, murabbaF.filter],
  );

  /** Opening one list closes the others, the sidebar and the panel; resets + focuses its search. */
  const openOne = (key: Exclude<MenuKey, null>, isOpen: boolean) => {
    if (!isOpen) {
      setOpenMenu((m) => (m === key ? null : m));
      return;
    }
    if (useAppStore.getState().showMenu) set({ showMenu: false });
    setShowNotif(false);
    setOpenMenu(key);
    const f = key === 'tehsil' ? tehsilF : key === 'mauza' ? mauzaF : murabbaF;
    const ref = key === 'tehsil' ? tehsilInputRef : key === 'mauza' ? mauzaInputRef : murabbaInputRef;
    f.reset();
    if (key === 'mauza') fetchShiftedMouzas();
    setTimeout(() => {
      if (ref.current) {
        ref.current.value = '';
        ref.current.focus();
      }
    }, 50);
  };

  const clearInput = (ref: React.RefObject<HTMLInputElement | null>, reset: () => void) => {
    reset();
    if (ref.current) {
      ref.current.value = '';
      ref.current.focus();
    }
  };

  /** Legacy App.handleTehsilChange */
  const handleTehsilSelection = async (tehsil: string) => {
    if (!tehsil) return;
    setOpenMenu(null);
    tehsilF.reset();
    if (tehsil === activeTehsil) return;
    if (browseAll) {
      // Browsing: the map follows the chosen tehsil; the account's active tehsil is unchanged.
      useAppStore.getState().resetMapSelection();
      set({ browseTehsil: tehsil, userLayerToLoad: null });
      return;
    }
    try {
      set({ mouzaLoading: true });
      await setActiveTehsil(tehsil);
      set({ selectedMauza: '', selectedMurabba: null, murabbaOptions: [], userLayerToLoad: null });
    } catch (err) {
      console.error('Failed to switch tehsil:', err);
    } finally {
      set({ mouzaLoading: false });
    }
  };

  const handleMauzaSelection = (mauza: string) => {
    if (browseAll) {
      mauzaF.reset();
      setOpenMenu(null);
      const own = user?.userType === 'admin' || ownMouzaSet.has(mauza);
      if (!own && previewLeft === 0) {
        // The server still allows mouzas already previewed today and refuses new ones.
        toast.info('Daily preview limit reached. Mouzas you already opened today still work.');
      }
      const st = useAppStore.getState();
      if (mauza !== st.selectedMauza || st.previewActive === own) {
        set({ previewActive: !own });
        st.selectMauza(activeTehsil, mauza);
      }
      return;
    }
    const allowed = new Set((user?.mauzaList || []).map(String));
    if (!allowed.has(String(mauza))) return;
    mauzaF.reset();
    setOpenMenu(null);
    if (mauza !== useAppStore.getState().selectedMauza) {
      useAppStore.getState().selectMauza(activeTehsil, mauza);
    }
  };

  const handleProfileClick = () => {
    if (user) set({ showProfileModal: true });
    else navigate('/login');
  };

  const loadingLabel = (
    <span className="inline-flex items-center gap-1.5">
      <Spinner size="sm" className="!h-3 !w-3 !border-2 text-current" />
      Loading...
    </span>
  );
  const menuLoading = (text: string) => (
    <div className="py-3 text-center text-[#e4e7eb]">
      <Spinner size="sm" />
      <div className="mt-2 text-[0.8rem]">{text}</div>
    </div>
  );

  return (
    <nav
      className="navbar-tech-theme sticky top-0 z-[9999] box-border flex h-[42px] w-full max-w-[100vw] shrink-0 flex-nowrap items-center justify-between overflow-visible border-b border-white/[0.08] px-1 shadow-[0_4px_12px_rgba(0,0,0,0.4)] backdrop-blur-[12px]"
    >
      {/* Left: menu toggle, Tehsil & Chak */}
      <div className="navbar-left flex min-w-0 shrink items-center gap-[3px]">
        <button
          type="button"
          onClick={() => useAppStore.getState().toggleMenu()}
          className="navbar-brand-custom navbar-brand mr-[5px] flex h-[30px] w-[30px] shrink-0 items-center justify-center p-0"
          title="Menu"
          aria-label="Menu"
        >
          <EllipsisVertical size={15} />
        </button>
        {user && (
          <>
            {canSwitchTehsil && (
              <div className="mr-1 min-w-0 shrink">
                <NavDropdown
                  id="tehsil-dropdown"
                  open={openMenu === 'tehsil'}
                  onOpenChange={(o) => openOne('tehsil', o)}
                  label={activeTehsil || 'Select Tehsil'}
                  title={activeTehsil || 'Select Tehsil'}
                  inputRef={tehsilInputRef}
                  placeholder="Search Tehsil..."
                  filter={tehsilF.filter}
                  onFilter={tehsilF.onChange}
                  onClearFilter={() => clearInput(tehsilInputRef, tehsilF.reset)}
                  clearTitle="Clear Tehsil filter"
                >
                  {tehsilList.length > 0 ? (
                    tehsilList.map((t) => (
                      <button type="button" key={t} className="dropdown-item" onClick={() => handleTehsilSelection(t)}>
                        {browseAll && ownTehsils.has(t.toLowerCase()) && <span className="mr-1 text-[#34d399]">✓</span>}
                        {t}
                      </button>
                    ))
                  ) : (
                    <button type="button" className="dropdown-item" disabled>No Tehsil Found</button>
                  )}
                </NavDropdown>
              </div>
            )}
            <div className="min-w-0 shrink">
              <NavDropdown
                id="mauza-dropdown"
                open={openMenu === 'mauza'}
                onOpenChange={(o) => openOne('mauza', o)}
                label={mouzaLoading ? loadingLabel : selectedMauza || 'Select Chak'}
                title={selectedMauza || 'Select Chak'}
                inputRef={mauzaInputRef}
                placeholder="Search Chak..."
                filter={mauzaF.filter}
                onFilter={mauzaF.onChange}
                onClearFilter={() => clearInput(mauzaInputRef, mauzaF.reset)}
                clearTitle="Clear Mouza filter"
              >
                {user.userType !== 'subadmin' && (
                  <div className="browse-switch" role="tablist" aria-label="Which mouzas">
                    <button type="button" role="tab" aria-selected={!browseAll} className={!browseAll ? 'on' : ''} onClick={() => setBrowse('mine')}>My Mouzas</button>
                    <a role="tab" aria-selected={browseAll} className={browseAll ? 'on' : ''} href={`${SITE_URL}/maps/`} title="Browse every tehsil and mouza on naqsha-zameen.com">All Mouzas ↗</a>
                  </div>
                )}
                {mouzaLoading || (browseAll && browseLoading && !mouzaList.length) ? (
                  menuLoading('Loading mouzas...')
                ) : sortedMouzaList.length > 0 ? (
                  sortedMouzaList.map((m, i) => (
                    <button
                      type="button"
                      key={`${m}-${i}`}
                      className={'dropdown-item' + (shiftedMouzas.includes(m) ? ' shifted' : '') + (browseAll && !ownMouzaSet.has(m) ? ' preview-item' : '')}
                      onClick={() => handleMauzaSelection(m)}
                    >
                      {browseAll && ownMouzaSet.has(m) && <span className="mr-1 text-[#34d399]">✓</span>}
                      {m}
                    </button>
                  ))
                ) : (
                  <button type="button" className="dropdown-item" disabled>No Chak Found</button>
                )}
                {browseAll && (
                  <a className="browse-footer block" href={`${SITE_URL}/maps/`}>Preview of another mouza · find more on naqsha-zameen.com/maps ↗</a>
                )}
              </NavDropdown>
            </div>
          </>
        )}
      </div>

      {/* Right: Murabba & profile */}
      <div className="navbar-right ml-auto flex shrink-0 items-center gap-[3px]">
        {user && (
          <NavDropdown
            id="murabba-dropdown"
            open={openMenu === 'murabba'}
            onOpenChange={(o) => openOne('murabba', o)}
            align="end"
            label={murabbaLoading ? loadingLabel : selectedMurabba || 'Select Murabba'}
            title={selectedMurabba || 'Select Murabba'}
            inputRef={murabbaInputRef}
            placeholder="Search..."
            filter={murabbaF.filter}
            onFilter={murabbaF.onChange}
            inputStyle={{ fontSize: '0.75rem' }}
            onInputClick={(e) => {
              const el = e.currentTarget;
              if (el.value) {
                el.value = '';
                murabbaF.reset();
              }
            }}
            menuStyle={{ width: 150, minWidth: 150, maxWidth: 150, maxHeight: 'calc(100dvh - 60px)' }}
          >
            {murabbaLoading ? (
              menuLoading('Loading...')
            ) : sortedMurabbaList.length > 0 ? (
              sortedMurabbaList.map((m, i) => (
                <button
                  type="button"
                  key={`${getOptionValue(m)}-${i}`}
                  title={getOptionLabel(m)}
                  className="dropdown-item !block max-w-full overflow-hidden text-ellipsis whitespace-nowrap !px-2.5 !py-1 !text-[0.78rem] max-sm:!py-2.5"
                  onClick={() => {
                    murabbaF.reset();
                    set({ selectedMurabba: getOptionValue(m) });
                    setOpenMenu(null);
                  }}
                >
                  {getOptionLabel(m)}
                </button>
              ))
            ) : (
              <button type="button" className="dropdown-item !text-[0.75rem]" disabled>No Murabba Found</button>
            )}
          </NavDropdown>
        )}

        <div ref={notifRef} className="relative">
          <button
            type="button"
            id="profile-notification-btn"
            className="profile-container relative ml-0.5 flex h-[40px] min-w-[36px] cursor-pointer items-center justify-center rounded-full p-[5px] transition-transform duration-200 hover:scale-105"
            aria-label={user ? 'Notifications' : 'Profile'}
            onClick={() => {
              if (!user) return handleProfileClick();
              setOpenMenu(null);
              setShowNotif((v) => !v);
            }}
          >
            <span className="profile-icon-wrapper relative flex h-[28px] w-[28px] items-center justify-center rounded-full bg-gold shadow-[0_2px_5px_rgba(0,0,0,0.3)] transition-all duration-300 [transition-timing-function:cubic-bezier(0.175,0.885,0.32,1.275)] hover:shadow-[0_3px_6px_rgba(255,215,0,0.25)] max-sm:h-[26px] max-sm:w-[26px]">
              <img
                src="/profile-icon.png"
                alt="User Icon"
                className="profile-icon block h-[80%] w-[80%] shrink-0 rounded-full object-contain [filter:brightness(0)_invert(1)_drop-shadow(0_1px_1px_rgba(0,0,0,0.2))]"
              />
              {!previewActive && unreadNotificationsCount > 0 && (
                <span
                  className="notification-badge absolute -right-1 -top-1 z-10 box-border flex h-4 min-w-4 select-none items-center justify-center rounded-lg border-[1.5px] border-[#1a1f2e] bg-[#EA4335] px-[3.5px] text-center text-[9.2px] font-bold leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </span>
              )}
            </span>
          </button>
          {showNotif && user && previewActive && (
            <div className="preview-account" role="menu">
              <div className="preview-account-name">👤 {user.userName || user.userId}</div>
              <a className="preview-account-item" href={`${SITE_URL}/maps/`}>🌐 Back to website</a>
              <button type="button" className="preview-account-item" onClick={() => { setShowNotif(false); logout(); }}>🚪 Log out</button>
            </div>
          )}
          {showNotif && user && !previewActive && (
            <NotificationPanel
              onClose={() => setShowNotif(false)}
              onProfile={() => {
                setShowNotif(false);
                handleProfileClick();
              }}
            />
          )}
        </div>
      </div>
    </nav>
  );
}
