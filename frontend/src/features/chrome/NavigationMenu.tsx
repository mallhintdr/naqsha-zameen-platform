/**
 * 240px off-canvas sidebar below the 42px navbar (legacy src/App/NavigationMenu.js, inv-01 §3).
 * D7: the duplicate second "Shift Mouza" entry (#nav-link-shift) is removed.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore, type AdminMapMode, type TourType } from '@/app/store';
import { api } from '@/shared/api/client';
import { cn, toast } from '@/shared/ui';
import { useUserLayers } from '@/features/map/useUserLayers';
import ChangeMouzasModal, { canChangeMouzas } from '@/features/users/ChangeMouzasModal';
import TehsilGroupingModal from '@/features/admin/TehsilGroupingModal';
import './chrome.css';

/** Tour titles (legacy TutorialTour.js TOURS registry, titles only). */
export const TOUR_TITLES: Record<string, string> = {
  navigation: 'Mouza & Murabba Selection Tour',
  baseLayers: 'Base Map Layers Tour',
  location: 'Location & Tracking Tour',
  drawing: 'Map Drawing Tools Tour',
  savedLayers: 'Save & Open Custom Layers Tour',
  shift: 'Shift Mouza (Offsets) Tour',
  clearCache: 'Cache & Performance Tour',
  multiUse: 'Multi-Device Security Tour',
  changePassword: 'Change Password Tour',
};
const TOUR_ICONS: Record<string, string> = {
  login: '🔑', baseLayers: '🗺️', navigation: '📍', drawing: '✍️', savedLayers: '💾', location: '📡',
  shift: '🔄', clearCache: '🧹', multiUse: '🛡️', changePassword: '🔑',
};
const TOUR_ORDER: TourType[] = ['navigation', 'baseLayers', 'location', 'drawing', 'savedLayers', 'shift', 'clearCache', 'multiUse', 'changePassword'];

function NavItem({
  id, onClick, disabled, className, style, title, children,
}: { id?: string; onClick?: () => void; disabled?: boolean; className?: string; style?: CSSProperties; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onClick?.()}
      className={cn('nav-link nav-link-clean', disabled && 'disabled', className)}
      style={style}
    >
      {children}
    </button>
  );
}

function ScanHostingButton({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const handleSync = async () => {
    if (status === 'scanning') return;
    setStatus('scanning');
    setProgress(10);
    const interval = setInterval(() => setProgress((p) => (p >= 90 ? p : p + 10)), 600);
    try {
      await api.post('/api/admin/scan-hosting', {});
      clearInterval(interval);
      setProgress(100);
      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        setProgress(0);
        onDone?.();
        window.location.reload();
      }, 1500);
    } catch (err) {
      clearInterval(interval);
      setProgress(0);
      setStatus('error');
      console.error('Scan hosting failed:', err);
      setTimeout(() => setStatus('idle'), 3000);
    }
  };
  return (
    <NavItem onClick={handleSync} disabled={status === 'scanning'} className="submenu-item relative overflow-hidden">
      {status === 'idle' && '🔄 Scan & Sync Hosting'}
      {status === 'scanning' && `⏳ Scanning... (${progress}%)`}
      {status === 'success' && '✅ Synced successfully!'}
      {status === 'error' && '❌ Sync Failed!'}
      {status === 'scanning' && <span className="sync-progress-bar absolute bottom-0 left-0 h-0.5 bg-[#3b82f6] transition-all" style={{ width: `${progress}%` }} />}
    </NavItem>
  );
}

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full border transition-colors', checked ? 'border-[#0d6efd] bg-[#0d6efd]' : 'border-[#adb5bd] bg-white')}
    >
      <span className={cn('absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all', checked ? 'left-[15px] bg-white' : 'left-[2px] bg-[#adb5bd]')} />
    </button>
  );
}

