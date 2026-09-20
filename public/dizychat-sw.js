'use strict';

const CACHE_PREFIX = 'dizychat-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const APP_SHELL = [
  '/login.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/mobile-bootstrap.js',
  '/iphone-install.js',
  '/iphone-install.css',
  '/pwa-runtime.js',
  '/pwa-runtime.css',
];
const BYPASS_PREFIXES = ['/api/', '/socket.io/', '/uploads/', '/soundboards/'];

const clean = (value) => String(value || '').trim();

const shouldBypass = (url) =>
  BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));

const isStaticAsset = (url) =>
  /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|webmanifest|woff2?)$/i.test(url.pathname);

const fetchAndCache = async (request) => {
  const response = await fetch(request);
  if (
    response
    && response.ok
    && response.type !== 'opaque'
    && request.method === 'GET'
  ) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
};

const networkFirst = async (request, fallbackUrl = '') => {
  try {
    return await fetchAndCache(request);
  } catch (_error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw _error;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map((path) => cache.add(path)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_error) {
    return;
  }

  if (url.origin !== self.location.origin || shouldBypass(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/login.html'));
    return;
  }

  if (isStaticAsset(url) || APP_SHELL.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});

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
