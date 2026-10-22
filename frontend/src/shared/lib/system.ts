/** Console output is shown to admins only in production (legacy secure-logger behaviour). */
const isAdmin = () => {
  try {
    return JSON.parse(sessionStorage.getItem('user') || 'null')?.userType === 'admin';
  } catch {
    return false;
  }
};

export function initSecureLogger() {
  if (import.meta.env.DEV) return;
  const c = console as any;
  for (const m of ['log', 'warn', 'info', 'debug', 'trace', 'group', 'groupEnd', 'table', 'error']) {
    const orig = c[m].bind(console);
    c[m] = (...args: any[]) => {
      if (isAdmin()) orig(...args);
    };
  }
}

/** Reload once when /meta.json reports a newer build (same contract as the legacy VersionChecker). */
export function startVersionChecker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const r of regs) {
          const url = (r.active || r.waiting || r.installing)?.scriptURL || '';
          if (!url.endsWith('/push-sw.js')) r.unregister();
        }
      })
      .catch(() => {});
  }
  if (import.meta.env.DEV) return () => {};
  const check = async () => {
    try {
      const res = await fetch(`/meta.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) return;
      const server = await res.json();
      if (server.buildDate > __BUILD_META__.buildDate) {
        if (localStorage.getItem('latestVersionAttempted') === String(server.buildDate)) return;
        localStorage.setItem('latestVersionAttempted', String(server.buildDate));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((n) => caches.delete(n)));
        }
        window.location.reload();
      }
    } catch {}
  };
  check();
  const id = setInterval(check, 30 * 60 * 1000);
  return () => clearInterval(id);
}

/**
 * Recharts tooltips close by themselves on touch screens (legacy chartTooltipAutoHide):
 * after 3 s, on an outside tap, and on scroll.
 */
export function installChartTooltipAutoHide() {
  if (typeof window === 'undefined' || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;
  let timer: any = null;
  const hideAll = () => {
    document.querySelectorAll('.recharts-wrapper').forEach((el) => {
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
  };
  document.addEventListener(
    'touchstart',
    (e) => {
      const inside = (e.target as Element)?.closest?.('.recharts-wrapper');
      if (!inside) hideAll();
      clearTimeout(timer);
      if (inside) timer = setTimeout(hideAll, 3000);
    },
    { passive: true, capture: true },
  );
  window.addEventListener('scroll', hideAll, { passive: true, capture: true });
}