export default function NavigationMenu() {
  const { user, logout, clearAppData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showMenu = useAppStore((s) => s.showMenu);
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const tourType = useAppStore((s) => s.tourType);
  const testMode = useAppStore((s) => s.testMode);
  const killaMeasurement = useAppStore((s) => s.killaMeasurement);
  const forceMobileMode = useAppStore((s) => s.forceMobileMode);
  const adminMapMode = useAppStore((s) => s.adminMapMode);
  const set = useAppStore((s) => s.set);
  const { userLayers, drawnGeoJson, handleSaveLayerClick } = useUserLayers() as any;

  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [showTehsilModal, setShowTehsilModal] = useState(false);
  const [showChangeMouzas, setShowChangeMouzas] = useState(false);
  const [limitsEnabled, setLimitsEnabled] = useState(true);
  const [invoicesOn, setInvoicesOn] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => set({ showMenu: false });
  const toggleMenu = () => useAppStore.getState().toggleMenu();

  useEffect(() => {
    if (user?.userType !== 'admin') return;
    api
      .get('/api/config')
      .then(({ data }) => {
        if (data && data.limitsEnabled !== undefined) setLimitsEnabled(data.limitsEnabled);
        if (data) setInvoicesOn(data.mouzaInvoicesEnabled === true);
      })
      .catch((err) => console.error('Failed to load system config in navigation:', err));
  }, [user?.userType, user?.userId]);

  const toggleLimits = async () => {
    try {
      const next = !limitsEnabled;
      await api.put('/api/config', { limitsEnabled: next });
      setLimitsEnabled(next);
    } catch (err) {
      console.error('Failed to toggle limits:', err);
      toast.error('Failed to toggle limits.');
    }
  };
  const toggleInvoices = async () => {
    try {
      const next = !invoicesOn;
      await api.put('/api/config', { mouzaInvoicesEnabled: next });
      setInvoicesOn(next);
    } catch {
      toast.error('Failed to switch mouza invoices.');
    }
  };

  useEffect(() => {
    if (!showMenu) setOpenSubmenu(null);
  }, [showMenu]);

  // Escape: close the open submenu first, then the sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openSubmenu) setOpenSubmenu(null);
      else if (useAppStore.getState().showMenu) closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
     
  }, [openSubmenu]);

  const toggleSubmenu = (name: string) => setOpenSubmenu((p) => (p === name ? null : name));

  const go = (path: string) => {
    setOpenSubmenu(null);
    navigate(path);
    toggleMenu();
  };

  const onStartTour = (type: TourType) => {
    // Reset map state to start the tour with a clean slate (legacy App.onStartTour)
    set({ goToMarkers: [], selectedMauza: '', selectedMurabba: null, baseLayer: 'Google Hybrid Satellite', showGoToForm: false });
    if (type !== 'login' && location.pathname !== '/') {
      navigate('/');
      setTimeout(() => set({ tourType: type, runTour: true }), 300);
    } else {
      set({ tourType: type, runTour: true });
    }
  };

  const availableTours = TOUR_ORDER.filter((key) => {
    if (!TOUR_TITLES[key]) return false;
    if (!user) return key === 'changePassword';
    return true;
  });

  const isUserActive = user?.userType === 'admin' || user?.status === 'Active';
  const shiftEnabled = Boolean(isUserActive && selectedMauza);
  const changeMouzasOk = canChangeMouzas(user);
  const layers = Array.isArray(userLayers) ? userLayers : [];
  const canSaveLayer = Boolean(drawnGeoJson && drawnGeoJson.features?.length && layers.length < 10);

  const accordionHead = (name: string, children: ReactNode) => (
    <button
      type="button"
      className="nav-link-clean parent-link flex items-center justify-between font-bold"
      aria-expanded={openSubmenu === name}
      onClick={() => toggleSubmenu(name)}
    >
      <span>{children}</span>
      <span className="arrow text-[0.7rem] transition-transform duration-200" style={{ transform: openSubmenu === name ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
    </button>
  );

  const adminToggle = (label: ReactNode, on: boolean, action: () => void) => (
    <NavItem
      onClick={() => {
        setOpenSubmenu(null);
        action();
        toggleMenu();
      }}
      className="submenu-item"
      style={{ color: on ? '#28a745' : undefined }}
    >
      {label}
    </NavItem>
  );

  return (
    <>
      {/* Backdrop (below the navbar) */}
      <div
        className={cn('offcanvas-backdrop fixed inset-x-0 bottom-0 top-[42px] z-[9997] bg-black/50 transition-opacity duration-300', showMenu ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={cn(
          'modern-sidebar offcanvas offcanvas-start fixed left-0 top-[42px] z-[9998] flex h-[calc(100dvh-42px)] w-[240px] max-w-[240px] flex-col overflow-hidden border-r border-black/[0.08] bg-white shadow-[4px_0_24px_rgba(0,0,0,0.15)] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]',
          showMenu ? 'translate-x-0' : '-translate-x-full invisible',
        )}
        aria-hidden={!showMenu}
        aria-label="Navigation menu"
        style={{ transitionProperty: 'transform, visibility' }}
      >
        <div className="sidebar-body offcanvas-body flex flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain bg-white px-2 py-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]">
          <nav className="nav flex flex-col">
            <NavItem id="nav-link-map" onClick={() => go('/')}>🗺️ Map</NavItem>

            <NavItem
              id="nav-link-goto"
              onClick={() => {
                setOpenSubmenu(null);
                if (location.pathname === '/') set({ showGoToForm: true, showMenu: false });
              }}
            >
              📍 Go To Location
            </NavItem>

            <NavItem
              id="nav-link-shift-mouza"
              disabled={!shiftEnabled}
              onClick={() => {
                setOpenSubmenu(null);
                set({ showShiftForm: true });
                toggleMenu();
              }}
            >
              ↔️ Shift Mouza
            </NavItem>

            {user && (
              <>
                <NavItem
                  id="nav-link-save-layer"
                  disabled={!canSaveLayer}
                  onClick={() => {
                    setOpenSubmenu(null);
                    handleSaveLayerClick?.();
                    toggleMenu();
                  }}
                >
                  💾 Save Layer
                </NavItem>
                <NavItem
                  id="nav-link-saved-layers"
                  onClick={() => {
                    setOpenSubmenu(null);
                    set({ showSavedLayersModal: true });
                    toggleMenu();
                  }}
                >
                  📁 Open Saved Layers
                </NavItem>
              </>
            )}

            {availableTours.length > 0 && (
              <div className="submenu-wrapper">
                {accordionHead('tutorials', '📚 Guided Tutorials')}
                {openSubmenu === 'tutorials' && (
                  <div className="submenu-accordion">
                    {availableTours.map((key) => (
                      <NavItem
                        key={key}
                        className="submenu-item"
                        onClick={() => {
                          setOpenSubmenu(null);
                          onStartTour(key);
                          toggleMenu();
                        }}
                      >
                        {TOUR_ICONS[key]} {TOUR_TITLES[key]}
                      </NavItem>
                    ))}
                  </div>
                )}
              </div>
            )}

            {user?.userType === 'subadmin' && (
              <>
                <NavItem onClick={() => go('/subadmin')}>📊 Dashboard & Bills</NavItem>
                <NavItem onClick={() => go('/subadmin/users')}>👥 My Customers</NavItem>
                <NavItem onClick={() => go('/subadmin/users?new=1')}>➕ New Customer</NavItem>
              </>
            )}

            {user?.userType === 'admin' && (
              <div className="submenu-wrapper">
                {accordionHead('admin', '🛠️ Admin Tools')}
                {openSubmenu === 'admin' && (
                  <div className="submenu-accordion">
                    <NavItem className="submenu-item" onClick={() => go('/admin/register')}>➕ Register User</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/users')}>👥 Manage Users</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/admin/subadmins')}>🤝 Sub-admins</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/stats')}>📈 Insights</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/aks-shajra')}>📐 Aks Shajra (Beta / Test)</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/admin/land-allotments')}>🏜️ Cholistan Land Allotments</NavItem>
                    <NavItem className="submenu-item" onClick={() => go('/admin/operations-report')}>📄 Operations Report</NavItem>
                    <NavItem
                      className="submenu-item"
                      onClick={() => {
                        setOpenSubmenu(null);
                        setShowTehsilModal(true);
                        toggleMenu();
                      }}
                    >
                      🔗 Link & Group Tehsils
                    </NavItem>
                    {adminToggle(testMode ? '🟢 Test Mode: ON' : '⚪ Test Mode: OFF', testMode, () => set({ testMode: !testMode }))}
                    {adminToggle(killaMeasurement ? '🟢 Killa Measurement: ON' : '⚪ Killa Measurement: OFF', killaMeasurement, () => set({ killaMeasurement: !killaMeasurement }))}
                    {adminToggle(forceMobileMode ? '📱 Mobile Mode: ON' : '📱 Mobile Mode: OFF', forceMobileMode, () => useAppStore.getState().toggleMobileMode())}

                    <div className="nav-divider" style={{ backgroundColor: 'rgba(0,0,0,0.1)' }} />

                    <div className="nav-link-clean submenu-item flex items-center justify-between !pr-3">
                      <label htmlFor="nav-limits-toggle" className="cursor-pointer text-[0.9rem]" style={{ color: limitsEnabled ? '#28a745' : '#dc3545' }}>
                        {limitsEnabled ? '🔒 Limits: ON' : '🔓 Limits: OFF'}
                      </label>
                      <Switch id="nav-limits-toggle" checked={limitsEnabled} onChange={toggleLimits} />
                    </div>
                    <div className="nav-link-clean submenu-item flex items-center justify-between !pr-3">
                      <label htmlFor="nav-invoices-toggle" className="cursor-pointer text-[0.9rem]" style={{ color: invoicesOn ? '#28a745' : undefined }}>
                        {invoicesOn ? '🧾 Mouza Invoices: ON' : '🧾 Mouza Invoices: OFF'}
                      </label>
                      <Switch id="nav-invoices-toggle" checked={invoicesOn} onChange={toggleInvoices} />
                    </div>

                    <div className="nav-divider" style={{ backgroundColor: 'rgba(0,0,0,0.1)' }} />
                    <ScanHostingButton onDone={() => setOpenSubmenu(null)} />
                    <div className="nav-divider" style={{ backgroundColor: 'rgba(0,0,0,0.1)' }} />

                    <div className="px-2 pb-1 pt-1.5">
                      <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-[0.04em] text-[#6b7280]">🗺️ Layer Mode</div>
                      <div className="flex gap-1">
                        {([
                          { value: 'auto', label: 'Auto', emoji: '⚙️' },
                          { value: 'pmtiles', label: 'PMTiles', emoji: '⚡' },
                          { value: 'geojson', label: 'GeoJSON', emoji: '📐' },
                        ] as { value: AdminMapMode; label: string; emoji: string }[]).map(({ value, label, emoji }) => {
                          const active = adminMapMode === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                setOpenSubmenu(null);
                                useAppStore.getState().setAdminMapMode(value);
                              }}
                              className="flex-1 rounded py-[3px] text-center text-[0.65rem] leading-[1.3] transition-all duration-[180ms] max-sm:py-1.5"
                              style={{
                                fontWeight: active ? 700 : 500,
                                border: active ? '1.5px solid #2563eb' : '1px solid rgba(0,0,0,0.15)',
                                background: active ? '#eff6ff' : '#ffffff',
                                color: active ? '#1e40af' : '#4b5563',
                              }}
                            >
                              <div>{emoji}</div>
                              <div>{label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <NavItem
              id="nav-link-clear-cache"
              onClick={() => {
                setOpenSubmenu(null);
                clearAppData();
                toggleMenu();
              }}
            >
              🧹 Clear Cache
            </NavItem>

            {user?.userType === 'user' && (
              <NavItem
                id="nav-link-change-mouzas"
                disabled={!changeMouzasOk}
                title={changeMouzasOk ? 'Request mouzas to be added or removed' : 'Available while your subscription is active. Please renew first.'}
                style={changeMouzasOk ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                onClick={() => {
                  setOpenSubmenu(null);
                  setShowChangeMouzas(true);
                  toggleMenu();
                }}
              >
                🗺️ Change Mouza{!changeMouzasOk && <span className="ml-1.5 text-[0.7rem]">(renew first)</span>}
              </NavItem>
            )}

            <div className="nav-divider" />
            {(user || tourType === 'changePassword') && (
              <NavItem
                id="nav-link-change-password"
                onClick={() => {
                  setOpenSubmenu(null);
                  set({ showForgotPasswordModal: true });
                  toggleMenu();
                }}
              >
                🔑 Change Password
              </NavItem>
            )}

            {user && (
              <div className="nav-user-info">
                <div className="user-greeting">👤 {user.userName}</div>
                <div className="user-role">{user.userType === 'admin' ? 'Administrator' : user.userType === 'subadmin' ? 'Sub-admin' : 'User'}</div>
              </div>
            )}
            {user ? (
              <NavItem
                className="logout"
                onClick={() => {
                  setOpenSubmenu(null);
                  logout();
                  toggleMenu();
                }}
              >
                🚪 Logout
              </NavItem>
            ) : (
              <NavItem onClick={() => go('/login')}>🔐 Login</NavItem>
            )}
          </nav>

          <div className="mt-auto flex flex-col gap-[3px] pb-[5px] pt-5 text-center text-[0.65rem] text-[#4b5563]">
            <div className="font-extrabold uppercase tracking-[0.02em] text-[#2563eb]">GeoMatrix Technologies</div>
            <div className="font-medium">Version {__BUILD_META__?.version || '1.0.0'}</div>
          </div>
        </div>
      </aside>

      {user?.userType === 'user' && (
        <ChangeMouzasModal show={showChangeMouzas && changeMouzasOk} onHide={() => setShowChangeMouzas(false)} user={user} />
      )}
      {user?.userType === 'admin' && <TehsilGroupingModal show={showTehsilModal} onHide={() => setShowTehsilModal(false)} />}
    </>
  );
}
