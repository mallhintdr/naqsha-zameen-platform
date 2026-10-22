// Phone / desktop notifications even when the app is closed. Registers /push-sw.js,
// asks permission on the first tap after login (browsers require a gesture),
// subscribes with the server's VAPID key and sends the subscription to the server.
import { api } from '@/shared/api/client';

export const PUSH_SW = '/push-sw.js';
const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
const sameKey = (a: any, b: Uint8Array) => {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

async function subscribe(reg: ServiceWorkerRegistration) {
  const { data } = await api.get('/api/notifications/vapid-public-key');
  const key = keyToBytes(data.publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post('/api/notifications/subscribe', { subscription: sub.toJSON() });
  window.__pushEnabled = true;
  return sub;
}

let asked = false;
export async function setupPush() {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.register(PUSH_SW);
  await navigator.serviceWorker.ready;
  if (Notification.permission === 'granted') return subscribe(reg).catch(() => {});
  if (Notification.permission === 'denied' || asked) return;
  asked = true;
  const ask = async () => {
    document.removeEventListener('click', ask, true);
    document.removeEventListener('touchend', ask, true);
    try {
      if ((await Notification.requestPermission()) === 'granted') await subscribe(reg);
    } catch {}
  };
  document.addEventListener('click', ask, true);
  document.addEventListener('touchend', ask, true);
}

/** On logout: this device stops receiving this account's notifications. */
export async function disablePushForThisAccount() {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SW);
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await api.post('/api/notifications/unsubscribe', { endpoint: sub.endpoint });
  } catch {}
}
