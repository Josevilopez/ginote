/*
 * S5-02: service worker SOLO para avisos push. No guarda la web en caché
 * (así nunca se queda pegada una versión vieja).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  const title = msg.title || 'Guiñote';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      lang: 'es',
      data: { url: msg.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        // La web ya está abierta: que vaya ella al sitio (sin recargar).
        same.postMessage({ type: 'guinote:open', url });
        try {
          return await same.focus();
        } catch {
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
