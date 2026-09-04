'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../public/mobile-runtime.js');

const config = {
  defaultNativeBackendUrl: 'https://dizychat.com',
  backendUrlStorageKey: 'dizychat-backend-url',
};

const nativeWindow = {
  Capacitor: { isNativePlatform: () => true },
  location: { origin: 'https://localhost', protocol: 'https:' },
  localStorage: { getItem: () => '' },
};

const webWindow = {
  location: { origin: 'https://dizychat.com', protocol: 'https:' },
  localStorage: { getItem: () => '' },
};

test('native runtime detection prefers Capacitor and recognizes bundled compatibility origins', () => {
  assert.equal(runtime.isNativeRuntime(nativeWindow), true);
  assert.equal(runtime.isNativeRuntime({ location: { origin: 'capacitor://localhost', protocol: 'capacitor:' } }), true);
  assert.equal(runtime.isNativeRuntime({ location: { origin: 'file://', protocol: 'file:' } }), true);
  assert.equal(runtime.isNativeRuntime({ location: { origin: 'http://localhost', protocol: 'http:' } }), true);
  assert.equal(runtime.isNativeRuntime(webWindow), false);
});

test('native backend defaults to dizychat.com while ordinary web stays same-origin', () => {
  assert.equal(runtime.resolveBackendOrigin(nativeWindow, config), 'https://dizychat.com');
  assert.equal(runtime.resolveBackendOrigin(webWindow, config), '');
});

test('validated developer backend override is native-only and rejects unsafe protocols', () => {
  const debugWindow = {
    ...nativeWindow,
    localStorage: { getItem: () => 'https://dizyserver.lan/' },
  };
  const unsafeWindow = {
    ...nativeWindow,
    localStorage: { getItem: () => 'javascript:alert(1)' },
  };

  assert.equal(runtime.resolveBackendOrigin(debugWindow, config), 'https://dizyserver.lan');
  assert.equal(runtime.resolveBackendOrigin(unsafeWindow, config), 'https://dizychat.com');
});

test('only server-backed relative paths are rewritten to the native backend', () => {
  assert.equal(runtime.shouldRouteBackendRequest('/api/calls/status'), true);
  assert.equal(runtime.shouldRouteBackendRequest('/upload'), true);
  assert.equal(runtime.shouldRouteBackendRequest('/tenor-proxy?url=x'), true);
  assert.equal(runtime.shouldRouteBackendRequest('/giphy-search?q=cat'), true);
  assert.equal(runtime.shouldRouteBackendRequest('/soundboard-clips'), true);
  assert.equal(runtime.shouldRouteBackendRequest('/emojis.json'), false);
  assert.equal(runtime.shouldRouteBackendRequest('/chat.js'), false);
  assert.equal(runtime.resolveBackendUrl('/upload', 'https://dizychat.com'), 'https://dizychat.com/upload');
  assert.equal(runtime.resolveBackendUrl('https://example.org/x', 'https://dizychat.com'), 'https://example.org/x');
});

test('external-link and Android back decisions preserve DizyChat-owned navigation', () => {
  assert.equal(runtime.shouldOpenExternally('https://example.org/x', 'https://dizychat.com'), true);
  assert.equal(runtime.shouldOpenExternally('https://dizychat.com/uploads/a.jpg', 'https://dizychat.com'), false);
  assert.equal(runtime.shouldOpenExternally('/uploads/a.jpg', 'https://dizychat.com'), false);
  assert.equal(runtime.decideBackAction({ transientOpen: true, inChat: true }), 'close-transient');
  assert.equal(runtime.decideBackAction({ transientOpen: false, inChat: true }), 'leave-chat');
  assert.equal(runtime.decideBackAction({ transientOpen: false, inChat: false }), 'exit-app');
});
