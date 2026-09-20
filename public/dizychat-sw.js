'use strict';

const clean = (value) => String(value || '').trim();

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json?.() || {};
  } catch (_error) {
    try {
      payload = JSON.parse(event.data?.text?.() || '{}');
    } catch (_ignored) {
      payload = {};
    }
  }

  const type = clean(payload.type);
  const title = clean(payload.title) || 'DizyChat';
  const body = clean(payload.body) || 'New message';
  const room = clean(payload.room);
  const messageId = clean(payload.messageId);
  const tag = clean(payload.tag) || (room ? `dizychat:${room}` : 'dizychat');
  const rawUrl = clean(payload.url) || '/login.html';
  let url = '/login.html';
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) {
      url = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch (_error) {
    // Keep the same-origin fallback route.
  }

  const options = {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag,
    renotify: true,
    data: { url, room, messageId, type },
  };
  if (type === 'activity') {
    options.vibrate = [180, 120, 180];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close?.();
  const rawUrl = clean(event.notification?.data?.url) || '/login.html';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windows) {
      try {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if (typeof client.navigate === 'function') await client.navigate(targetUrl);
        await client.focus?.();
        return;
      } catch (_error) {
        // Try the next matching window.
      }
    }

    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
