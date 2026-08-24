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

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: tagParts.join('-') || undefined,
      data: {
        ...payload,
        url: targetUrl,
      },
    }),
  );
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
