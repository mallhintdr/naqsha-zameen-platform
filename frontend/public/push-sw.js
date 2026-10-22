/* Push notifications service worker.
 * Shows notifications in the phone / desktop status bar even when the
 * dashboard is closed, and opens the right page when one is tapped.
 * It does NOT cache anything (no fetch handler), so app updates are unaffected. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Naqsha Zameen', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Naqsha Zameen';
  const options = {
    body: data.body || '',
    icon: '/logo192.png',
    badge: '/favicon.png',
    tag: data.tag || (data.data && data.data.notificationId) || undefined,
    renotify: true,
    requireInteraction: false,
    vibrate: [120, 60, 120],
    data: data.data || { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open dashboard tab when there is one.
    for (const client of all) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* cross-origin guard */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
