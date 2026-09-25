self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const loadId = String(payload.loadId || '').trim();
  const targetUrl = String(payload.url || '').trim() || (loadId ? `/?loadId=${encodeURIComponent(loadId)}` : '/');
  const title = String(payload.title || '').trim() || 'Kole Connect';
  const body = String(payload.body || '').trim() || 'Open Kole Connect to view the latest load update.';
  const tagParts = [payload.eventType, loadId || payload.bidId].filter(Boolean);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: '/icons/kole-192.png',
        badge: '/icons/kole-192.png',
        tag: tagParts.join('-') || undefined,
        data: {
          ...payload,
          url: targetUrl,
        },
      }),
      ...windows.map((client) => client.postMessage({
        type: 'KOLE_MOBILE_PUSH_RECEIVED',
        eventType: String(payload.eventType || '').trim(),
        loadId,
      })),
    ]);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const data = event.notification.data || {};
    const loadId = String(data.loadId || '').trim();
    const targetPath = String(data.url || '').trim() || (loadId ? `/?loadId=${encodeURIComponent(loadId)}` : '/');
    const targetUrl = new URL(targetPath, self.location.origin);
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const existingWindow = windows.find((client) => new URL(client.url).origin === targetUrl.origin);

    if (existingWindow) {
      await existingWindow.navigate(targetUrl.href);
      return existingWindow.focus();
    }

    return self.clients.openWindow(targetUrl.href);
  })());
});
