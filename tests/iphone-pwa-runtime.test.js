'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Home Screen lifecycle registers independently from notification permission', () => {
  const runtime = read('public/pwa-runtime.js');
  const bootstrap = read('public/mobile-bootstrap.js');
  const landing = read('public/index.html');

  assert.match(runtime, /serviceWorker\.register\(SW_URL, \{ scope: '\/' \}\)/);
  assert.match(runtime, /A new DizyChat version is ready\./);
  assert.match(runtime, /SKIP_WAITING/);
  assert.match(runtime, /dizychat:pwa-resume/);
  assert.doesNotMatch(runtime, /Notification\.requestPermission/);
  assert.doesNotMatch(runtime, /pushManager\.subscribe/);

  const pwaAt = bootstrap.indexOf("/pwa-runtime.js");
  const notificationsAt = bootstrap.indexOf("/browser-notifications.js");
  assert.ok(pwaAt >= 0 && notificationsAt > pwaAt, 'PWA lifecycle must start before optional Web Push');
  assert.match(landing, /src=["']\/pwa-runtime\.js["']/i);
});

test('service worker caches only safe same-origin shell traffic and preserves Push handling', () => {
  const sw = read('public/dizychat-sw.js');

  assert.match(sw, /CACHE_NAME = `\$\{CACHE_PREFIX\}v2`/);
  assert.match(sw, /addEventListener\('install'/);
  assert.match(sw, /addEventListener\('activate'/);
  assert.match(sw, /addEventListener\('fetch'/);
  assert.match(sw, /addEventListener\('message'/);
  assert.match(sw, /SKIP_WAITING/);
  assert.match(sw, /networkFirst\(request, '\/login\.html'\)/);
  assert.match(sw, /'\/api\/', '\/socket\.io\/', '\/uploads\/', '\/soundboards\/'/);
  assert.match(sw, /url\.origin !== self\.location\.origin \|\| shouldBypass\(url\)/);

  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\('notificationclick'/);
});

test('standalone CSS protects iPhone safe areas and update/offline UI', () => {
  const css = read('public/pwa-runtime.css');

  assert.match(css, /body\.pwa-standalone\s*\{[^}]*--toolbar-top-extra:\s*env\(safe-area-inset-top\);/s);
  assert.match(css, /body\.pwa-standalone #form\s*\{[^}]*safe-area-inset-left[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom/s);
  assert.match(css, /100dvh/);
  assert.match(css, /\.pwa-runtime-banner\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(css, /data-tone="offline"/);
  assert.match(css, /data-tone="update"/);
});

test('long Home Screen suspension performs a clean chat reconnect without a false disconnect warning', () => {
  const chat = read('public/chat.js');

  assert.match(chat, /let pwaResumeReconnect = false;/);
  assert.match(chat, /addEventListener\?\.\("dizychat:pwa-resume"/);
  assert.match(chat, /detail\.reconnectRecommended/);
  assert.match(chat, /if \(socket\.connected\) socket\.disconnect\(\);\s*socket\.connect\(\);/s);
  assert.match(chat, /if \(!pwaResumeReconnect\)\s*\{\s*showToast\("Disconnected — attempting to reconnect…"/s);
});

test('Web Push reuses the standalone worker and still labels Home Screen subscriptions', () => {
  const notifications = read('public/browser-notifications.js');

  assert.match(notifications, /serviceWorker\.getRegistration\?\.\('\/'\)/);
  assert.match(notifications, /serviceWorker\.register\('\/dizychat-sw\.js'\)/);
  assert.match(notifications, /dizychatPwaRuntime\?\.isStandalone/);
  assert.match(notifications, /'iPhone Home Screen'/);
});
